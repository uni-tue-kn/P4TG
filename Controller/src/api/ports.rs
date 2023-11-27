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
use rbfrt::util::port_manager::Port;
use serde::{Deserialize, Serialize};
use crate::api::server::{Error};
use crate::AppState;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PortConfiguration {
    pid: u32,
    speed: rbfrt::util::port_manager::Speed,
    fec: rbfrt::util::port_manager::FEC,
    auto_neg: rbfrt::util::port_manager::AutoNegotiation
}

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
            let req = Port::new(port , channel)
                .speed(payload.speed.clone())
                .fec(payload.fec.clone())
                .auto_negotiation(payload.auto_neg.clone());

            return match pm.update_port(&state.switch, &req).await {
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