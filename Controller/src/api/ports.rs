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
use axum::response::{Json, IntoResponse, Response};
use rbfrt::util::port_manager::{Loopback, Port};
use serde::{Deserialize, Serialize};
use crate::api::docs;
use crate::api::server::{Error};
use crate::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PortConfiguration {
    pid: u32,
    speed: rbfrt::util::port_manager::Speed,
    fec: rbfrt::util::port_manager::FEC,
    auto_neg: rbfrt::util::port_manager::AutoNegotiation
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PortStats {
    pid: u32
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArpReply {
    pid: u32,
    arp_reply: bool
}

/// Returns the currently configured ports
#[utoipa::path(
    get,
    path = "/api/ports",
    responses(
    (status = 200,
    body = String,
    description = "Returns the currently configured ports.",
    example = json!(*docs::ports::EXAMPLE_GET_1)
    ))
)]
pub async fn ports(State(state): State<Arc<AppState>>) -> Response {
    let pm = &state.pm;
    let switch = &state.switch;

    match pm.get_ports(switch).await {
        Ok(ports) => Json(ports).into_response(),
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:?}", err)))).into_response()
    }
}

pub async fn add_port(State(state): State<Arc<AppState>>, payload: Json<PortConfiguration>) -> Response {
    let pm = &state.pm;

    match pm.frontpanel_port(payload.pid) {
        Ok((port, channel)) => {
            let mut req = Port::new(port , channel)
                .speed(payload.speed.clone())
                .fec(payload.fec.clone())
                .auto_negotiation(payload.auto_neg.clone());

            if state.loopback_mode {
                req = req.loopback(Loopback::BF_LPBK_MAC_NEAR);
            }

            match pm.update_port(&state.switch, &req).await {
                Ok(_) => {
                    StatusCode::CREATED.into_response()
                }
                Err(err) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
                }
            }
        }
        Err(err) => {
            (StatusCode::BAD_REQUEST, Json(Error::new(format!("{:#?}", err)))).into_response()
        }
    }
}

pub async fn arp_reply(State(state): State<Arc<AppState>>, payload: Json<ArpReply>) -> Response {
    let mapping = &state.port_mapping;

    match mapping.get(&payload.pid) {
        Some(port) => {
            match &state.arp_handler.modify_arp(&state.switch, port, payload.arp_reply).await {
                Ok(_) => {
                    let port = &state.pm.frontpanel_port(payload.pid);

                    if let Ok((port, _)) = port {
                        state.config.lock().await.update_arp_state(*port, payload.arp_reply);
                    }

                    StatusCode::CREATED.into_response()
                }
                Err(err) => {
                    (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
                }
            }
        }
        None => {
            (StatusCode::BAD_REQUEST, Json(Error::new(format!("PID {} is not configured.", payload.pid)))).into_response()
        }
    }
}