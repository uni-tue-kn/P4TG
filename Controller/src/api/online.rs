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

use crate::api::docs;
use crate::core::{unix_secs, DIGEST_TIMEOUT_SECS};
use crate::AppState;
use axum::extract::{ConnectInfo, State};
use axum::http::{HeaderMap, StatusCode};
use axum::Json;
use schemars::JsonSchema;
use serde::Serialize;
use std::net::SocketAddr;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use utoipa::ToSchema;

#[derive(Serialize, JsonSchema, ToSchema)]
pub enum Asic {
    Tofino1,
    Tofino2,
}

#[derive(Serialize, JsonSchema, ToSchema)]
pub struct Online {
    pub(crate) status: String,
    pub(crate) version: String,
    pub(crate) asic: Asic,
    pub(crate) loopback: bool,
    /// False if no digest arrived from the switch recently. In that case the
    /// digest pipeline is dead and all rate/loss/RTT statistics are frozen;
    /// the controller needs a restart.
    pub(crate) digests_alive: bool,
    /// Number of other GUI clients that polled this endpoint recently, i.e.
    /// concurrent web sessions (excluding the requester's own session).
    pub(crate) connected_clients: usize,
}

/// Online endpoint
/// Returns the currently configured ports
#[utoipa::path(
    get,
    path = "/api/online",
    responses(
    (status = 200,
    body = Online,
    description = "Returns the status of P4TG.",
    example = json!(*docs::online::EXAMPLE_GET_1)
    ))
)]
pub async fn online(
    State(state): State<Arc<AppState>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
) -> (StatusCode, Json<Online>) {
    // Per-tab id sent by the GUI; clients without one (e.g. curl) fall back
    // to their IP as session id. Truncated so arbitrarily large header
    // values cannot bloat the tracker.
    let fallback = addr.ip().to_string();
    let session_id = headers
        .get("x-session-id")
        .and_then(|v| v.to_str().ok())
        .unwrap_or(fallback.as_str());
    let session_id = &session_id[..session_id.len().min(64)];
    let connected_clients = state
        .connected_clients
        .track_and_count_others(session_id)
        .await;

    (
        StatusCode::OK,
        Json(Online {
            status: "online".to_owned(),
            version: env!("CARGO_PKG_VERSION").parse().unwrap(),
            asic: if state.tofino2 {
                Asic::Tofino2
            } else {
                Asic::Tofino1
            },
            loopback: state.loopback_mode,
            digests_alive: unix_secs()
                .saturating_sub(state.last_digest.load(Ordering::Relaxed))
                <= DIGEST_TIMEOUT_SECS,
            connected_clients,
        }),
    )
}
