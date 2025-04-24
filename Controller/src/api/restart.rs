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

use axum::debug_handler;
use log::{error, info};
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use axum::extract::State;
use std::sync::Arc;
use std::time::{Duration, SystemTime};
use crate::AppState;
use crate::core::traffic_gen_core::types::*;
use crate::api::docs::traffic_gen::EXAMPLE_POST_1_RESPONSE;
use crate::api::server::Error;
use crate::api::helper::duration_monitor::monitor_test_duration;

#[debug_handler]
#[utoipa::path(
    get,
    path = "/api/restart",
    responses(
    (status = 200,
    description = "Restarts the currently running traffic generation.",
    body = [Stream],
    example = json!(*EXAMPLE_POST_1_RESPONSE)
    ),
    (status = 400,
    description = "No traffic generation is running that could be restarted."))
)]
/// Restarts the current traffic generation
pub async fn restart(State(state): State<Arc<AppState>>) -> Response {
    let tg = &mut state.traffic_generator.lock().await;

    if !tg.running {
        return (StatusCode::BAD_REQUEST, Json(Error::new("Traffic generator not running. Nothing to restart."))).into_response();
    }
    state.experiment.lock().await.running = false;

    // contains the description of the stream, i.e., packet size and rate
    // only look at active stream settings
    let active_stream_settings: Vec<StreamSetting> = tg.stream_settings.clone().into_iter().filter(|s| s.active).collect();
    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = tg.streams.clone().into_iter().filter(|s| active_stream_ids.contains(&s.stream_id)).collect();
    let mode = tg.mode;
    let mapping = tg.port_mapping.clone();
    let duration = tg.duration;

    match tg.start_traffic_generation(&state, active_streams, mode, active_stream_settings, &mapping).await {
        Ok(streams) => {
            {
                let mut exp = state.experiment.lock().await;
                exp.start = SystemTime::now();
                exp.running = true;
            }

            // Cancel any existing monitor task
            if let Some(existing_task) = state.monitor_task.lock().await.take() {
                existing_task.abort();
            }

            if let Some(t) = duration {
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

            info!("Traffic generation restarted.");

            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
    }
}