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

use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::sync::Arc;
use std::time::SystemTime;
use axum::debug_handler;
use axum::extract::State;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Json, Response};
use log::info;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use crate::api::helper::validate::validate_request;

use crate::api::server::Error;
use crate::AppState;
use crate::core::traffic_gen_core::types::{Encapsulation, GenerationMode};

/// Defines an MPLS LSE
#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
pub struct MPLSHeader {
    /// Label of this MPLS LSE
    pub label: u32,
    /// Traffic class field of this MPLS LSE
    pub tc: u32,
    /// Time-to-live of this MPLS LSE
    pub ttl: u32
}

/// Represents the body of the GET / POST endpoints of /trafficgen
#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
pub struct TrafficGenData {
    /// Generation mode that should be used.
    pub(crate) mode: GenerationMode,
    /// List of stream settings that should be applied.
    /// This also configures which streams are replicated to which ports.
    pub(crate) stream_settings: Vec<StreamSetting>,
    pub(crate) streams: Vec<Stream>,
    /// Mapping between TX (send) ports, and RX (receive) ports.
    /// Traffic send on port TX are expected to be received on port RX.
    pub(crate) port_tx_rx_mapping: HashMap<u32, u32>
}

#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
pub struct StreamSetting {
    /// Egress port to which the stream should be sent.
    pub port: u32,
    /// ID of the stream. This stream_id maps to the stream_id in the Stream description.
    pub stream_id: u8,
    pub vlan_id: u16,
    pub pcp: u8,
    pub dei: u8,
    pub inner_vlan_id: u16,
    pub inner_pcp: u8,
    /// An MPLS stack to be combined with Encapsulation = MPLS. The length of the MPLS stack has to equal the number_of_lse parameter in each Stream.
    pub mpls_stack: Vec<MPLSHeader>,
    pub inner_dei: u8,
    pub eth_src: String,
    pub eth_dst: String,
    pub ip_src: Ipv4Addr,
    pub ip_dst: Ipv4Addr,
    pub ip_tos: u8,
    /// Mask that is used to randomize the IP src address.
    /// 255.255.255.255 means that all bytes in the IP address are randomized.
    pub ip_src_mask: Ipv4Addr,
    /// Mask that is used to randomize the IP dst address.
    /// 255.255.255.255 means that all bytes in the IP address are randomized.
    pub ip_dst_mask: Ipv4Addr,
    /// Indicates if this stream setting is active.
    pub active: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, JsonSchema)]
pub struct Stream {
    /// Identifies the stream. The same value is used in stream settings to
    /// configure that stream for an individual port
    pub(crate) stream_id: u8,
    /// Application id number. This number is used to configure the traffic generator.
    /// App ids 1-7 are possible for streams.
    pub(crate) app_id: u8,
    /// L2 frame size of the stream.
    pub(crate) frame_size: u32,
    /// Encapsulation type.
    pub(crate) encapsulation: Encapsulation,
    /// Number of MPLS LSEs in this stream. The value has to equal the length of the MPLS stack in a stream setting.
    pub(crate) number_of_lse: u8,
    /// Traffic rate in Gbps that should be generated.
    pub(crate) traffic_rate: f32,
    /// Maximal allowed burst (= packets). Burst = 1 is used for IAT precision mode, Burst = 100 for Rate precision.
    pub(crate) burst: u16,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    pub(crate) n_packets: Option<u16>,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    pub(crate) timeout: Option<u32>,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    pub(crate) generation_accuracy: Option<f32>,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    pub(crate) n_pipes: Option<u8>,
}

#[derive(Serialize, JsonSchema)]
pub struct EmptyResponse {
    pub(crate) message: String
}

/// Method called on GET /trafficgen
pub async fn traffic_gen(State(state): State<Arc<AppState>>) -> Response {
    let tg = &state.traffic_generator.lock().await;

    if !tg.running {
        (StatusCode::ACCEPTED, Json(EmptyResponse{message: "Not running.".to_string()})).into_response()
    }
    else {
        let tg_data = TrafficGenData {
            mode: tg.mode.clone(),
            stream_settings: tg.stream_settings.clone(),
            streams: tg.streams.clone(),
            port_tx_rx_mapping: tg.port_mapping.clone()
        };

        (StatusCode::OK, Json(tg_data)).into_response()
    }
}



/// Represents the result of a stream optimization.
#[derive(Serialize)]
pub struct Result {
    /// Number of packets that are sent per `timeout`
    n_packets: u16,
    /// Timeout in ns until `n_packets` are generated
    timeout: u32,
    /// Target rate that should be generated.
    rate: f64,
    /// Rate accuracy according to `n_packets` and `timeout`
    rate_accuracy: f32,
}

/// Method called on POST /trafficgen
#[debug_handler]
pub async fn configure_traffic_gen(State(state): State<Arc<AppState>>, payload: Json<TrafficGenData>) -> Response {
    let tg = &mut state.traffic_generator.lock().await;

    // contains the description of the stream, i.e., packet size and rate
    // only look at active stream settings
    let active_stream_settings: Vec<StreamSetting> = payload.stream_settings.clone().into_iter().filter(|s| s.active).collect();
    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = payload.streams.clone().into_iter().filter(|s| active_stream_ids.contains(&s.stream_id)).collect();

    // Poisson traffic is only allowed to have a single stream
    if payload.mode == GenerationMode::POISSON {
        if active_streams.len() != 1 {
            return (StatusCode::BAD_REQUEST, Json(Error::new(format!("Poisson generation mode only allows for one stream.")))).into_response()
        }
    }

    // overall rate
    let rate: f32 = active_streams.iter().map(|x| x.traffic_rate).sum();

    // at most 100 Gbps are supported
    if rate > 100f32 {
        return (StatusCode::BAD_REQUEST, Json(Error::new(format!("Traffic rate in sum larger than 100 Gbps.")))).into_response();
    }

    // no streams should be generated in monitor/analyze mode
    if payload.mode == GenerationMode::ANALYZE && active_streams.len() != 0 {
        return (StatusCode::BAD_REQUEST, Json(Error::new(format!("No stream definition in analyze mode allowed.")))).into_response();
    }

    // contains the mapping of Send->Receive ports
    // required for analyze mode
    let port_mapping = &payload.port_tx_rx_mapping;

    // validate request
    match validate_request(&active_streams, &active_stream_settings) {
        Ok(_) => {},
        Err(e) => return (StatusCode::BAD_REQUEST, Json(e)).into_response()
    }

    match tg.start_traffic_generation(&state, active_streams, payload.mode, active_stream_settings, port_mapping).await {
        Ok(streams) => {
            // store the settings for synchronization between multiple
            // GUI clients
            tg.port_mapping = payload.port_tx_rx_mapping.clone();
            tg.stream_settings = payload.stream_settings.clone();
            tg.streams = payload.streams.clone();
            tg.mode = payload.mode.clone();

            // experiment starts now
            // these values are used to show how long the experiment is running at the GUI
            state.experiment.lock().await.start = SystemTime::now();
            state.experiment.lock().await.running = true;

            info!("Traffic generation started.");
            (StatusCode::OK, Json(streams)).into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
    }
}

/// Stops the current traffic generation
pub async fn stop_traffic_gen(State(state): State<Arc<AppState>>) -> Response {
    let tg = &state.traffic_generator;
    let switch = &state.switch;

    match tg.lock().await.stop(switch).await {
        Ok(_) => {
            info!("Traffic generation stopped.");
            state.experiment.lock().await.running = false;
            StatusCode::OK.into_response()
        }
        Err(err) => (StatusCode::INTERNAL_SERVER_ERROR, Json(Error::new(format!("{:#?}", err)))).into_response()
    }
}