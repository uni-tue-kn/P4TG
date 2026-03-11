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
    generate_front_panel_to_dev_port_mappings, resolve_front_panel_mode, sanitize_fec,
};
use crate::AppState;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::warn;
use macaddr::MacAddr;
use rbfrt::util::{AutoNegotiation, Loopback, Port, Speed, FEC};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::str::FromStr;
use std::sync::Arc;

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct PortConfiguration {
    front_panel_port: u32,
    speed: Speed,
    fec: FEC,
    auto_neg: AutoNegotiation,
    channel_count: Option<u8>,
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
                "channel_count",
                utoipa::openapi::ObjectBuilder::new()
                    .schema_type(utoipa::openapi::schema::Type::Integer)
                    .format(Some(utoipa::openapi::SchemaFormat::KnownFormat(
                        utoipa::openapi::KnownFormat::Int32,
                    ))),
            )
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
    channel: Option<u8>,
    mac: Option<String>,
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

    let Some(resolved_mode) =
        resolve_front_panel_mode(&payload.speed, payload.channel_count, state.tofino2)
    else {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new(format!(
                "Port {} does not support speed {:?} with channel_count {}.",
                payload.front_panel_port,
                payload.speed,
                payload.channel_count.unwrap_or(1)
            ))),
        )
            .into_response();
    };

    let current_channels: BTreeSet<u8> = state
        .port_mapping
        .values()
        .filter(|entry| entry.front_panel_port == payload.front_panel_port)
        .map(|entry| entry.channel)
        .collect();
    let requested_channels: BTreeSet<u8> = resolved_mode.channels.iter().copied().collect();

    if !current_channels.is_empty() && current_channels != requested_channels {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new(format!(
                "Port {} cannot switch to speed {:?} at runtime because it would change the active channel layout from {:?} to {:?}. Update config.json and restart the controller.",
                payload.front_panel_port,
                payload.speed,
                current_channels,
                requested_channels
            ))),
        )
            .into_response();
    }

    let channel = payload.channel.unwrap_or(0);
    if !resolved_mode.channels.contains(&channel) {
        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new(format!(
                "Channel {} is not available for port {} with channel_count {}.",
                channel,
                payload.front_panel_port,
                payload.channel_count.unwrap_or(1)
            ))),
        )
            .into_response();
    }

    let fec = sanitize_fec(&payload.speed, payload.channel_count, payload.fec.clone());

    let mut req = Port::new(payload.front_panel_port, channel)
        .speed(payload.speed.clone())
        .fec(fec)
        .auto_negotiation(payload.auto_neg.clone());

    if let Some(n_lanes) = resolved_mode.n_lanes {
        req = req.n_lanes(n_lanes);
    }

    if state.loopback_mode {
        req = req.loopback(Loopback::BF_LPBK_MAC_NEAR);
    }

    match pm.update_port(&state.switch, &req).await {
        Ok(_) => {
            warn_on_mixed_breakout_rates(
                pm,
                &state.switch,
                payload.front_panel_port,
                payload.channel_count,
            )
            .await;

            StatusCode::CREATED.into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Error::new(format!("{err:#?}"))),
        )
            .into_response(),
    }
}

async fn warn_on_mixed_breakout_rates(
    pm: &rbfrt::util::PortManager,
    switch: &rbfrt::SwitchConnection,
    front_panel_port: u32,
    channel_count: Option<u8>,
) {
    let Some(channel_count) = channel_count else {
        return;
    };

    if channel_count <= 1 {
        return;
    }

    let Ok(ports) = pm.get_ports(switch).await else {
        return;
    };

    let mut active_speeds = BTreeSet::new();

    for port in ports.into_iter().filter(|port| {
        let (port_number, channel) = port.get_frontpanel_port();
        port_number == front_panel_port && channel < channel_count
    }) {
        active_speeds.insert(format!("{:?}", port.get_speed()));
    }

    if active_speeds.len() > 1 {
        warn!(
            "Warning: Mixed breakout rates on a single front-panel port may link up but can cause packet loss under load. Prefer homogeneous breakout operation."
        );
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
    let mut target_mappings: Vec<_> = mapping
        .values()
        .filter(|entry| entry.front_panel_port == payload.front_panel_port)
        .filter(|entry| {
            payload
                .channel
                .is_none_or(|channel| entry.channel == channel)
        })
        .cloned()
        .collect();

    target_mappings.sort_by_key(|entry| entry.channel);

    if target_mappings.is_empty() {
        if let Some(channel) = payload.channel {
            return (
                StatusCode::BAD_REQUEST,
                Json(Error::new(format!(
                    "Front panel port {} with channel {} is not configured.",
                    payload.front_panel_port, channel
                ))),
            )
                .into_response();
        }

        return (
            StatusCode::BAD_REQUEST,
            Json(Error::new(format!(
                "Front panel port {} is not configured.",
                payload.front_panel_port
            ))),
        )
            .into_response();
    }

    let mac = if let Some(mac_string) = payload.mac.as_deref() {
        match MacAddr::from_str(mac_string) {
            Ok(mac) => mac,
            Err(_) => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(Error::new(format!(
                        "MAC address '{}' is not valid for front panel port {}.",
                        mac_string, payload.front_panel_port
                    ))),
                )
                    .into_response();
            }
        }
    } else {
        let configured_mac = state
            .config
            .lock()
            .await
            .get_mac_state(payload.front_panel_port, payload.channel);

        match configured_mac
            .as_deref()
            .and_then(|m| MacAddr::from_str(m).ok())
        {
            Some(mac) => mac,
            None => {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(Error::new(format!(
                        "No valid MAC address is configured for front panel port {}.",
                        payload.front_panel_port
                    ))),
                )
                    .into_response();
            }
        }
    };

    match &state
        .arp_handler
        .modify_arp(&state.switch, &target_mappings, payload.arp_reply, mac)
        .await
    {
        Ok(_) => {
            let mut config = state.config.lock().await;
            config.update_arp_state(payload.front_panel_port, payload.channel, payload.arp_reply);
            if let Some(mac) = payload.mac.clone() {
                config.update_mac_state(payload.front_panel_port, payload.channel, mac);
            }

            StatusCode::CREATED.into_response()
        }
        Err(err) => (
            StatusCode::INTERNAL_SERVER_ERROR,
            Json(Error::new(format!("{err:#?}"))),
        )
            .into_response(),
    }
}
