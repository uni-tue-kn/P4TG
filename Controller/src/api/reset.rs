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
use axum::extract::State;
use axum::http::StatusCode;
use crate::AppState;
use axum::response::{Json, IntoResponse, Response};
use crate::api::server::Error;
use crate::core::traffic_gen_core::event::TrafficGenEvent;
use crate::core::traffic_gen_core::types::Reset;


/// Resets the statistics
#[utoipa::path(
    get,
    path = "/api/reset",
    responses(
    (status = 200,
    description = "Resets the statistics.",
    body = Reset,
    example = json!(Reset { message: "Reset complete".to_owned()})
    ))
)]
pub async fn reset(State(state): State<Arc<AppState>>) -> Response {
    let switch = &state.switch;
    let frame_size = state.frame_size_monitor.lock().await.on_reset(switch).await;
    let frame_type = state.frame_type_monitor.lock().await.on_reset(switch).await;
    let rate = state.rate_monitor.lock().await.on_reset(switch).await;
    let mut collected_statistics = state.multi_test_state.collected_statistics.lock().await;
    let mut collected_time_statistics = state.multi_test_state.collected_time_statistics.lock().await;

    if frame_size.is_ok() && frame_type.is_ok() && rate.is_ok() {
        // Clear the statistics
        collected_statistics.clear();    
        collected_time_statistics.clear();
    
        (StatusCode::OK, Json(Reset { message: "Reset complete".to_owned() })).into_response()
    }
    else {
        for error in [frame_size, frame_type, rate] {
            if error.is_err() {
                return (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:?}", error.err().unwrap())))).into_response();
            }
        }

        (StatusCode::OK, Json(Reset { message: "Reset complete".to_owned() })).into_response()
    }
}