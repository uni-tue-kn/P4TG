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

use crate::api::docs::traffic_gen::EXAMPLE_POST_1_RESPONSE;
use crate::api::server::Error;
use crate::core::traffic_gen::stop_traffic_generation_locked;
use crate::core::traffic_gen_core::helper::{
    generate_front_panel_to_dev_port_mappings, translate_fp_channel_to_dev_port_mapping,
};
use crate::core::traffic_gen_core::types::*;
use crate::AppState;
use axum::debug_handler;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::info;
use std::sync::Arc;
use std::time::SystemTime;

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
    let port_mapping = &state.port_mapping;
    let front_panel_dev_port_mappings =
        generate_front_panel_to_dev_port_mappings(port_mapping, state.tofino2);

    // Claim the active run before reading its state. Otherwise the duration
    // monitor can expire between the UI click and the running check below.
    state
        .monitor_task
        .lock()
        .await
        .cancel_existing_monitoring_task()
        .await;

    // Collect the current configuration and release the traffic generator lock
    // before potentially cancelling the RFC2544 task, which needs this lock to
    // stop its running trial.
    let (tx_rx_port_mapping, active_stream_settings, active_streams, mode, duration) = {
        let tg = state.traffic_generator.lock().await;

        if !tg.running {
            return (
                StatusCode::BAD_REQUEST,
                Json(Error::new(
                    "Traffic generator not running. Nothing to restart.",
                )),
            )
                .into_response();
        }

        let tx_rx_port_mapping = translate_fp_channel_to_dev_port_mapping(
            &tg.port_mapping,
            &front_panel_dev_port_mappings,
        );

        // contains the description of the stream, i.e., packet size and rate
        // only look at active stream settings
        // Translate front panel port to dev port
        let active_stream_settings: Vec<StreamSetting> = tg
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
        let active_stream_ids: Vec<u8> =
            active_stream_settings.iter().map(|s| s.stream_id).collect();
        let active_streams: Vec<Stream> = tg
            .streams
            .clone()
            .into_iter()
            .filter(|s| active_stream_ids.contains(&s.stream_id))
            .collect();

        (
            tx_rx_port_mapping,
            active_stream_settings,
            active_streams,
            tg.mode,
            tg.duration,
        )
    };

    let multiple_tests_running = state
        .multiple_tests
        .multiple_test_monitor_task
        .lock()
        .await
        .handle
        .as_ref()
        .is_some_and(|handle| !handle.is_finished());
    let keep_multiple_test_running = multiple_tests_running && mode != GenerationMode::Rfc2544;

    if !keep_multiple_test_running {
        state
            .multiple_tests
            .multiple_test_monitor_task
            .lock()
            .await
            .cancel_existing_monitoring_task()
            .await;
        state.experiment.lock().await.running = false;
    }

    let _lifecycle = state.traffic_lifecycle.lock().await;
    if let Err(err) = stop_traffic_generation_locked(&state).await {
        state.experiment.lock().await.running = false;
        return (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Error::new(format!("{err:#?}"))),
        )
            .into_response();
    }

    let restart_result = state
        .traffic_generator
        .lock()
        .await
        .start_traffic_generation(
            &state,
            active_streams,
            mode,
            active_stream_settings,
            &tx_rx_port_mapping,
        )
        .await;

    match restart_result {
        Ok(streams) => {
            state.experiment.lock().await.start = SystemTime::now();
            state.experiment.lock().await.running = true;

            // Check if a duration is desired
            if let Some(t) = duration {
                if t > 0 {
                    // Starts a duration monitor task that waits for duration and stops traffic generation after duration has exceeded
                    state.monitor_task.lock().await.start(&state, t).await;
                }
            }

            info!("Traffic generation restarted.");

            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => {
            // Release the lifecycle before cancelling an outer task: that task
            // may itself be waiting for this lock to finish a trial.
            drop(_lifecycle);
            if keep_multiple_test_running {
                state
                    .multiple_tests
                    .multiple_test_monitor_task
                    .lock()
                    .await
                    .cancel_existing_monitoring_task()
                    .await;
                state.experiment.lock().await.running = false;
            }
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(Error::new(format!("{err:#?}"))),
            )
                .into_response()
        }
    }
}
