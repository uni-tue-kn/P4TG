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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */
use std::collections::{HashMap, HashSet};

use super::types::{RxMappingMode, Stream, StreamSetting};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExpectedStreamRoute {
    pub tx_dev_port: u32,
    pub rx_dev_port: u32,
    pub tx_front_panel_port: u32,
    pub tx_channel: u8,
    pub rx_front_panel_port: u32,
    pub rx_channel: u8,
    pub stream_id: u8,
    pub app_id: u8,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ExpectedTopology {
    pub routes: Vec<ExpectedStreamRoute>,
    pub tx_ports: HashSet<u32>,
    pub rx_ports: HashSet<u32>,
    pub edges: HashSet<(u32, u32)>,
}

/// Resolve active per-stream settings to front-panel and dev-port routes.
/// Port/channel availability is validated by the API before this is called.
pub fn resolve_per_stream_topology(
    mode: RxMappingMode,
    stream_settings: &[StreamSetting],
    streams: &[Stream],
    front_panel_dev_port_mappings: &HashMap<u32, u32>,
) -> Result<ExpectedTopology, String> {
    if mode != RxMappingMode::PerStream {
        return Ok(ExpectedTopology::default());
    }

    let mut stream_to_app = HashMap::new();
    for stream in streams {
        if stream_to_app
            .insert(stream.stream_id, stream.app_id)
            .is_some()
        {
            return Err(format!(
                "Stream ID {} is defined more than once.",
                stream.stream_id
            ));
        }
    }
    let mut seen = HashSet::new();
    let mut topology = ExpectedTopology::default();

    for setting in stream_settings.iter().filter(|setting| setting.active) {
        let tx_channel = setting.channel.unwrap_or(0);
        if !seen.insert((setting.port, tx_channel, setting.stream_id)) {
            return Err(format!(
                "Duplicate active stream setting for TX port {}/{tx_channel} and stream {}.",
                setting.port, setting.stream_id
            ));
        }

        let rx_target = setting.rx_target.ok_or_else(|| {
            format!(
                "Active stream {} on TX port {}/{tx_channel} requires an RX target in per-stream mapping mode.",
                setting.stream_id, setting.port
            )
        })?;
        let app_id = *stream_to_app.get(&setting.stream_id).ok_or_else(|| {
            format!(
                "No stream definition for active stream setting {}.",
                setting.stream_id
            )
        })?;
        let tx_base = *front_panel_dev_port_mappings
            .get(&setting.port)
            .ok_or_else(|| format!("No mapping for front panel TX port {}.", setting.port))?;
        let rx_base = *front_panel_dev_port_mappings
            .get(&rx_target.port)
            .ok_or_else(|| format!("No mapping for front panel RX port {}.", rx_target.port))?;
        let tx_dev_port = tx_base + tx_channel as u32;
        let rx_dev_port = rx_base + rx_target.channel as u32;

        topology.tx_ports.insert(tx_dev_port);
        topology.rx_ports.insert(rx_dev_port);
        topology.edges.insert((tx_dev_port, rx_dev_port));
        topology.routes.push(ExpectedStreamRoute {
            tx_dev_port,
            rx_dev_port,
            tx_front_panel_port: setting.port,
            tx_channel,
            rx_front_panel_port: rx_target.port,
            rx_channel: rx_target.channel,
            stream_id: setting.stream_id,
            app_id,
        });
    }

    Ok(topology)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::traffic_gen_core::types::{Encapsulation, Ethernet, GenerationUnit, RxTarget};

    fn stream(stream_id: u8, app_id: u8) -> Stream {
        Stream {
            stream_id,
            app_id,
            frame_size: 64,
            encapsulation: Encapsulation::None,
            number_of_lse: None,
            traffic_rate: 1.0,
            burst: 1,
            batches: None,
            n_packets: None,
            timeout: None,
            generation_accuracy: None,
            n_pipes: None,
            vxlan: false,
            gtpu: false,
            ip_version: Some(4),
            number_of_srv6_sids: None,
            srv6_ip_tunneling: None,
            unit: Some(GenerationUnit::Gbps),
            pattern: None,
            detnet_cw: None,
            detnet_seq_num_length: None,
            mna_post_stack: None,
        }
    }

    fn setting(stream_id: u8, rx_port: u32) -> StreamSetting {
        StreamSetting {
            port: 1,
            channel: Some(0),
            stream_id,
            rx_target: Some(RxTarget {
                port: rx_port,
                channel: 0,
            }),
            vlan: None,
            mpls_stack: None,
            srv6_base_header: None,
            sid_list: None,
            ethernet: Ethernet {
                eth_src: "00:00:00:00:00:01".into(),
                eth_dst: "00:00:00:00:00:02".into(),
            },
            ip: None,
            ipv6: None,
            active: true,
            vxlan: None,
            gtpu: None,
        }
    }

    #[test]
    fn resolves_split_routes_and_deduplicates_tx_role() {
        let mappings = HashMap::from([(1, 0), (2, 8), (3, 16)]);
        let topology = resolve_per_stream_topology(
            RxMappingMode::PerStream,
            &[setting(1, 2), setting(2, 3)],
            &[stream(1, 1), stream(2, 2)],
            &mappings,
        )
        .unwrap();

        assert_eq!(topology.routes.len(), 2);
        assert_eq!(topology.tx_ports, HashSet::from([0]));
        assert_eq!(topology.rx_ports, HashSet::from([8, 16]));
        assert_eq!(topology.edges, HashSet::from([(0, 8), (0, 16)]));
    }

    #[test]
    fn rejects_missing_target() {
        let mappings = HashMap::from([(1, 0)]);
        let mut missing = setting(1, 1);
        missing.rx_target = None;
        let error = resolve_per_stream_topology(
            RxMappingMode::PerStream,
            &[missing],
            &[stream(1, 1)],
            &mappings,
        )
        .unwrap_err();
        assert!(error.contains("requires an RX target"));
    }

    #[test]
    fn rejects_duplicate_active_setting() {
        let mappings = HashMap::from([(1, 0), (2, 8)]);
        let error = resolve_per_stream_topology(
            RxMappingMode::PerStream,
            &[setting(1, 2), setting(1, 2)],
            &[stream(1, 1)],
            &mappings,
        )
        .unwrap_err();
        assert!(error.contains("Duplicate active stream setting"));
    }
}
