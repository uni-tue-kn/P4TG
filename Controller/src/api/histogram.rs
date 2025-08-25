/* Copyright 2024-present University of Tuebingen, Chair of Communication Networks
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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

use crate::AppState;
use crate::{api::docs::histogram::EXAMPLE_GET_1, core::statistics::RttHistogramConfig};
use axum::debug_handler;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use std::{collections::HashMap, sync::Arc};

/// Method called on GET /histogram
/// Returns the histogram configuration of all RX ports.
#[debug_handler]
#[utoipa::path(
    get,
    path = "/api/histogram",
    responses(
        (status = 200,
        description = "Returns the histogram configuration of all RX ports.",
        body = HashMap<u32, RttHistogramConfig>,
        example = json!(*EXAMPLE_GET_1)
        ))
)]
pub async fn config(State(state): State<Arc<AppState>>) -> Response {
    let histogram_monitor = state.rtt_histogram_monitor.lock().await;
    let mut port_config_map: HashMap<u32, RttHistogramConfig> = HashMap::new();

    for (port, hist) in histogram_monitor.histogram.iter() {
        port_config_map.insert(*port, hist.config.clone());
    }

    (StatusCode::OK, Json(port_config_map)).into_response()
}
