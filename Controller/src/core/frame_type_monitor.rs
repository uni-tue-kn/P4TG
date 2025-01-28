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
use std::net::{Ipv4Addr, Ipv6Addr};
use std::sync::Arc;
use std::time::Duration;
use async_trait::async_trait;
use rbfrt::error::RBFRTError;
use rbfrt::{SwitchConnection, table};
use rbfrt::table::{MatchValue, ToBytes};
use crate::{AppState, PortMapping};

use log::{info, warn};
use crate::core::traffic_gen_core::types::GenerationMode;
use crate::core::statistics::{FrameTypeStatistics, TypeCount};
use crate::core::traffic_gen_core::event::TrafficGenEvent;

const FRAME_TYPE_MONITOR: &str = "ingress.p4tg.frame_type.frame_type_monitor";
const ETHERNET_TYPE_MONITOR: &str = "ingress.p4tg.frame_type.ethernet_type_monitor";

const ACTION_PREFIX: &str = "ingress.p4tg.frame_type";

/// This module handles the initialization of the `egress.frame_size_monitor` table
/// that counts the different frame sizes that are received/sent
pub struct FrameTypeMonitor {
    port_mapping: HashMap<u32, PortMapping>,
    /// (IP adress, LPM, VxLAN flag, action)
    ip_ternary_entries: Vec<([u8; 4], u32, u8, String)>,
    ipv6_ternary_entries: Vec<([u16; 8], u128, u8, String)>,
    /// (Ethertype, Action)
    ethernet_types: Vec<(u16, String)>,
    pub statistics: FrameTypeStatistics
}

impl FrameTypeMonitor {
    pub fn new(port_mapping: HashMap<u32, PortMapping>) -> FrameTypeMonitor {
        // IP address as ternary to either match on IPv4 or IPv6
        let ip_ternary_entries = vec![([224, 0, 0, 0], 8, 0, "multicast".to_owned()), ([0, 0, 0, 0],0 , 0, "unicast".to_owned()), ([0, 0, 0, 0], 0, 1, "vxlan".to_owned())];
        let ipv6_ternary_entries = vec![([65280, 0, 0, 0, 0, 0, 0, 0], 8, 0, "multicast".to_owned())]; // Only multicast needed here, other cases are handled implicitly through ternary
        let ethernet_types = vec![(0x800, "ipv4".to_owned()), (0x86DD, "ipv6".to_owned()), (0x8100, "vlan".to_owned()), (0x88a8, "q_in_q".to_owned()), (0x0806, "arp".to_owned()), (0x8847, "mpls".to_owned())];
        FrameTypeMonitor {port_mapping, ip_ternary_entries, ipv6_ternary_entries, ethernet_types, statistics: FrameTypeStatistics::default() }
    }

    /// Configures the frame type monitor table in the ingress pipeline.
    /// It first clears the table, then rewrites it.
    pub async fn configure(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        // First clear table and then rewrite it
        self.clear(switch).await?;

        let mut table_entries_frame_type = vec![];
        let mut table_entries_ethernet_type = vec![];

        // build table requests
        // we used batched execution
        for (_, mapping) in self.port_mapping.iter().by_ref() {
            // frame type (IPv4)
            for (base, lpm, vxlan, action) in &self.ip_ternary_entries {

                // Represent LPM as ternary mask
                let mask = if *lpm == 0u32 {0} else {((1u32 << lpm) - 1) << (32 - lpm)};
                let priority: i32 = if *lpm == 0 {1} else {0};
                // table entry for the TX path
                let tx_add_request = table::Request::new(FRAME_TYPE_MONITOR)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.tx_recirculation))
                    .match_key("hdr.inner_ipv4.dst_addr", MatchValue::ternary(Ipv4Addr::from(*base), Ipv4Addr::from(mask)))
                    .match_key("hdr.ipv6.dst_addr", MatchValue::ternary(0, 0))  // Ignore IPv6 address in this case
                    .match_key("ig_md.vxlan", MatchValue::exact(*vxlan))
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                    .action(&format!("{}.{}", ACTION_PREFIX, action));

                // table entry for the RX path
                let rx_add_request = table::Request::new(FRAME_TYPE_MONITOR)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.rx_recirculation))
                    .match_key("hdr.inner_ipv4.dst_addr", MatchValue::ternary(Ipv4Addr::from(*base), Ipv4Addr::from(mask)))
                    .match_key("hdr.ipv6.dst_addr", MatchValue::ternary(0, 0))  // Ignore IPv6 address in this case
                    .match_key("ig_md.vxlan", MatchValue::exact(*vxlan))
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                    .action(&format!("{}.{}", ACTION_PREFIX, action));

                table_entries_frame_type.push(tx_add_request);
                table_entries_frame_type.push(rx_add_request);
            }

            // frame type (IPv6)
            for (base, lpm, vxlan, action) in &self.ipv6_ternary_entries {
                let mask = if *lpm == 0u128 {0} else {((1u128 << lpm) - 1) << (128 - lpm)};
                let priority: i32 = if *lpm == 0 {1} else {0};

                // table entry for the TX path
                let tx_add_request = table::Request::new(FRAME_TYPE_MONITOR)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.tx_recirculation))
                    .match_key("hdr.inner_ipv4.dst_addr", MatchValue::ternary(0, 0)) // Ignore IPv4 address in this case
                    .match_key("hdr.ipv6.dst_addr", MatchValue::ternary(Ipv6Addr::from(*base), Ipv6Addr::from(mask)))  
                    .match_key("ig_md.vxlan", MatchValue::exact(*vxlan))
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                    .action(&format!("{}.{}", ACTION_PREFIX, action));

                // table entry for the RX path
                let rx_add_request = table::Request::new(FRAME_TYPE_MONITOR)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.rx_recirculation))
                    .match_key("hdr.inner_ipv4.dst_addr", MatchValue::ternary(0,0)) // Ignore IPv4 address in this case
                    .match_key("hdr.ipv6.dst_addr", MatchValue::ternary(Ipv6Addr::from(*base), Ipv6Addr::from(mask)))  
                    .match_key("ig_md.vxlan", MatchValue::exact(*vxlan))
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                    .action(&format!("{}.{}", ACTION_PREFIX, action));

                table_entries_frame_type.push(tx_add_request);
                table_entries_frame_type.push(rx_add_request);
            }            

            // ethernet type
            for (ether_type, action) in &self.ethernet_types {
                // table entry for the TX path
                let tx_add_request = table::Request::new(ETHERNET_TYPE_MONITOR)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.tx_recirculation))
                    .match_key("hdr.ethernet.ether_type", MatchValue::lpm(*ether_type, 16))
                    .action(&format!("{}.{}", ACTION_PREFIX, action));

                // table entry for the RX path
                let rx_add_request = table::Request::new(ETHERNET_TYPE_MONITOR)
                    .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.rx_recirculation))
                    .match_key("hdr.ethernet.ether_type", MatchValue::lpm(*ether_type, 16))
                    .action(&format!("{}.{}", ACTION_PREFIX, action));

                table_entries_ethernet_type.push(tx_add_request);
                table_entries_ethernet_type.push(rx_add_request);
            }

            // default ethernet rules
            let default_tx_ethernet_rule = table::Request::new(ETHERNET_TYPE_MONITOR)
                .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.tx_recirculation))
                .match_key("hdr.ethernet.ether_type", MatchValue::lpm(0, 0))
                .action(&format!("{}.{}", ACTION_PREFIX, "unknown"));

            let default_rx_ethernet_rule = table::Request::new(ETHERNET_TYPE_MONITOR)
                .match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.rx_recirculation))
                .match_key("hdr.ethernet.ether_type", MatchValue::lpm(0, 0))
                .action(&format!("{}.{}", ACTION_PREFIX, "unknown"));

            table_entries_ethernet_type.push(default_tx_ethernet_rule);
            table_entries_ethernet_type.push(default_rx_ethernet_rule);
        }

        // dispatch all at once
        info!("Configure table {}.", FRAME_TYPE_MONITOR);
        switch.write_table_entries(table_entries_frame_type).await?;

        info!("Configure table {}.", ETHERNET_TYPE_MONITOR);
        switch.write_table_entries(table_entries_ethernet_type).await?;

        Ok(())
    }

    /// Computes the statistics for the configuration GUI.
    ///
    /// - `switch`: connection to the switch
    pub async fn monitor_statistics(state: Arc<AppState>)  {
        loop {
            let mut stats = FrameTypeStatistics::default();

            let mut tx_mapping: HashMap<u32, u32> = HashMap::new();
            let mut rx_mapping: HashMap<u32, u32> = HashMap::new();

            for (port, mapping) in state.port_mapping.iter().by_ref() {
                tx_mapping.insert(mapping.tx_recirculation, *port);
                rx_mapping.insert(mapping.rx_recirculation, *port);
                stats.frame_type_data.insert(*port, TypeCount::default());
            }

            for t in [FRAME_TYPE_MONITOR, ETHERNET_TYPE_MONITOR] {
                let request = table::Request::new(t);
                let sync = table::Request::new(t).operation(table::TableOperation::SyncCounters);

                let entries = {
                    // sync counters
                    let switch = &state.switch;

                    if switch.execute_operation(sync).await.is_err() {
                        warn! {"Encountered error while synchronizing {}.", t};
                    }

                    // read counters
                    match switch.get_table_entry(request).await {
                        Ok(e) => e,
                        Err(err) => {
                            warn! {"Encountered error while retrieving {} table. Error: {}", t, format!("{:#?}", err)};
                            vec![]
                        }
                    }

                };

                for entry in entries {
                    if !entry.match_key.contains_key("ig_intr_md.ingress_port") { // filter out default entry
                        continue;
                    }

                    let port = entry.match_key.get("ig_intr_md.ingress_port").unwrap().get_exact_value().to_u32();

                    let frame_type: Vec<&str> = entry.get_action_name().split('.').collect();
                    let mut frame_type = frame_type.last().unwrap().to_owned();

                    if frame_type == "q_in_q" {
                        frame_type = "qinq";
                    }

                    let count = 'get_count: {
                        for action in &entry.action_data {
                            if action.get_name() == "$COUNTER_SPEC_PKTS" {
                                break 'get_count action.get_data().to_u128();
                            }
                        }
                        
                        panic!("$COUNTER_SPEC_PKTS missing in {:#?}", entry)
                    };

                    if tx_mapping.contains_key(&port) {
                        let port = tx_mapping.get(&port).unwrap();
                        // For multicast, there are two entries (IPv4 and IPv6). Therefore, accumulate the data
                        stats.frame_type_data.get_mut(port).unwrap().tx.entry(frame_type.to_owned())
                                                                        .and_modify(|e| *e += count)
                                                                        .or_insert(count);
                        //insert(frame_type.to_owned(), count);
                    } else if rx_mapping.contains_key(&port) {
                        let port = rx_mapping.get(&port).unwrap();
                        stats.frame_type_data.get_mut(port).unwrap().tx.entry(frame_type.to_owned())
                                                                        .and_modify(|e| *e += count)
                                                                        .or_insert(count);
                    }
                }
            }

            {
                let frame_type_state = &mut state.frame_type_monitor.lock().await;
                frame_type_state.statistics = stats;
            }

            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }

    /// Clear the frame type table
    pub async fn clear(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        switch.clear_tables(vec![FRAME_TYPE_MONITOR, ETHERNET_TYPE_MONITOR]).await?;

        Ok(())
    }
}

#[async_trait]
impl TrafficGenEvent for FrameTypeMonitor {
    async fn on_start(&mut self, switch: &SwitchConnection, _mode: &GenerationMode) -> Result<(), RBFRTError> {
        self.configure(switch).await?;
        Ok(())
    }

    async fn on_stop(&self, _switch: &SwitchConnection) -> Result<(), RBFRTError> {
        Ok(())
    }

    async fn on_reset(&mut self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        self.configure(switch).await?;
        Ok(())
    }
}