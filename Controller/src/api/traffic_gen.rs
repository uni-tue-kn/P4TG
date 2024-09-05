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
use axum::debug_handler;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::info;
use serde::Serialize;
use crate::api::multiple_traffic_gen::configure_multiple_traffic_gen;
use std::collections::BTreeMap;

use crate::api::server::Error;
use crate::AppState;

use crate::api::docs::traffic_gen::{EXAMPLE_GET_1, EXAMPLE_GET_2, EXAMPLE_POST_1_REQUEST, EXAMPLE_POST_1_RESPONSE, EXAMPLE_POST_2_REQUEST, EXAMPLE_POST_3_REQUEST};
use crate::core::traffic_gen_core::types::*;

/// Method called on GET /trafficgen
/// Returns the currently configured traffic generation(s) (see `all_test` field in `TrafficGenData`)
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
    let all_test_list = state.multi_test_state.multiple_traffic_generators.lock().await;

    if !tg.running {
        (StatusCode::ACCEPTED, Json(EmptyResponse{message: "Not running.".to_string()})).into_response()
    }
    else {
        let all_test_value = if all_test_list.len() >= 1 {
            let mut btree_map = BTreeMap::new();
            for (index, test_data) in all_test_list.iter().enumerate() {
                btree_map.insert((index + 1) as u32, test_data.clone());
            }
            Some(btree_map)
        } else {
            None
        };

        // Extract the name from the current test data
        let name = if let Some(test_data) = all_test_list.first() {
            test_data.name.clone()
        } else {
            None
        };

        let tg_data = TrafficGenData {
            mode: tg.mode,
            stream_settings: tg.stream_settings.clone(),
            streams: tg.streams.clone(),
            port_tx_rx_mapping: tg.port_mapping.clone(),
            duration: None,
            name,
            all_test: all_test_value
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
/// Calls the `configure_multiple_traffic_gen` method, by creating a list with a single TrafficGenData element
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
    configure_multiple_traffic_gen(State(state), Json(vec![payload.0])).await
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


