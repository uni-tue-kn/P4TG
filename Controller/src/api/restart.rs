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
use log::info;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use axum::extract::State;
use std::sync::Arc;
use std::time::SystemTime;
use crate::AppState;
use crate::api::{Stream, StreamSetting};
use crate::api::server::Error;

#[debug_handler]
pub async fn restart(State(state): State<Arc<AppState>>) -> Response {
    let tg = &mut state.traffic_generator.lock().await;

    // contains the description of the stream, i.e., packet size and rate
    // only look at active stream settings
    let active_stream_settings: Vec<StreamSetting> = tg.stream_settings.clone().into_iter().filter(|s| s.active).collect();
    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = tg.streams.clone().into_iter().filter(|s| active_stream_ids.contains(&s.stream_id)).collect();
    let mode = tg.mode.clone();
    let mapping = tg.port_mapping.clone();

    match tg.start_traffic_generation(&state, active_streams, mode, active_stream_settings, &mapping).await {
        Ok(streams) => {
            info!("Traffic generation restarted.");
            state.experiment.lock().await.start = SystemTime::now();
            state.experiment.lock().await.running = true;
            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
    }
}