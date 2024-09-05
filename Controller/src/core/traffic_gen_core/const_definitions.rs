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

/// Table for internal traffic generation
pub const APP_CFG: &str = "tf1.pktgen.app_cfg";
pub const APP_CFG_TF2: &str = "tf2.pktgen.app_cfg";

/// Table for internal packet buffer
pub const APP_BUFFER_CFG: &str = "tf1.pktgen.pkt_buffer";
pub const APP_BUFFER_CFG_TF2: &str = "tf2.pktgen.pkt_buffer";

/// Table to activate internal traffic generation on ports
pub const PORT_CFG: &str = "tf1.pktgen.port_cfg";
pub const PORT_CFG_TF2: &str = "tf2.pktgen.port_cfg";

/// Source port used for P4TG based UDP packets
pub const P4TG_SOURCE_PORT: u16 = 50081;

/// Destination port used for P4TG based UDP packet.
/// This is used in the data plane to detect P4TG traffic.
pub const P4TG_DST_PORT: u16 = 50083;

/// Max time for the ILP solver that calculates the sending behaviour.
/// See [this method](TrafficGen::calculate_send_behaviour) for the solver.
pub const SOLVER_TIME_LIMIT_IN_SECONDS: f64 = 2f64;

/// Generation time in ns for the monitoring packet.
/// Each [MONITORING_PACKET_INTERVAL] ns, a monitoring packet is created.
pub const MONITORING_PACKET_INTERVAL: u32 = 500000000;

/// Multicast group ID for monitoring packet
pub const MONITORING_PACKET_MID: u16 = 1000;

/// This table initializes monitoring packets in the egress
/// after generation.
pub const MONITORING_INIT_TABLE: &str = "egress.monitor_init";

/// Forwarding table for monitoring packets in ingress.
/// This builds the correct forwarding path for monitoring packets.
pub const MONITORING_FORWARD_TABLE: &str = "ingress.p4tg.monitor_forward";

/// Triggers monitoring in egress for individual streams
pub const MONITORING_EGRESS_TABLE: &str = "egress.monitor_stream";

/// Indicates the current generation type
pub const TRAFFIC_GEN_MODE: &str = "ingress.tg_mode";

/// Table that indicates that a packet is on a front panel egress port.
/// If thats the case, the packet is timestamped for RTT calculation.
pub const IS_EGRESS_TABLE: &str = "egress.is_egress";

/// Table that indicates that a packet is on TX egress recirculation port.
/// Packets on this path have an additional 6 byte generation header that is removed
/// if this table matches.
pub const IS_TX_EGRESS_TABLE: &str = "egress.is_tx_recirc";

/// Table that contains the default forwarding from port to RX recirulation port
pub const DEFAULT_FORWARD_TABLE: &str = "ingress.p4tg.forward";

/// Table that contains the forwarding / multicast entries for generated stream traffic
pub const STREAM_FORWARD_TABLE: &str = "ingress.p4tg.tg_forward";

/// We use traffic generation on the two internal tg ports
pub const TG_PIPE_PORTS: [u16; 2] = [68, 196];
/// We use traffic generation on the four internal tg ports on tofino2
pub const TG_PIPE_PORTS_TF2: [u16; 4] = [6, 134, 262, 390];

/// Maximal traffic rate on tofino1 per port
pub const TG_MAX_RATE: f32 = 100f32;
/// Maximal traffic rate on tofino2 per port
pub const TG_MAX_RATE_TF2: f32 = 400f32;

/// Threshold in Gbps to use both generation pipes
pub const TWO_PIPE_GENERATION_THRESHOLD: f32 = 75.0;

/// Ethernet & IP header replace table
/// This table contains the IP & Ethernet header configuration for each stream
pub const ETHERNET_IP_HEADER_REPLACE_TABLE: &str = "egress.header_replace.header_replace";

/// VLAN replace table
/// This table replaces the header content of QinQ and VLAN frames
pub const VLAN_HEADER_REPLACE_TABLE: &str = "egress.header_replace.vlan_header_replace";

/// MPLS replace table
/// This table replaces the header content of the MPLS stack
pub const MPLS_HEADER_REPLACE_TABLE: &str = "egress.header_replace.mpls_rewrite_c.mpls_header_replace";

/// Maximal number of supported mpls labels
pub const MAX_NUM_MPLS_LABEL: u8 = 15;

/// VxLAN UDP port
pub const VX_LAN_UDP_PORT: u16 = 4789;

/// Max buffer size in bytes usable with P4TG
pub const MAX_BUFFER_SIZE: u32 = 12000;
