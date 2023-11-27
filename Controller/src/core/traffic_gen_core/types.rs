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

use schemars::JsonSchema;
use serde_repr::{Deserialize_repr, Serialize_repr};

/// Describes the supported encapsulations of P4TG.
/// Currently, only VLAN and QinQ are supported.
///
/// [Encapsulation::None] corresponds to plain Ethernet | IPv4 packet.
#[derive(Serialize_repr, Deserialize_repr, PartialEq, Debug, Clone, Copy, JsonSchema)]
#[repr(u8)]
pub enum Encapsulation {
    None = 0,
    VLAN = 1,
    QinQ = 2,
}

/// Describes the used generation mode
#[derive(Serialize_repr, Deserialize_repr, PartialEq, Debug, Clone, Copy, JsonSchema)]
#[repr(u8)]
pub enum GenerationMode {
    /// Constant bit rate
    CBR = 1,
    /// Mega packets per second
    MPPS = 2,
    /// Poisson traffic
    /// This is traffic with random inter arrival times and models random traffic
    POISSON = 3,
    /// Analyze mode. In this mode, traffic is not generated and external traffic is forwarded and analyzed.
    ANALYZE = 4
}

/// Byte representation of a packet for traffic gen application
/// with id `app_id`.
#[derive(Debug, Clone)]
pub struct StreamPacket {
    pub app_id: u8,
    pub bytes: Vec<u8>,
    /// Offset (bytes) in the internal table that points to the start of the packet
    pub buffer_offset: Option<u32>,
    /// Number of packets that are sent for this stream
    pub n_packets: u16,
    /// Timeout for the packet generation
    pub timer: u32
}

/// Represents a Monitoring mapping
/// The index is associated to a specific `app_id` on a specific `port`.
/// This is used to monitor stream-based traffic rates in the data plane.
/// There is a unique index per (`port`, `app_id`) combination.
#[derive(Debug, Clone)]
pub struct MonitoringMapping {
    /// index that is used in the data plane to access the app rate register
    pub index: u32,
    /// port that the index corresponds to
    pub port: u32,
    /// app_id that the index corresponds to
    pub app_id: u8
}