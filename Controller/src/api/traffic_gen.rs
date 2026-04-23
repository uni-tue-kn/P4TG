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

use crate::api::helper::validate::{
    normalize_stream_patterns, validate_multiple_test, validate_request,
};
use crate::core::traffic_gen_core::helper::{
    generate_front_panel_to_dev_port_mappings, translate_fp_channel_to_dev_port_mapping,
};
use axum::debug_handler;
use axum::extract::{Query, State};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::info;
use rbfrt::error::RBFRTError;
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use std::time::SystemTime;

use crate::api::server::Error;
use crate::core::statistics::{Histogram, HistogramPacketPath};
use crate::AppState;

use crate::api::docs::traffic_gen::{
    EXAMPLE_GET_1, EXAMPLE_GET_2, EXAMPLE_POST_1_REQUEST, EXAMPLE_POST_1_RESPONSE,
    EXAMPLE_POST_2_REQUEST, EXAMPLE_POST_3_REQUEST, EXAMPLE_POST_3_RESPONSE,
    EXAMPLE_POST_4_REQUEST, EXAMPLE_POST_4_RESPONSE,
};
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
        (
            StatusCode::ACCEPTED,
            Json(EmptyResponse {
                message: "Not running.".to_string(),
            }),
        )
            .into_response()
    } else {
        let tg_data = TrafficGenData {
            mode: tg.mode,
            stream_settings: tg.stream_settings.clone(),
            streams: tg.streams.clone(),
            port_tx_rx_mapping: tg.port_mapping.clone(),
            duration: tg.duration,
            rtt_histogram_config: Some(tg.rtt_histogram_config.clone()),
            iat_histogram_config: Some(tg.iat_histogram_config.clone()),
            name: tg.name.clone(),
        };

        (StatusCode::OK, Json(tg_data)).into_response()
    }
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
                 ("Example 3" = (summary = "Poisson @ 30 Gbps", value = json!(*EXAMPLE_POST_3_REQUEST))),
                 ("Example 4" = (summary = "Multiple tests", value = json!(*EXAMPLE_POST_4_REQUEST)))
        )
    ),
    responses(
    (status = 200,
    description = "Returns the configured traffic generation.",
    body = [Stream],
    examples(("Example 1" = (summary = "VxLAN 1024 (+50) byte @ 100 Gbps", value = json!(*EXAMPLE_POST_1_RESPONSE))),
             ("Example 2" = (summary = "VLAN 64 (+4) byte @ 80 Gbps", value = json!(*EXAMPLE_POST_1_RESPONSE))),
             ("Example 3" = (summary = "Poisson @ 30 Gbps", value = json!(*EXAMPLE_POST_3_RESPONSE))),
             ("Example 4" = (summary = "Multiple tests", value = json!(*EXAMPLE_POST_4_RESPONSE)))

    )),
    )
)]
pub async fn configure_traffic_gen(
    State(state): State<Arc<AppState>>,
    payload: Json<TrafficGenTests>,
) -> Response {
    // Cancel any existing duration monitor task
    state
        .monitor_task
        .lock()
        .await
        .cancel_existing_monitoring_task()
        .await;
    state
        .multiple_tests
        .multiple_test_monitor_task
        .lock()
        .await
        .cancel_existing_monitoring_task()
        .await;

    // Clear History statistics
    let mut stats_lock = state.multiple_tests.collected_statistics.lock().await;
    stats_lock.clear();
    let mut stats_lock = state.multiple_tests.collected_time_statistics.lock().await;
    stats_lock.clear();

    let port_mapping = &state.port_mapping;

    match payload {
        axum::Json(TrafficGenTests::SingleTest(mut traffic_gen_data)) => {
            // Just start a single test.
            let is_tofino2 = state.traffic_generator.lock().await.is_tofino2;
            match validate_request(&traffic_gen_data, port_mapping, is_tofino2) {
                Ok(_) => {
                    info!("Test validation successful.");
                    traffic_gen_data.streams = normalize_stream_patterns(traffic_gen_data.streams);
                    match start_single_test(&state, traffic_gen_data).await {
                        Ok(streams) => (StatusCode::OK, Json(streams)).into_response(),
                        Err(e) => {
                            let body = match &e {
                                RBFRTError::GenericError { message } => {
                                    info!("{message}");
                                    json!({ "message": message })
                                }
                                _ => json!({ "message": e.to_string() }),
                            };

                            (StatusCode::BAD_REQUEST, Json(body)).into_response()
                        }
                    }
                }
                Err(e) => (StatusCode::BAD_REQUEST, Json(e)).into_response(),
            }
        }
        axum::Json(TrafficGenTests::MultipleTest(mut traffic_gen_datas)) => {
            // This starts an async task that sequentially runs all the tests.
            let is_tofino2 = state.traffic_generator.lock().await.is_tofino2;

            // Request validation
            match validate_multiple_test(traffic_gen_datas.clone(), port_mapping, is_tofino2) {
                Ok(_) => {
                    for test in &mut traffic_gen_datas {
                        test.streams = normalize_stream_patterns(test.streams.clone());
                    }
                    let streams: Vec<Vec<Stream>> = traffic_gen_datas
                        .clone()
                        .into_iter()
                        .map(|t: TrafficGenData| t.streams)
                        .collect();
                    state
                        .multiple_tests
                        .multiple_test_monitor_task
                        .lock()
                        .await
                        .start_multiple_tests(&state, traffic_gen_datas)
                        .await;
                    (StatusCode::OK, Json(streams)).into_response()
                }
                Err(e) => (StatusCode::BAD_REQUEST, Json(e)).into_response(),
            }
        }
    }
}

pub async fn start_single_test(
    state: &Arc<AppState>,
    payload: TrafficGenData,
) -> Result<Vec<Stream>, RBFRTError> {
    let port_mapping = &state.port_mapping;

    let front_panel_dev_port_mappings =
        generate_front_panel_to_dev_port_mappings(port_mapping, state.tofino2);

    // contains the description of the stream, i.e., packet size and rate
    // only look at active stream settings
    let active_stream_settings: Vec<StreamSetting> = payload
        .stream_settings
        .clone()
        .into_iter()
        .filter_map(|mut s| {
            if s.active {
                let channel = s.channel.unwrap_or(0);
                s.port = *front_panel_dev_port_mappings.get(&s.port)? + channel as u32;
                Some(s)
            } else {
                None
            }
        })
        .collect();

    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = payload
        .streams
        .clone()
        .into_iter()
        .filter(|s| active_stream_ids.contains(&s.stream_id))
        .collect();

    // contains the mapping of Send->Receive ports. Uses the channel info to calculate dev ports
    // required for analyze mode
    let tx_rx_port_mapping = translate_fp_channel_to_dev_port_mapping(
        &payload.port_tx_rx_mapping,
        &front_panel_dev_port_mappings,
    );

    // Clear RTT histogram config state and release lock when out of scope
    {
        let mut histogram_configs = state.rtt_histogram_monitor.lock().await;
        histogram_configs.histogram.clear();
    }

    // Clear IAT histogram config state and release lock when out of scope
    {
        let mut histogram_configs = state.iat_histogram_monitor.lock().await;
        histogram_configs.histogram.clear();
    }

    // Write IAT histogram config into state. The tables will be later populated by init_histogram_config
    let histogram_config_cloned = payload.iat_histogram_config.clone();
    for (rx, channel_map) in histogram_config_cloned.unwrap_or_default() {
        let front_panel_port = rx.parse::<u32>().unwrap_or(0);
        for (channel, config) in channel_map {
            let histogram_monitor = &mut state.iat_histogram_monitor.lock().await;
            let channel_num = channel.parse::<u32>().unwrap_or(0);
            let dev_port = front_panel_dev_port_mappings
                .get(&front_panel_port)
                .unwrap()
                + channel_num;
            // Create new histogram config with empty data from payload
            histogram_monitor.histogram.insert(
                dev_port,
                Histogram {
                    config: config.clone(),
                    data: HistogramPacketPath::default(),
                },
            );

            // For IAT histograms, also write an entry for the mapped TX front panel port
            let tx_dev_port = tx_rx_port_mapping
                .iter()
                .find_map(|(k, &v)| (v == dev_port).then(|| k.clone()));
            if let Some(tx_dev_port) = tx_dev_port {
                let tx_dev_port_int = tx_dev_port.parse::<u32>().unwrap_or(0);
                histogram_monitor.histogram.insert(
                    tx_dev_port_int,
                    Histogram {
                        config,
                        data: HistogramPacketPath::default(),
                    },
                );
            }
        }
    }
    // Write default IAT histogram config for active tx/rx ports that do not have a histogram config set
    for (tx, rx) in tx_rx_port_mapping.clone() {
        let histogram_monitor = &mut state.iat_histogram_monitor.lock().await;
        if histogram_monitor.histogram.get_mut(&rx).is_none() {
            info!("Adding default IAT histogram config for rx port {rx}");
            histogram_monitor.histogram.insert(rx, Histogram::default());
        }
        let tx_int = tx.parse::<u32>().unwrap_or(0);
        if histogram_monitor.histogram.get_mut(&tx_int).is_none() {
            info!("Adding default IAT histogram config for tx port {tx_int}");
            histogram_monitor
                .histogram
                .insert(tx_int, Histogram::default());
        }
    }

    // Write RTT histogram config into state. The tables will be later populated by init_histogram_config
    let histogram_config_cloned = payload.rtt_histogram_config.clone();
    for (rx, channel_map) in histogram_config_cloned.unwrap_or_default() {
        let front_panel_port = rx.parse::<u32>().unwrap_or(0);
        for (channel, config) in channel_map {
            let histogram_monitor = &mut state.rtt_histogram_monitor.lock().await;
            let channel_num = channel.parse::<u32>().unwrap_or(0);
            let dev_port = front_panel_dev_port_mappings
                .get(&front_panel_port)
                .unwrap()
                + channel_num;
            // Create new histogram config with empty data from payload
            histogram_monitor.histogram.insert(
                dev_port,
                Histogram {
                    config,
                    data: HistogramPacketPath::default(),
                },
            );
        }
    }
    // Write default RTT histogram config for active rx ports that do not have a histogram config set
    for &rx in tx_rx_port_mapping.values() {
        let histogram_monitor = &mut state.rtt_histogram_monitor.lock().await;
        if histogram_monitor.histogram.get_mut(&rx).is_none() {
            info!("Adding default RTT histogram config for rx port {rx}");
            histogram_monitor.histogram.insert(rx, Histogram::default());
        }
    }

    let tg = &mut state.traffic_generator.lock().await;

    match tg
        .start_traffic_generation(
            state,
            active_streams,
            payload.mode,
            active_stream_settings,
            &tx_rx_port_mapping,
        )
        .await
    {
        Ok(streams) => {
            // store the settings for synchronization between multiple
            // GUI clients
            tg.port_mapping = payload.port_tx_rx_mapping.clone();
            tg.stream_settings = payload.stream_settings.clone();
            tg.streams = payload.streams.clone();
            tg.rtt_histogram_config = payload.rtt_histogram_config.unwrap_or_default();
            tg.iat_histogram_config = payload.iat_histogram_config.unwrap_or_default();
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
            Ok(streams)
        }
        Err(err) => Err(err),
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
    state
        .monitor_task
        .lock()
        .await
        .cancel_existing_monitoring_task()
        .await;

    let skip_current_test = params.skip.unwrap_or(false);

    if !skip_current_test {
        // Cancel the multiple test monitor task if skip is set to false
        state
            .multiple_tests
            .multiple_test_monitor_task
            .lock()
            .await
            .cancel_existing_monitoring_task()
            .await;
    }

    match tg.lock().await.stop(switch).await {
        Ok(_) => {
            info!("Traffic generation stopped.");
            state.experiment.lock().await.running = false;
            StatusCode::OK.into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Error::new(format!("{err:#?}"))),
        )
            .into_response(),
    }
}
