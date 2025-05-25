/* Copyright 2022-present University of Tuebingen, Chair of Communication Networks
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/*
 * Steffen Lindner (steffen.lindner@uni-tuebingen.de)
 */

use std::sync::Arc;
use std::time::SystemTime;
use axum::debug_handler;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::info;
use serde::{Deserialize, Serialize};
use crate::api::helper::validate::{validate_multiple_test, validate_request};

use crate::api::server::Error;
use crate::core::statistics::{RttHistogram, RttHistogramData};
use crate::AppState;

use crate::api::docs::traffic_gen::{EXAMPLE_GET_1, EXAMPLE_GET_2, EXAMPLE_POST_1_REQUEST, EXAMPLE_POST_1_RESPONSE, EXAMPLE_POST_2_REQUEST, EXAMPLE_POST_3_REQUEST};
use crate::core::traffic_gen_core::types::*;

#[derive(Debug, Deserialize)]
pub struct StopTrafficGenParams {
    pub skip: Option<bool>,
}

/// Method called on GET /trafficgen
/// Returns the currently configured traffic generation
#[utoipa::path(
        get,
        path = "/api/trafficgen",
        responses(
            (status = 200,
            description = "Returns the currently configured traffic generation.",
            body = TrafficGenData,
            examples(("Example 1" = (summary = "First example", value = json!(*EXAMPLE_GET_1))),
                     ("Example 2" = (summary = "Second example", value = json!(*EXAMPLE_GET_2)))
            )
            ),
            (status = 202, description = "Returned when no traffic generation is configured.", body = EmptyResponse)
        )
)]
pub async fn traffic_gen(State(state): State<Arc<AppState>>) -> Response {
    let tg = &state.traffic_generator.lock().await;

    if !tg.running {
        (StatusCode::ACCEPTED, Json(EmptyResponse{message: "Not running.".to_string()})).into_response()
    }
    else {
        let tg_data = TrafficGenData {
            mode: tg.mode,
            stream_settings: tg.stream_settings.clone(),
            streams: tg.streams.clone(),
            port_tx_rx_mapping: tg.port_mapping.clone(),
            duration: tg.duration,
            histogram_config: Some(tg.histogram_config.clone()),
            name: tg.name.clone()
        };

        (StatusCode::OK, Json(tg_data)).into_response()
    }
}



/// Represents the result of a stream optimization.
#[derive(Serialize)]
pub struct Result {
    /// Number of packets that are sent per `timeout`
    n_packets: u16,
    /// Timeout in ns until `n_packets` are generated
    timeout: u32,
    /// Target rate that should be generated.
    rate: f64,
    /// Rate accuracy according to `n_packets` and `timeout`
    rate_accuracy: f32,
}

/// Method called on POST /trafficgen
/// Starts the traffic generation with the specified settings in the POST body
#[debug_handler]
#[utoipa::path(
    post,
    path = "/api/trafficgen",
    request_body(
        content = TrafficGenData,
        examples(("Example 1" = (summary = "VxLAN 1024 (+50) byte @ 100 Gbps", value = json!(*EXAMPLE_POST_1_REQUEST))),
                 ("Example 2" = (summary = "VLAN 64 (+4) byte @ 80 Gbps", value = json!(*EXAMPLE_POST_2_REQUEST))),
                 ("Example 3" = (summary = "Poisson @ 30 Gbps", value = json!(*EXAMPLE_POST_3_REQUEST)))
        )
    ),
    responses(
    (status = 200,
    description = "Returns the configured traffic generation.",
    body = [Stream],
    examples(("Example 1" = (summary = "VxLAN 1024 (+50) byte @ 100 Gbps", value = json!(*EXAMPLE_POST_1_RESPONSE))),
             ("Example 2" = (summary = "VLAN 64 (+4) byte @ 80 Gbps", value = json!(*EXAMPLE_POST_1_RESPONSE)))
    )),
    )
)]
pub async fn configure_traffic_gen(
    State(state): State<Arc<AppState>>,
    payload: Json<TrafficGenTests>
) -> Response {

    // Cancel any existing duration monitor task
    state.monitor_task.lock().await.cancel_existing_monitoring_task().await;
    state.multiple_tests.multiple_test_monitor_task.lock().await.cancel_existing_monitoring_task().await;

    // Clear History statistics
    let mut stats_lock = state.multiple_tests.collected_statistics.lock().await;
    stats_lock.clear();
    let mut stats_lock = state.multiple_tests.collected_time_statistics.lock().await;
    stats_lock.clear();

    match payload {
        axum::Json(TrafficGenTests::SingleTest(traffic_gen_data)) => {
            // Just start a single test.
            start_single_test(&state, traffic_gen_data).await
        },
        axum::Json(TrafficGenTests::MultipleTest(traffic_gen_datas)) => {
            // This starts an async task that sequentially runs all the tests.
            let streams: Vec<Vec<Stream>> = traffic_gen_datas.clone().into_iter().map(|t: TrafficGenData| t.streams).collect();

            // Request validation
            match validate_multiple_test(traffic_gen_datas.clone()) {
                Ok(_) => {
                    state.multiple_tests.multiple_test_monitor_task.lock().await.start_multiple_tests(&state, traffic_gen_datas).await;
                    (StatusCode::OK, Json(streams)).into_response()
                }
                Err(e) => {
                    (StatusCode::BAD_REQUEST, Json(e)).into_response()
                }
            }


        },
    }
}


pub async fn start_single_test(state: &Arc<AppState>, payload: TrafficGenData) -> Response {
    // contains the description of the stream, i.e., packet size and rate
    // only look at active stream settings
    let active_stream_settings: Vec<StreamSetting> = payload.stream_settings
        .clone()
        .into_iter()
        .filter(|s| s.active)
        .collect();

    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = payload.streams
        .clone()
        .into_iter()
        .filter(|s| active_stream_ids.contains(&s.stream_id))
        .collect();

    // Poisson traffic is only allowed to have a single stream
    if payload.mode == GenerationMode::Poisson && active_streams.len() != 1 {
        return (StatusCode::BAD_REQUEST, Json(Error::new("Poisson generation mode only allows for one stream."))).into_response();
    }

    // no streams should be generated in monitor/analyze mode    
    if payload.mode == GenerationMode::Analyze && !active_streams.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(Error::new("No stream definition in analyze mode allowed."))).into_response();
    }

    // Clear histogram config state and release lock when out of scope
    {
        let mut histogram_configs = state.rtt_histogram_monitor.lock().await;
        histogram_configs.histogram.clear();
    }

    // Write histogram config into state. The tables will be later populated by init_histogram_config
    let histogram_config_cloned = payload.histogram_config.clone();
    for (rx, config) in histogram_config_cloned.unwrap_or_default() {
        let histogram_monitor = &mut state.rtt_histogram_monitor.lock().await;

        let port_number = rx.parse::<u32>().unwrap_or(0);

        // Check if the port is available for histogram config, i.e., if it is in the port mapping
        if state.port_mapping.contains_key(&port_number) {
            // Create new histogram config with empty data from payload
            histogram_monitor.histogram.insert(port_number, RttHistogram {
                config,
                data: RttHistogramData::default()
            });
        } else {
            return (StatusCode::BAD_REQUEST, Json(Error::new(format!("Port {port_number} is not available for histogram config on this device.")))).into_response();
        }
    }

    // Write default histogram config for active rx ports that do not have a histogram config set
    for (_tx, rx) in payload.port_tx_rx_mapping.clone() {
        let histogram_monitor = &mut state.rtt_histogram_monitor.lock().await;
        if histogram_monitor.histogram.get_mut(&rx).is_none() {
            info!("Adding default histogram config for rx port {rx}");
            histogram_monitor.histogram.insert(rx, RttHistogram::default());
        }
    }

    // contains the mapping of Send->Receive ports
    // required for analyze mode
    let tx_rx_port_mapping = &payload.port_tx_rx_mapping;

    let tg = &mut state.traffic_generator.lock().await;

    match validate_request(
        &active_streams,
        &active_stream_settings,
        &payload.mode,
        tx_rx_port_mapping,
        state.port_mapping.clone(),
        tg.is_tofino2
    ) {
        Ok(_) => {},
        Err(e) => return (StatusCode::BAD_REQUEST, Json(e)).into_response(),
    }

    match tg.start_traffic_generation(state, active_streams, payload.mode, active_stream_settings, tx_rx_port_mapping).await {
        Ok(streams) => {
            // store the settings for synchronization between multiple
            // GUI clients
            tg.port_mapping = payload.port_tx_rx_mapping.clone();
            tg.stream_settings = payload.stream_settings.clone();
            tg.streams = payload.streams.clone();
            tg.histogram_config = payload.histogram_config.unwrap_or_default();
            tg.mode = payload.mode;
            tg.duration = payload.duration;
            tg.name = payload.name;

            // experiment starts now
            // these values are used to show how long the experiment is running at the GUI
            state.experiment.lock().await.start = SystemTime::now();
            state.experiment.lock().await.running = true;

            // Check if a duration is desired
            if let Some(t) = payload.duration {
                if t > 0 {
                    state.monitor_task.lock().await.start(state, t).await;
                }
            }

            info!("Traffic generation started.");
            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{err:#?}")))).into_response(),
    }
}

#[utoipa::path(
    delete,
    path = "/api/trafficgen",
    params(
        ("skip" = Option<bool>, Query, description = "If set to true, only the current test will be skipped.")
    ),
    responses(
    (status = 200,
    description = "Stops the currently running traffic generation."))
)]
/// Stops the current traffic generation
pub async fn stop_traffic_gen(
    State(state): State<Arc<AppState>>,
    Query(params): Query<StopTrafficGenParams>,
) -> Response {
    let tg = &state.traffic_generator;
    let switch = &state.switch;

    // Cancel any existing duration monitor task
    state.monitor_task.lock().await.cancel_existing_monitoring_task().await;

    let skip_current_test = params.skip.unwrap_or(false);

    if !skip_current_test {
        // Cancel the multiple test monitor task if skip is set to false
        state.multiple_tests.multiple_test_monitor_task.lock().await.cancel_existing_monitoring_task().await;
    }

    match tg.lock().await.stop(switch).await {
        Ok(_) => {
            info!("Traffic generation stopped.");
            state.experiment.lock().await.running = false;
            StatusCode::OK.into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{err:#?}")))).into_response()
    }
}