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

use crate::api::server::Error;
use crate::AppState;
use crate::{
    api::docs::histogram::EXAMPLE_GET_1, api::docs::histogram::EXAMPLE_POST_1_REQUEST,
    api::docs::histogram::EXAMPLE_POST_1_RESPONSE, core::statistics::RttHistogramConfig,
};
use axum::debug_handler;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, sync::Arc};
use utoipa::ToSchema;

use super::helper::validate::validate_histogram;

#[derive(Debug, Deserialize, ToSchema, Serialize)]
pub struct HistogramConfigRequest {
    /// The dev port number to configure the histogram on.
    pub port: u32,
    /// The configuration object. It holds the minimum and maximum value, and the number of bins.
    pub config: RttHistogramConfig,
}

/// Method called on POST /histogram
/// Configures the histogram settings for the specified RX dev port.
#[debug_handler]
#[utoipa::path(
    post,
    path = "/api/histogram",
    request_body(
        content = HistogramConfigRequest,
        examples(("Example 1" = (summary = "Range 1500-2000ns with 50 bins", value = json!(*EXAMPLE_POST_1_REQUEST))),
        )
    ),
    responses(
        (status = 200,
        description = "Returns the configured histogram config.",
        body = HashMap<u32, &RttHistogramConfig>,
        examples(("Example 1" = (summary = "Range 1500-2000ns with 50 bins", value = json!(*EXAMPLE_POST_1_RESPONSE))),
        )),
        )
)]
pub async fn configure_histogram(
    State(state): State<Arc<AppState>>,
    payload: Json<HistogramConfigRequest>,
) -> Response {
    match validate_histogram(&payload) {
        Ok(_) => {}
        Err(e) => return (StatusCode::BAD_REQUEST, Json(e)).into_response(),
    }

    if state.traffic_generator.lock().await.running {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new(
                "Traffic generation is currently running. Stop it first.",
            )),
        )
            .into_response();
    }

    let port = payload.port;
    let new_config = &payload.config;
    let histogram_monitor = &mut state.rtt_histogram_monitor.lock().await;

    if let Some(hist) = histogram_monitor.histogram.get_mut(&port) {
        hist.config = new_config.clone();
        hist.data.data_bins.clear();
    } else {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new("Port is not available on this device.")),
        )
            .into_response();
    }

    let mut result = HashMap::new();
    result.insert(port, new_config);

    (StatusCode::OK, Json(result)).into_response()
}

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
