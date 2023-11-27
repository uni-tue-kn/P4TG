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
use std::sync::Arc;
use std::time::Duration;
use async_trait::async_trait;
use rbfrt::error::RBFRTError;
use rbfrt::{SwitchConnection, table};
use rbfrt::table::{MatchValue, ToBytes};
use crate::{AppState, PortMapping};

use log::{info, warn};
use crate::core::traffic_gen_core::types::GenerationMode;

use crate::core::statistics::{FrameSizeStatistics, RangeCount, RangeCountValue};
use crate::core::traffic_gen_core::event::TrafficGenEvent;

/// Table that is used to count the different frame sizes.
/// The table matches on the packet size in a range match.
const FRAME_SIZE_MONITOR: &str = "egress.frame_size_monitor";

/// This struct handles the initialization of the [FRAME_SIZE_MONITOR] table
/// that counts the different frame sizes that are received/sent.
/// The P4 table uses a counter that counts the matched packets on the table entries.
/// Table entries are multiple range matches on the packet size.
pub struct FrameSizeMonitor {
    /// Stores the mapping between front panel port and tx/rx recirculation ports
    port_mapping: HashMap<u32, PortMapping>,
    /// Describes the entries of the [FRAME_SIZE_MONITOR] table.
    /// Format (a, b) results in the range entry from a until a+b.
    frame_ranges: Vec<(u32, u32)>,
    pub statistics: FrameSizeStatistics,
}

impl FrameSizeMonitor {
    pub fn new(port_mapping: HashMap<u32, PortMapping>) -> FrameSizeMonitor {
        // entry (a, b) describes range (a, a+b)
        let frame_ranges = vec![(0, 63), (64, 0), (65, 62), (128, 127), (256, 255), (512, 511), (1024, 494), (1519, 20000)];
        FrameSizeMonitor {port_mapping, frame_ranges, statistics: FrameSizeStatistics::default()}
    }

    /// Configures the [frame size monitor table](FRAME_SIZE_MONITOR) in the egress pipeline.
    /// It first clears the table, then rewrites it.
    pub async fn configure(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        info!("Configure table {}.", FRAME_SIZE_MONITOR);

        // First clear table and then rewrite it
        self.clear(switch).await?;

        let mut table_entries = vec![];

        // build table requests
        // we used batched execution
        for (port, mapping) in self.port_mapping.iter().by_ref() {
            for (lower, upper) in &self.frame_ranges {

                // table entry for the TX path
                let tx_add_request = table::Request::new(FRAME_SIZE_MONITOR)
                    .match_key("eg_intr_md.egress_port", MatchValue::exact(*port))
                    .match_key("pkt_len", MatchValue::range(*lower, *lower + *upper))
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(1))
                    .action("egress.nop");

                // table entry for the RX path
                let rx_add_request = table::Request::new(FRAME_SIZE_MONITOR)
                    .match_key("eg_intr_md.egress_port", MatchValue::exact(mapping.rx_recirculation))
                    .match_key("pkt_len", MatchValue::range(*lower, *lower + *upper))
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(1))
                    .action("egress.nop");

                table_entries.push(tx_add_request);
                table_entries.push(rx_add_request);
            }
        }

        // dispatch all at once
        switch.write_table_entries(table_entries).await?;

        Ok(())
    }

    /// Computes the statistics for the configuration GUI.
    ///
    /// - `state`: App state that holds the switch connection.
    pub async fn monitor_statistics(state: Arc<AppState>)  {
        loop {
            let mut stats = FrameSizeStatistics::default();

            let request = table::Request::new(FRAME_SIZE_MONITOR);
            let sync = table::Request::new(FRAME_SIZE_MONITOR).operation(table::TableOperation::SyncCounters);

            let entries = {
                let switch = &state.switch;

                // sync counters
                if switch.execute_operation(sync).await.is_err() {
                    warn! {"Encountered error while synchronizing {}.", FRAME_SIZE_MONITOR}
                    ;
                }

                // read counters
                let entries = match switch.get_table_entry(request).await {
                    Ok(e) => e,
                    Err(err) => {
                        warn! {"Encountered error while retrieving {} table. Error: {}", FRAME_SIZE_MONITOR, format!("{:#?}", err)}
                        ;
                        vec![]
                    }
                };

                entries
            };


            let mut tx_mapping: HashMap<u32, u32> = HashMap::new();
            let mut rx_mapping: HashMap<u32, u32> = HashMap::new();

            for (port, mapping) in state.port_mapping.iter().by_ref() {
                tx_mapping.insert(mapping.tx_recirculation, *port);
                rx_mapping.insert(mapping.rx_recirculation, *port);
                stats.frame_size.insert(*port, RangeCount::default());
            }

            for entry in entries {
                if !entry.match_key.contains_key("eg_intr_md.egress_port") {
                    continue;
                }

                let port = entry.match_key.get("eg_intr_md.egress_port").unwrap().get_exact_value().to_u32();

                let (lower, upper) = match entry.match_key.get("pkt_len").unwrap() {
                    MatchValue::RangeValue { lower_bytes, higher_bytes } => {
                        (lower_bytes.to_u32(), higher_bytes.to_u32())
                    },
                    _ => panic!("Wrong match type for {:#?}", entry)
                };

                let count = 'get_count: {
                    for action in &entry.action_data {
                        if action.get_name() == "$COUNTER_SPEC_PKTS" {
                            break 'get_count action.get_data().to_u128();
                        }
                    }

                    panic!("$COUNTER_SPEC_PKTS missing in {:#?}", entry)
                };

                if state.port_mapping.contains_key(&port) {
                    stats.frame_size.get_mut(&port).unwrap().tx.push(RangeCountValue::new(lower, upper, count));
                } else if rx_mapping.contains_key(&port) {
                    let port = rx_mapping.get(&port).unwrap();
                    stats.frame_size.get_mut(&port).unwrap().rx.push(RangeCountValue::new(lower, upper, count));
                }
            }

            {
                let frame_size_state = &mut state.frame_size_monitor.lock().await;
                frame_size_state.statistics = stats;
            }


            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    }


    /// Clear the [frame monitor table](FRAME_SIZE_MONITOR).
    pub async fn clear(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        switch.clear_table(FRAME_SIZE_MONITOR).await?;

        Ok(())
    }
}

#[async_trait]
impl TrafficGenEvent for FrameSizeMonitor {
    async fn on_start(&self, switch: &SwitchConnection, _mode: &GenerationMode) -> Result<(), RBFRTError> {
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