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
use crate::core::histogram_monitor::{
    build_iat_histogram_configs, build_rtt_histogram_configs, histogram_port_roles,
};
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
    let rfc2544_running = state
        .rfc2544_results
        .lock()
        .await
        .as_ref()
        .is_some_and(|results| results.running);
    let tg = &state.traffic_generator.lock().await;

    if !tg.running && !rfc2544_running {
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
            rfc2544: tg.rfc2544_config.clone(),
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
    let port_mapping = &state.port_mapping;

    match payload {
        axum::Json(TrafficGenTests::SingleTest(mut traffic_gen_data)) => {
            // Just start a single test.
            let is_tofino2 = state.traffic_generator.lock().await.is_tofino2;
            match validate_request(&traffic_gen_data, port_mapping, is_tofino2) {
                Ok(active_streams) => {
                    info!("Test validation successful.");
                    prepare_for_new_test(&state).await;
                    traffic_gen_data.streams = normalize_stream_patterns(traffic_gen_data.streams);

                    if traffic_gen_data.mode == GenerationMode::Rfc2544 {
                        {
                            let mut tg = state.traffic_generator.lock().await;
                            tg.port_mapping = traffic_gen_data.port_tx_rx_mapping.clone();
                            tg.stream_settings = traffic_gen_data.stream_settings.clone();
                            tg.streams = traffic_gen_data.streams.clone();
                            tg.rtt_histogram_config = traffic_gen_data
                                .rtt_histogram_config
                                .clone()
                                .unwrap_or_default();
                            tg.iat_histogram_config = traffic_gen_data
                                .iat_histogram_config
                                .clone()
                                .unwrap_or_default();
                            tg.rfc2544_config = traffic_gen_data.rfc2544.clone();
                            tg.mode = traffic_gen_data.mode;
                            tg.duration = traffic_gen_data.duration;
                            tg.name = traffic_gen_data.name.clone();
                        }
                        state.experiment.lock().await.start = SystemTime::now();
                        state.experiment.lock().await.running = true;
                        state
                            .multiple_tests
                            .multiple_test_monitor_task
                            .lock()
                            .await
                            .start_rfc2544(&state, traffic_gen_data)
                            .await;

                        return (StatusCode::OK, Json(active_streams)).into_response();
                    }

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
                    prepare_for_new_test(&state).await;
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

/// Stops the current orchestration and clears results only after the replacement
/// request has passed validation. Cancelling the outer task first prevents a
/// multi-test runner from advancing while its per-test duration task is stopped.
async fn prepare_for_new_test(state: &Arc<AppState>) {
    state
        .multiple_tests
        .multiple_test_monitor_task
        .lock()
        .await
        .cancel_existing_monitoring_task()
        .await;
    state
        .monitor_task
        .lock()
        .await
        .cancel_existing_monitoring_task()
        .await;

    state
        .multiple_tests
        .collected_statistics
        .lock()
        .await
        .clear();
    state
        .multiple_tests
        .collected_time_statistics
        .lock()
        .await
        .clear();
    *state.rfc2544_results.lock().await = None;
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

    // TX/RX roles of the active dev ports. They control which recirculation
    // paths get histogram table entries.
    let (histogram_tx_ports, histogram_rx_ports) = histogram_port_roles(&tx_rx_port_mapping);

    // Write IAT histogram config into state. The tables will be later populated by init_histogram_config
    {
        let mut histogram_monitor = state.iat_histogram_monitor.lock().await;
        histogram_monitor.histogram.clear();
        histogram_monitor.tx_ports = histogram_tx_ports.clone();
        histogram_monitor.rx_ports = histogram_rx_ports.clone();

        let iat_configs = build_iat_histogram_configs(
            payload.iat_histogram_config.as_ref(),
            &tx_rx_port_mapping,
            &front_panel_dev_port_mappings,
        );
        for (dev_port, config) in iat_configs {
            histogram_monitor.histogram.insert(
                dev_port,
                Histogram {
                    config,
                    data: HistogramPacketPath::default(),
                },
            );
        }
    }

    // Write RTT histogram config into state. The tables will be later populated by init_histogram_config
    {
        let mut histogram_monitor = state.rtt_histogram_monitor.lock().await;
        histogram_monitor.histogram.clear();
        histogram_monitor.tx_ports = histogram_tx_ports;
        histogram_monitor.rx_ports = histogram_rx_ports;

        let rtt_configs = build_rtt_histogram_configs(
            payload.rtt_histogram_config.as_ref(),
            &tx_rx_port_mapping,
            &front_panel_dev_port_mappings,
        );
        for (dev_port, config) in rtt_configs {
            histogram_monitor.histogram.insert(
                dev_port,
                Histogram {
                    config,
                    data: HistogramPacketPath::default(),
                },
            );
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
            // merge only the solver outputs into the original payload streams;
            // the annotated streams also carry rewritten frame_size/traffic_rate
            // values that must not be stored (restart & GUI sync re-feed them)
            let mut stored_streams = payload.streams.clone();
            for s in &mut stored_streams {
                if let Some(annotated) = streams.iter().find(|a| a.app_id == s.app_id) {
                    s.n_packets = annotated.n_packets;
                    s.timeout = annotated.timeout;
                    s.generation_accuracy = annotated.generation_accuracy;
                    s.n_pipes = annotated.n_pipes;
                }
            }
            tg.port_mapping = payload.port_tx_rx_mapping.clone();
            tg.stream_settings = payload.stream_settings.clone();
            tg.streams = stored_streams;
            tg.rtt_histogram_config = payload.rtt_histogram_config.unwrap_or_default();
            tg.iat_histogram_config = payload.iat_histogram_config.unwrap_or_default();
            tg.rfc2544_config = payload.rfc2544;
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
