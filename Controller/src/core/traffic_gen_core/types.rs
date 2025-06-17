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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

use serde::{Deserialize, Serialize};
use serde_repr::{Deserialize_repr, Serialize_repr};
use std::collections::HashMap;
use std::net::Ipv4Addr;
use std::net::Ipv6Addr;
use utoipa::ToSchema;

use crate::core::statistics::RttHistogramConfig;

/// Describes the supported encapsulations of P4TG.
/// Currently, MPLS, VLAN, QinQ, and SRv6 are supported.
///
/// [Encapsulation::None] corresponds to plain Ethernet | IP packet.
#[derive(Serialize_repr, Deserialize_repr, PartialEq, Debug, Clone, Copy, ToSchema)]
#[repr(u8)]
pub enum Encapsulation {
    None = 0,
    Vlan = 1,
    QinQ = 2,
    Mpls = 3,
    SRv6 = 4,
}

/// Describes the used generation mode
#[derive(Serialize_repr, Deserialize_repr, PartialEq, Debug, Clone, Copy, ToSchema)]
#[repr(u8)]
pub enum GenerationMode {
    /// Constant bit rate
    Cbr = 1,
    /// Mega packets per second
    Mpps = 2,
    /// Poisson traffic
    /// This is traffic with random inter arrival times and models random traffic
    Poisson = 3,
    /// Analyze mode. In this mode, traffic is not generated and external traffic is forwarded and analyzed.
    Analyze = 4,
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
    pub timer: u32,
    /// Increases the burstiness resulting in a more accurate rate. Has no effect if in IAT mode.
    pub batches: bool,
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
    pub app_id: u8,
}

/// Defines an VxLAN Tunnel
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct VxLAN {
    /// Outer Ethernet src
    #[schema(example = "00:d0:67:a2:a9:42")]
    pub eth_src: String,
    /// Outer Ethernet dst
    #[schema(example = "d6:67:75:a1:94:c3")]
    pub eth_dst: String,
    /// Outer IP src
    #[schema(example = "192.168.178.10")]
    #[schema(value_type = String)]
    pub ip_src: Ipv4Addr,
    /// Outer IP dst
    #[schema(example = "192.168.178.5")]
    #[schema(value_type = String)]
    pub ip_dst: Ipv4Addr,
    /// Outer IP tos
    pub ip_tos: u8,
    /// Outer UDP source
    pub udp_source: u16,
    /// VxLAN VNI
    pub vni: u32,
}

/// Defines an MPLS LSE
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct MPLSHeader {
    /// Label of this MPLS LSE
    pub label: u32,
    /// Traffic class field of this MPLS LSE
    pub tc: u32,
    /// Time-to-live of this MPLS LSE
    pub ttl: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
#[serde(untagged)]
pub enum TrafficGenTests {
    SingleTest(TrafficGenData),
    MultipleTest(Vec<TrafficGenData>),
}

/// Represents the body of the GET / POST endpoints of /trafficgen
#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct TrafficGenData {
    /// Generation mode that should be used.
    pub(crate) mode: GenerationMode,
    /// List of stream settings that should be applied.
    /// This also configures which streams are replicated to which ports.
    pub(crate) stream_settings: Vec<StreamSetting>,
    pub(crate) streams: Vec<Stream>,
    /// Mapping between TX (send) ports, and RX (receive) ports.
    /// Traffic send on port TX are expected to be received on port RX.
    pub(crate) port_tx_rx_mapping: HashMap<String, u32>,
    /// The duration of this test in seconds.
    pub(crate) duration: Option<u32>,
    /// Mapping between RX port and histogram config.
    pub(crate) histogram_config: Option<HashMap<String, RttHistogramConfig>>,
    /// The name of the test. This is used to identify the test in the UI.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) name: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct Vlan {
    pub vlan_id: u16,
    pub pcp: u8,
    pub dei: u8,
    pub inner_vlan_id: u16,
    pub inner_pcp: u8,
    pub inner_dei: u8,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct Ethernet {
    /// Source Ethernet mac
    #[schema(example = "00:d0:67:a2:a9:42")]
    pub eth_src: String,
    /// Destination Ethernet mac
    #[schema(example = "d6:67:75:a1:94:c3")]
    pub eth_dst: String,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct IPv4 {
    /// Source IPv4 address
    #[schema(example = "192.168.178.10")]
    #[schema(value_type = String)]
    pub ip_src: Ipv4Addr,
    /// Destination IPv4 address
    #[schema(example = "192.168.178.10")]
    #[schema(value_type = String)]
    pub ip_dst: Ipv4Addr,
    pub ip_tos: u8,
    /// Mask that is used to randomize the IP src address.
    /// 255.255.255.255 means that all bytes in the IP address are randomized.
    #[schema(example = "255.0.0.0")]
    #[schema(value_type = String)]
    pub ip_src_mask: Ipv4Addr,
    /// Mask that is used to randomize the IP dst address.
    /// 255.255.255.255 means that all bytes in the IP address are randomized.
    #[schema(example = "255.0.0.0")]
    #[schema(value_type = String)]
    pub ip_dst_mask: Ipv4Addr,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct IPv6 {
    /// Source IPv6 address
    #[schema(example = "fe80::1766:cf5:f031:eba3")]
    #[schema(value_type = String)]
    pub ipv6_src: Ipv6Addr,
    /// Destination IPv4 address
    #[schema(example = "fe80::1766:cf5:f031:eba3")]
    #[schema(value_type = String)]
    pub ipv6_dst: Ipv6Addr,
    pub ipv6_traffic_class: u8,
    /// Mask that is used to randomize the IP src address. The 48 least-significant bits can be randomized.
    /// ::ff:ffff:ffff means that the 48 least significant bits in the IP address are randomized.
    #[schema(example = "::ff")]
    #[schema(value_type = String)]
    pub ipv6_src_mask: Ipv6Addr,
    /// Mask that is used to randomize the IP dst address. The 48 least-significant bits can be randomized.
    /// ::ff:ffff:ffff means that the 48 least significant bits in the IP address are randomized.
    #[schema(example = "::ff")]
    #[schema(value_type = String)]
    pub ipv6_dst_mask: Ipv6Addr,
    pub ipv6_flow_label: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct StreamSetting {
    /// Egress port to which the stream should be sent.
    pub port: u32,
    /// ID of the stream. This stream_id maps to the stream_id in the Stream description.
    pub stream_id: u8,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vlan: Option<Vlan>,
    /// An MPLS stack to be combined with Encapsulation = MPLS. The length of the MPLS stack has to equal the number_of_lse parameter in each Stream.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mpls_stack: Option<Vec<MPLSHeader>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub srv6_base_header: Option<IPv6>,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[schema(value_type = Vec<String>, format = "ipv6", example="ff80::1")]
    pub sid_list: Option<Vec<Ipv6Addr>>,
    pub ethernet: Ethernet,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ip: Option<IPv4>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub ipv6: Option<IPv6>,
    /// Indicates if this stream setting is active.
    pub active: bool,
    /// VxLAN tunnel settings
    #[serde(skip_serializing_if = "Option::is_none")]
    pub vxlan: Option<VxLAN>,
}

#[derive(Serialize, Deserialize, Debug, Clone, ToSchema)]
pub struct Stream {
    /// Identifies the stream. The same value is used in stream settings to
    /// configure that stream for an individual port
    pub(crate) stream_id: u8,
    /// Application id number. This number is used to configure the traffic generator.
    /// App ids 1-7 are possible for streams.
    pub(crate) app_id: u8,
    /// L2 frame size of the stream.
    #[schema(example = 64)]
    pub(crate) frame_size: u32,
    /// Encapsulation type.
    #[schema(example = Encapsulation::MPLS)]
    pub(crate) encapsulation: Encapsulation,
    /// Number of MPLS LSEs in this stream. The value has to equal the length of the MPLS stack in a stream setting.
    #[schema(example = 2)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) number_of_lse: Option<u8>,
    /// Traffic rate in Gbps that should be generated.
    #[schema(example = 100)]
    pub(crate) traffic_rate: f32,
    /// Maximal allowed burst (= packets). Burst = 1 is used for IAT precision mode, Burst = 100 for Rate precision.
    #[schema(example = 100)]
    pub(crate) burst: u16,
    /// Sends more bursty traffic resulting in a more accurate rate
    #[schema(example = true)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) batches: Option<bool>,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    #[schema(example = 11)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) n_packets: Option<u16>,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    #[schema(example = 81)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) timeout: Option<u32>,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    #[schema(example = 99.95)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) generation_accuracy: Option<f32>,
    /// These values are set by P4TG when the stream is generated to indicate the applied configuration.
    #[schema(example = 2)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) n_pipes: Option<u8>,
    /// Flag that indicates if traffic should be encapsulation in VxLAN
    #[schema(example = false)]
    pub(crate) vxlan: bool,
    /// Determines the IP version, either v4 or v6. Option to make it backward compatible
    #[schema(example = 4)]
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) ip_version: Option<u8>,
    /// Number of SIDs in SRv6 header. At maximum 4 can be used.
    #[schema(example = 2)]
    #[serde(skip_serializing_if = "Option::is_none")]
    /// A flag to indicate if there is another IP tunnel following the SRv6 headers
    pub(crate) number_of_srv6_sids: Option<u8>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub srv6_ip_tunneling: Option<bool>,
}

#[derive(Serialize, ToSchema)]
pub struct EmptyResponse {
    #[schema(example = "Not running.")]
    pub(crate) message: String,
}

#[derive(Serialize, ToSchema)]
pub struct Reset {
    pub(crate) message: String,
}
