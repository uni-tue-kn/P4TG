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
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::info;
use serde::Serialize;
use crate::api::helper::validate::validate_request;

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
            port_tx_rx_mapping: tg.port_mapping.clone()
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
pub async fn configure_traffic_gen(State(state): State<Arc<AppState>>, payload: Json<TrafficGenData>) -> Response {
    let tg = &mut state.traffic_generator.lock().await;

    // contains the description of the stream, i.e., packet size and rate
    // only look at active stream settings
    let active_stream_settings: Vec<StreamSetting> = payload.stream_settings.clone().into_iter().filter(|s| s.active).collect();
    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = payload.streams.clone().into_iter().filter(|s| active_stream_ids.contains(&s.stream_id)).collect();

    // Poisson traffic is only allowed to have a single stream
    if payload.mode == GenerationMode::Poisson && active_streams.len() != 1 {
        return (StatusCode::BAD_REQUEST, Json(Error::new("Poisson generation mode only allows for one stream."))).into_response()
    }

    // no streams should be generated in monitor/analyze mode
    if payload.mode == GenerationMode::Analyze && !active_streams.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(Error::new("No stream definition in analyze mode allowed."))).into_response();
    }

    // contains the mapping of Send->Receive ports
    // required for analyze mode
    let port_mapping = &payload.port_tx_rx_mapping;

    // validate request
    match validate_request(&active_streams, &active_stream_settings, &payload.mode, tg.is_tofino2) {
        Ok(_) => {},
        Err(e) => return (StatusCode::BAD_REQUEST, Json(e)).into_response()
    }

    match tg.start_traffic_generation(&state, active_streams, payload.mode, active_stream_settings, port_mapping).await {
        Ok(streams) => {
            // store the settings for synchronization between multiple
            // GUI clients
            tg.port_mapping = payload.port_tx_rx_mapping.clone();
            tg.stream_settings = payload.stream_settings.clone();
            tg.streams = payload.streams.clone();
            tg.mode = payload.mode;

            // experiment starts now
            // these values are used to show how long the experiment is running at the GUI
            state.experiment.lock().await.start = SystemTime::now();
            state.experiment.lock().await.running = true;

            info!("Traffic generation started.");
            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
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
            StatusCode::OK.into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
    }
}