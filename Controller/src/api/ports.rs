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
use crate::api::server::Error;
use crate::core::traffic_gen_core::helper::{
    breakout_mapping, generate_front_panel_to_dev_port_mappings, get_base_speed,
};
use crate::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use rbfrt::util::{AutoNegotiation, Loopback, Port, Speed, FEC};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PortConfiguration {
    front_panel_port: u32,
    speed: Speed,
    fec: FEC,
    auto_neg: AutoNegotiation,
    breakout_mode: Option<u8>,
    channel: Option<u8>,
}

impl utoipa::ToSchema for PortConfiguration {
    fn name() -> std::borrow::Cow<'static, str> {
        std::borrow::Cow::Borrowed("Pet")
    }
}
impl utoipa::PartialSchema for PortConfiguration {
    fn schema() -> utoipa::openapi::RefOr<utoipa::openapi::schema::Schema> {
        utoipa::openapi::ObjectBuilder::new()
            .property(
                "pid",
                utoipa::openapi::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::Integer)
                    .format(Some(utoipa::openapi::SchemaFormat::KnownFormat(
                        utoipa::openapi::KnownFormat::Int32,
                    ))),
            )
            .required("id")
            .property(
                "speed",
                utoipa::openapi::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::String),
            )
            .required("speed")
            .property(
                "fec",
                utoipa::openapi::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::String),
            )
            .required("fec")
            .property(
                "auto_neg",
                utoipa::openapi::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::String),
            )
            .required("auto_neg")
            .into()
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct ArpReply {
    front_panel_port: u32,
    arp_reply: bool,
    breakout_mode: Option<u8>,
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
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Error::new(format!("{err:?}"))),
        )
            .into_response(),
    }
}

/// Configures a port
#[utoipa::path(
    post,
    path = "/api/ports",
    request_body(
        content = PortConfiguration,
        examples(("Example 1" = (summary = "Configure dev port 136 with 100G, no FEC, and auto negotiation.", value = json!(*docs::ports::EXAMPLE_POST_1_REQUEST))),
        )
    ),
    responses(
    (status = 200))
)]
pub async fn add_port(
    State(state): State<Arc<AppState>>,
    payload: Json<PortConfiguration>,
) -> Response {
    let pm = &state.pm;

    let front_panel_dev_port_mappings =
        generate_front_panel_to_dev_port_mappings(&state.port_mapping, state.tofino2);

    if !front_panel_dev_port_mappings.contains_key(&payload.front_panel_port) {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new(format!(
                "Port configuration for front panel port {:?} failed: Port not available",
                payload.front_panel_port
            ))),
        )
            .into_response();
    }

    let configured_base_speed = {
        let config = state.config.lock().await;
        config
            .tg_ports
            .iter()
            .find(|p| p.port == payload.front_panel_port)
            .map(|p| get_base_speed(p, state.tofino2))
    };

    if payload.breakout_mode.is_some() {
        let speed_allowed = if payload.breakout_mode == Some(8) {
            matches!(
                payload.speed,
                Speed::BF_SPEED_10G | Speed::BF_SPEED_25G | Speed::BF_SPEED_50G
            )
        } else {
            configured_base_speed.as_ref().is_some_and(|base_speed| {
                let (_, per_channel_speed, _) = breakout_mapping(base_speed, Some(4), state.tofino2);
                payload.speed == per_channel_speed
            })
        };

        if !speed_allowed {
            return (
                StatusCode::BAD_REQUEST,
                Json(Error::new(format!(
                    "Port speed {:?} is not available in breakout mode on port {}.",
                    payload.speed, payload.front_panel_port
                ))),
            )
                .into_response();
        }
    }

    let channel = payload.channel.unwrap_or(0);

    let mut req = Port::new(payload.front_panel_port, channel)
        .speed(payload.speed.clone())
        .fec(payload.fec.clone())
        .auto_negotiation(payload.auto_neg.clone());

    // 50G in breakout mode requires 1 lane (50G-R1)
    if payload.speed == Speed::BF_SPEED_50G && payload.breakout_mode.is_some() {
        req = req.n_lanes(1);
    }

    if state.loopback_mode {
        req = req.loopback(Loopback::BF_LPBK_MAC_NEAR);
    }

    match pm.update_port(&state.switch, &req).await {
        Ok(_) => StatusCode::CREATED.into_response(),
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Error::new(format!("{err:#?}"))),
        )
            .into_response(),
    }
}

pub async fn arp_reply(State(state): State<Arc<AppState>>, payload: Json<ArpReply>) -> Response {
    let mapping = &state.port_mapping;

    let front_panel_dev_port_mappings =
        generate_front_panel_to_dev_port_mappings(&state.port_mapping, state.tofino2);

    if !front_panel_dev_port_mappings.contains_key(&payload.front_panel_port) {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new(format!(
                "ARP configuration for front panel port {:?} failed: Port not available",
                payload.front_panel_port
            ))),
        )
            .into_response();
    }
    let dev_port = front_panel_dev_port_mappings
        .get(&payload.front_panel_port)
        .unwrap();

    match mapping.get(dev_port) {
        Some(port_mapping) => {
            match &state
                .arp_handler
                .modify_arp(
                    &state.switch,
                    port_mapping,
                    payload.arp_reply,
                    payload.breakout_mode,
                )
                .await
            {
                Ok(_) => {
                    state
                        .config
                        .lock()
                        .await
                        .update_arp_state(payload.front_panel_port, payload.arp_reply);

                    StatusCode::CREATED.into_response()
                }
                Err(err) => (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(Error::new(format!("{err:#?}"))),
                )
                    .into_response(),
            }
        }
        None => (
            StatusCode::BAD_REQUEST,
            Json(Error::new(format!(
                "Front panel port {} is not configured.",
                payload.front_panel_port
            ))),
        )
            .into_response(),
    }
}
