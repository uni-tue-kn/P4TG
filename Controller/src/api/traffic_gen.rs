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
use std::time::{Duration, SystemTime};
use axum::debug_handler;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::{error, info};
use serde::Serialize;
use crate::api::helper::validate::validate_request;
use crate::api::helper::duration_monitor::monitor_test_duration;

use crate::api::server::Error;
use crate::AppState;

use crate::api::docs::traffic_gen::{EXAMPLE_GET_1, EXAMPLE_GET_2, EXAMPLE_POST_1_REQUEST, EXAMPLE_POST_1_RESPONSE, EXAMPLE_POST_2_REQUEST, EXAMPLE_POST_3_REQUEST};
use crate::core::traffic_gen_core::types::*;

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
            duration: tg.duration
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
    payload: Json<TrafficGenData>
) -> Response {
    let tg = &mut state.traffic_generator.lock().await;

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

    if payload.mode == GenerationMode::Poisson && active_streams.len() != 1 {
        return (StatusCode::BAD_REQUEST, Json(Error::new("Poisson generation mode only allows for one stream."))).into_response();
    }

    if payload.mode == GenerationMode::Analyze && !active_streams.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(Error::new("No stream definition in analyze mode allowed."))).into_response();
    }

    let tx_rx_port_mapping = &payload.port_tx_rx_mapping;

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

    match tg.start_traffic_generation(&state, active_streams.clone(), payload.mode, active_stream_settings.clone(), tx_rx_port_mapping).await {
        Ok(streams) => {
            tg.port_mapping = payload.port_tx_rx_mapping.clone();
            tg.stream_settings = payload.stream_settings.clone();
            tg.streams = payload.streams.clone();
            tg.mode = payload.mode;
            tg.duration = payload.duration;

            {
                let mut exp = state.experiment.lock().await;
                exp.start = SystemTime::now();
                exp.running = true;
            }

            // Cancel any existing monitor task
            if let Some(existing_task) = state.monitor_task.lock().await.take() {
                existing_task.abort();
            }

            if let Some(t) = payload.duration {
                if t > 0 {
                    let state_clone = state.clone();
                    let handle = tokio::spawn(async move {
                        let res = tokio::time::timeout(Duration::from_secs(3600), monitor_test_duration(state_clone, t as f64)).await;
                        if res.is_err() {
                            error!("monitor_test_duration hung over 1h, canceling.");
                        }
                    });

                    *state.monitor_task.lock().await = Some(handle);
                }
            }
 
            info!("Traffic generation started.");
            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response(),
    }
}

#[utoipa::path(
    delete,
    path = "/api/trafficgen",
    responses(
    (status = 200,
    description = "Stops the currently running traffic generation."))
)]
/// Stops the current traffic generation
pub async fn stop_traffic_gen(State(state): State<Arc<AppState>>) -> Response {
    let tg = &state.traffic_generator;
    let switch = &state.switch;

    match tg.lock().await.stop(switch).await {
        Ok(_) => {
            info!("Traffic generation stopped.");
            state.experiment.lock().await.running = false;

            // Cancel any existing monitor task
            if let Some(existing_task) = state.monitor_task.lock().await.take() {
                existing_task.abort();
            }

            StatusCode::OK.into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
    }
}