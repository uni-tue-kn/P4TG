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

use std::cmp::max;
use std::collections::{BTreeMap, HashMap, VecDeque};
use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use log::{info, warn};
use rbfrt::{register, SwitchConnection, table};
use rbfrt::error::RBFRTError;
use rbfrt::register::Register;
use rbfrt::table::{MatchValue, ToBytes};

use crate::{AppState, PortMapping};
use crate::core::traffic_gen_core::types::GenerationMode;
use crate::core::statistics::{IATStatistics, RateMonitorStatistics, TimeStatistic};
use crate::core::traffic_gen_core::event::TrafficGenEvent;
use crate::core::traffic_gen_core::types::MonitoringMapping;

/// Table that checks if a packet was received on an ingress port
const IS_INGRESS_TABLE: &str = "ingress.p4tg.is_ingress";
const MEAN_IAT_REGISTER: &str = "ingress.p4tg.iat.mean_iat";
const MAE_IAT_REGISTER: &str = "ingress.p4tg.iat.mae_iat";
const CURRENT_MEAN_IAT_REGISTER: &str = "ingress.p4tg.iat.current_mean_iat";

/// Controls whether IATs should be monitored
const MONITOR_IAT_TABLE: &str = "ingress.p4tg.monitor_iat";

const RTT_METER_TABLE: &str = "ingress.p4tg.rtt.digest_rate";

const IAT_METER_TABLE: &str = "ingress.p4tg.iat.digest_rate";

const RATE_DIGEST_NAME: &str = "pipe.SwitchIngressDeparser.digest";

const RTT_IAT_DIGEST_NAME: &str = "pipe.SwitchIngressDeparser.digest_2";

/// Number of RTTs that should be stored
const RTT_STORAGE: usize = 50000;

/// This module handles the initialization of the `egress.frame_size_monitor` table
/// that counts the different frame sizes that are received/sent
pub struct RateMonitor {
    port_mapping: HashMap<u32, PortMapping>,
    pub statistics: RateMonitorStatistics,
    pub time_statistics: TimeStatistic,
    pub rtt_storage: HashMap<u32, VecDeque<u64>>,
    pub tx_iat_storage: HashMap<u32, VecDeque<u64>>,
    pub rx_iat_storage: HashMap<u32, VecDeque<u64>>,
    #[allow(dead_code)]
    running: bool,
}

#[derive(Clone, Debug)]
struct DataRate {
    byte_count_l1: u64,
    byte_count_l2: u64,
    timestamp: u64,
    rate_l1: f64,
    rate_l2: f64,
}

impl DataRate {
    pub fn new(byte_count_l1: u64, byte_count_l2: u64, timestamp: u64, rate_l1: f64, rate_l2: f64) -> DataRate {
        DataRate {
            byte_count_l1,
            byte_count_l2,
            timestamp,
            rate_l1,
            rate_l2,
        }
    }
}

impl RateMonitor {
    pub fn new(port_mapping: HashMap<u32, PortMapping>) -> RateMonitor {
        RateMonitor { port_mapping, statistics: RateMonitorStatistics::default(), time_statistics: TimeStatistic::default(), rtt_storage: Default::default(), tx_iat_storage: Default::default(), rx_iat_storage: Default::default(), running: true }
    }

    pub async fn init_monitoring_rules(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        // clear table
        let delete_request = table::Request::new(IS_INGRESS_TABLE);
        switch.delete_table_entry(delete_request).await?;

        let mut entries = vec![];

        for mapping in self.port_mapping.values() {
            entries.push(table::Request::new(IS_INGRESS_TABLE).match_key("ig_intr_md.ingress_port", MatchValue::exact(mapping.rx_recirculation)).action("ingress.p4tg.nop"));
        }

        switch.write_table_entries(entries).await?;

        Ok(())
    }

    pub async fn init_rtt_meter(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        let target_pps = 800f32;
        let packet_size = (64 + 20) as f32;

        let mut valid_ports = vec![];

        for mapping in self.port_mapping.values() {
            valid_ports.push(mapping.tx_recirculation);
            valid_ports.push(mapping.rx_recirculation);
        }

        let mut meter_requests = vec![];

        for x in 0..512 {
            let mut cir_kbps = (target_pps * packet_size * 0.001) as u32;
            let mut pir_kbps = cir_kbps;
            let mut cbs = cir_kbps;
            let mut pbs = 2 * cbs;

            if !valid_ports.contains(&x) {
                cir_kbps = 0;
                pir_kbps = 0;
                cbs = 1;
                pbs = 1;
            }

            let req = table::Request::new(RTT_METER_TABLE).match_key("$METER_INDEX", MatchValue::exact(x)).action_data("$METER_SPEC_CIR_KBPS", cir_kbps).action_data("$METER_SPEC_PIR_KBPS", pir_kbps).action_data("$METER_SPEC_CBS_KBITS", cbs).action_data("$METER_SPEC_PBS_KBITS", pbs);

            meter_requests.push(req);
        }

        switch.write_table_entries(meter_requests).await?;

        info!("Configured RTT meter table.");

        Ok(())
    }

    /// Initializes the IAT meter in the data plane.
    /// Deactivates the meter - labels everything red - if we are not in sample mode
    /// or if a packet was not received on a recirculation port.
    /// This is used to limit the number of digests that are created.
    pub async fn init_iat_meter(&self, switch: &SwitchConnection, sample_mode: bool) -> Result<(), RBFRTError> {
        let target_pps = 800f32;
        let packet_size = (64 + 20) as f32;

        let mut valid_ports = vec![];

        for mapping in self.port_mapping.values() {
            valid_ports.push(mapping.tx_recirculation);
            valid_ports.push(mapping.rx_recirculation);
        }

        let mut meter_requests = vec![];

        for x in 0..512 {
            let mut cir_kbps = (target_pps * packet_size * 0.001) as u32;
            let mut pir_kbps = cir_kbps;
            let mut cbs = cir_kbps;
            let mut pbs = 2 * cbs;

            // deactivate iat metering if sample mode is not activated
            if !valid_ports.contains(&x) || !sample_mode {
                cir_kbps = 0;
                pir_kbps = 0;
                cbs = 1;
                pbs = 1;
            }

            let req = table::Request::new(IAT_METER_TABLE)
                .match_key("$METER_INDEX", MatchValue::exact(x))
                .action_data("$METER_SPEC_CIR_KBPS", cir_kbps)
                .action_data("$METER_SPEC_PIR_KBPS", pir_kbps)
                .action_data("$METER_SPEC_CBS_KBITS", cbs)
                .action_data("$METER_SPEC_PBS_KBITS", pbs);

            meter_requests.push(req);
        }

        switch.write_table_entries(meter_requests).await?;

        info!("Configured IAT meter table. Sampling mode: {}", sample_mode);

        Ok(())
    }

    /// This method monitors the MEAN IAT and MEA IAT register of the dataplane
    /// It runs in a thread.
    ///
    /// - `state`: Thread-safe state object that holds the application state (including the switch connection)
    pub async fn monitor_iat(state: Arc<AppState>) {
        // get register requests for relevant ports
        let mut mean_iat_requests = vec![];
        let mut mae_iat_requests = vec![];

        let port_mapping = {
            let rate_monitor = state.rate_monitor.lock().await;
            rate_monitor.port_mapping.clone()
        };

        let mut tx_mapping: HashMap<u32, u32> = HashMap::new();
        let mut rx_mapping: HashMap<u32, u32> = HashMap::new();

        // create the requests to retrieve the register content
        for (port, mapping) in port_mapping.iter().by_ref() {
            mean_iat_requests.push(register::Request::new(MEAN_IAT_REGISTER).index(mapping.tx_recirculation));
            mean_iat_requests.push(register::Request::new(MEAN_IAT_REGISTER).index(mapping.rx_recirculation));

            mae_iat_requests.push(register::Request::new(MAE_IAT_REGISTER).index(mapping.tx_recirculation));
            mae_iat_requests.push(register::Request::new(MAE_IAT_REGISTER).index(mapping.rx_recirculation));

            tx_mapping.insert(mapping.tx_recirculation, *port);
            rx_mapping.insert(mapping.rx_recirculation, *port);
        }

        loop {
            let mean_iat_register = {
                let switch = &state.switch;
                let sync = table::Request::new(MEAN_IAT_REGISTER).operation(table::TableOperation::SyncRegister);

                // sync register
                if switch.execute_operation(sync).await.is_err() {
                    warn!("Error in synchronization for register {}.", MEAN_IAT_REGISTER);
                }

                let fut = switch.get_register_entries(mean_iat_requests.clone()).await;

                match fut {
                    Ok(f) => f,
                    Err(err) => {
                        warn!("Error in monitor_iat. Error: {}", format!("{:#?}", err));
                        Register::new("default", HashMap::new())
                    }
                }
            };

            let mae_iat_register = {
                let switch = &state.switch;
                let sync = table::Request::new(MAE_IAT_REGISTER).operation(table::TableOperation::SyncRegister);

                // sync register
                if switch.execute_operation(sync).await.is_err() {
                    warn!("Error in synchronization for register {}.", MAE_IAT_REGISTER);
                }

                let fut = switch.get_register_entries(mae_iat_requests.clone()).await;

                match fut {
                    Ok(f) => f,
                    Err(err) => {
                        warn!("Error in monitor_iat. Error: {}", format!("{:#?}", err));
                        Register::new("default", HashMap::new())
                    }
                }
            };

            // update mean iat register in data plane for mae calculation
            let mut update_requests = vec![];

            // mean iat
            for (index, entry) in mean_iat_register.entries() {
                let data = entry.get_data();
                let sum = data.get(&format!("{}.sum", MEAN_IAT_REGISTER));
                let n = data.get(&format!("{}.n", MEAN_IAT_REGISTER));

                if sum.is_some() && n.is_some() {
                    let sum = sum.unwrap();
                    let n = n.unwrap();

                    // get the pipe number to get the correct register value
                    // a register has a value per pipe
                    let pipe = (index >> 7) as usize; // index = port number

                    if sum.len() >= pipe {
                        let sum = sum.get(pipe).unwrap().to_u128();
                        let n = max(1, n.get(pipe).unwrap().to_u128());

                        let rate_monitor = &mut state.rate_monitor.lock().await;

                        if tx_mapping.contains_key(index) {
                            let port = tx_mapping.get(index).unwrap();
                            let iat_stats = rate_monitor.statistics.iats.entry(*port).or_insert_with(IATStatistics::default);

                            iat_stats.tx.mean = (sum as f64 / n as f64) as f32;
                            iat_stats.tx.n = n as u32;

                            update_requests.push(register::Request::new(CURRENT_MEAN_IAT_REGISTER).index(*index).data(&format!("{}.f1", CURRENT_MEAN_IAT_REGISTER), iat_stats.tx.mean.round() as u32));
                        } else if rx_mapping.contains_key(index) {
                            let port = rx_mapping.get(index).unwrap();
                            let iat_stats = rate_monitor.statistics.iats.entry(*port).or_insert_with(IATStatistics::default);
                            iat_stats.rx.mean = (sum as f64 / n as f64) as f32;
                            iat_stats.rx.n = n as u32;

                            update_requests.push(register::Request::new(CURRENT_MEAN_IAT_REGISTER).index(*index).data(&format!("{}.f1", CURRENT_MEAN_IAT_REGISTER), iat_stats.rx.mean.round() as u32));
                        }
                    }
                }
            }

            // mae iat
            for (index, entry) in mae_iat_register.entries() {
                let data = entry.get_data();
                let sum = data.get(&format!("{}.sum", MAE_IAT_REGISTER));
                let n = data.get(&format!("{}.n", MAE_IAT_REGISTER));

                if sum.is_some() && n.is_some() {
                    let sum = sum.unwrap();
                    let n = n.unwrap();

                    let pipe = (index >> 7) as usize; // index = port number

                    if sum.len() >= pipe {
                        let sum = sum.get(pipe).unwrap().to_u128();
                        let n = max(1, n.get(pipe).unwrap().to_u128());

                        let rate_monitor = &mut state.rate_monitor.lock().await;

                        if tx_mapping.contains_key(index) {
                            let port = tx_mapping.get(index).unwrap();
                            let iat_stats = rate_monitor.statistics.iats.entry(*port).or_insert_with(IATStatistics::default);

                            iat_stats.tx.mae = (sum as f64 / n as f64) as f32;
                        } else if rx_mapping.contains_key(index) {
                            let port = rx_mapping.get(index).unwrap();
                            let iat_stats = rate_monitor.statistics.iats.entry(*port).or_insert_with(IATStatistics::default);
                            iat_stats.rx.mae = (sum as f64 / n as f64) as f32;
                        }
                    }
                }
            }

            // write register updates
            {
                let switch = &state.switch;
                if switch.write_register_entries(update_requests).await.is_err() {
                    warn!("Error in updating {} register.", CURRENT_MEAN_IAT_REGISTER);
                }
            }

            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    /// Calculates the L1 and L2 rate given current values and a last measurement.
    fn calculate_rate((current_byte_count_l1, current_byte_count_l2, current_tstmp): (u64, u64, u64), last_rate: &DataRate) -> DataRate {
        if current_tstmp > (last_rate.timestamp + (Duration::from_secs(1).as_nanos() as u64)) {
            let time_diff: f64 = (current_tstmp - last_rate.timestamp) as f64;
            let byte_diff_l1: f64 = (current_byte_count_l1 - last_rate.byte_count_l1) as f64;

            let byte_diff_l2: f64 = (current_byte_count_l2 - last_rate.byte_count_l2) as f64;

            let rate_1 = 8f64 * (byte_diff_l1 / time_diff) * (Duration::from_secs(1).as_nanos() as f64);
            let rate_2 = 8f64 * (byte_diff_l2 / time_diff) * (Duration::from_secs(1).as_nanos() as f64);

            DataRate::new(current_byte_count_l1, current_byte_count_l2, current_tstmp, rate_1, rate_2)
        } else if last_rate.timestamp > current_tstmp { // timestamp overflow
            DataRate::new(0, 0, 0, last_rate.rate_l1, last_rate.rate_l2)
        } else {
            last_rate.clone() // do not update, not enough time elapsed for measurement
        }
    }

    /// Monitors the digests that are received from the switch.
    /// This method runs in a thread.
    pub async fn monitor_digests(state: Arc<AppState>, index_mapping: &HashMap<u32, MonitoringMapping>, sample_mode: bool) {
        // Key: DataRate
        let mut last_tx: HashMap<u32, DataRate> = HashMap::new();
        let mut last_rx: HashMap<u32, DataRate> = HashMap::new();
        let mut last_app_tx: HashMap<u32, DataRate> = HashMap::new();
        let mut last_app_rx: HashMap<u32, DataRate> = HashMap::new();

        // create a reverse mapping from port recirculation port to real port
        // we need this mapping to go fast from port within monitoring digest to tx/rx real port
        let mut tx_reverse_mapping: HashMap<u32, u32> = HashMap::new();
        let mut rx_reverse_mapping: HashMap<u32, u32> = HashMap::new();

        // initialize tx_rate & rx_rate & packet loss & out of order
        // store "last" value for rate calculation, initial zero
        {
            let rate_monitor = &mut state.rate_monitor.lock().await;

            for (port, mapping) in &state.port_mapping {
                rate_monitor.statistics.tx_rate_l1.insert(*port, 0.0);
                rate_monitor.statistics.rx_rate_l1.insert(*port, 0.0);
                rate_monitor.statistics.tx_rate_l2.insert(*port, 0.0);
                rate_monitor.statistics.rx_rate_l2.insert(*port, 0.0);
                rate_monitor.statistics.packet_loss.insert(*port, 0);
                rate_monitor.statistics.out_of_order.insert(*port, 0);
                tx_reverse_mapping.insert(mapping.tx_recirculation, *port);
                rx_reverse_mapping.insert(mapping.rx_recirculation, *port);
                last_tx.insert(*port, DataRate::new(0, 0, 0, 0.0, 0.0));
                last_rx.insert(*port, DataRate::new(0, 0, 0, 0.0, 0.0));

                // init app tx/rx rate measure
                rate_monitor.statistics.app_tx_l2.insert(*port, HashMap::new());
                rate_monitor.statistics.app_rx_l2.insert(*port, HashMap::new());

                for app_id in 1..8 {
                    rate_monitor.statistics.app_tx_l2.get_mut(port).unwrap().insert(app_id, 0.0f64);
                    rate_monitor.statistics.app_rx_l2.get_mut(port).unwrap().insert(app_id, 0.0f64);
                }
            }
        }

        // initialize app storage
        for index in index_mapping.keys() {
            last_app_tx.insert(*index, DataRate::new(0, 0, 0, 0.0, 0.0));
            last_app_rx.insert(*index, DataRate::new(0, 0, 0, 0.0, 0.0));
        }

        // listen on the channel that receives digests
        while let Ok(digest) = &mut state.switch.digest_queue.recv() {
            let (elapsed_time, running) = {
                let exp = state.experiment.lock().await;

                if exp.running {
                    (exp.start.elapsed().unwrap_or(Duration::from_secs(0)).as_secs() as u32, true)
                }
                else {
                    (0, false)
                }
            };

            if digest.name == RATE_DIGEST_NAME {

                let data = &digest.data;

                // we know how the digest is build
                // unwrap without error handling
                let port = data.get("port").unwrap().to_u32();

                if !tx_reverse_mapping.contains_key(&port) && !rx_reverse_mapping.contains_key(&port) { // we are not interested in non recirc digests
                    continue;
                }

                let time = data.get("tstmp").unwrap().to_u64();

                let l1_byte = data.get("byte_counter_l1").unwrap().to_u64();
                let l2_byte = data.get("byte_counter_l2").unwrap().to_u64();
                let app_byte = data.get("app_counter").unwrap().to_u64();
                let app_index = data.get("index").unwrap().to_u32();
                let packet_loss = data.get("packet_loss").unwrap().to_u64();
                let out_of_order = data.get("out_of_order").unwrap().to_u64();

                // out of order packets are also counted as packet loss in the data plane
                // therefore subtract them from the packet loss counter
                let packet_loss = if packet_loss >= out_of_order {
                    packet_loss - out_of_order
                } else {
                    0
                };

                let is_tx = tx_reverse_mapping.contains_key(&port);

                let last_update = if is_tx { &mut last_tx } else { &mut last_rx };
                let last_update_app = if is_tx { &mut last_app_tx } else { &mut last_app_rx };

                // get the front panel dev port number
                let port = if is_tx { tx_reverse_mapping.get(&port).unwrap() } else { rx_reverse_mapping.get(&port).unwrap() };

                let last = last_update.get(port).unwrap();

                let index_port_app_mapping = index_mapping.get(&app_index);

                if last.timestamp != 0 {
                    let new_rate = RateMonitor::calculate_rate((l1_byte, l2_byte, time), last);

                    if is_tx {
                        state.rate_monitor.lock().await.statistics.tx_rate_l1.insert(*port, new_rate.rate_l1);
                        state.rate_monitor.lock().await.statistics.tx_rate_l2.insert(*port, new_rate.rate_l2);

                        // time statistic
                        if running {
                            state.rate_monitor.lock().await.time_statistics.tx_rate_l1.entry(*port).or_default().insert(elapsed_time, new_rate.rate_l1);

                            // remove potential old data
                            state.rate_monitor.lock().await.time_statistics.tx_rate_l1.entry(*port).or_default().retain(|key, _| *key <= elapsed_time);
                        }

                    } else {
                        state.rate_monitor.lock().await.statistics.rx_rate_l1.insert(*port, new_rate.rate_l1);
                        state.rate_monitor.lock().await.statistics.rx_rate_l2.insert(*port, new_rate.rate_l2);

                        // time statistics
                        if running {
                            state.rate_monitor.lock().await.time_statistics.rx_rate_l1.entry(*port).or_default().insert(elapsed_time, new_rate.rate_l1);
                            state.rate_monitor.lock().await.time_statistics.packet_loss.entry(*port).or_default().insert(elapsed_time, packet_loss);
                            state.rate_monitor.lock().await.time_statistics.out_of_order.entry(*port).or_default().insert(elapsed_time, out_of_order);

                            // remove potential old data
                            state.rate_monitor.lock().await.time_statistics.rx_rate_l1.entry(*port).or_default().retain(|key, _| *key <= elapsed_time);
                            state.rate_monitor.lock().await.time_statistics.packet_loss.entry(*port).or_default().retain(|key, _| *key <= elapsed_time);
                            state.rate_monitor.lock().await.time_statistics.out_of_order.entry(*port).or_default().retain(|key, _| *key <= elapsed_time);
                        }

                        // only write packet loss if its from a rx recirc port
                        state.rate_monitor.lock().await.statistics.packet_loss.insert(*port, packet_loss);
                        state.rate_monitor.lock().await.statistics.out_of_order.insert(*port, out_of_order);
                    }

                    last_update.insert(*port, new_rate);
                } else {
                    last_update.insert(*port, DataRate::new(l1_byte, l2_byte, time, 0.0, 0.0));
                }


                // Update app rates
                if index_port_app_mapping.is_some() {
                    // we need to subtract 1 on the RX path of the app index
                    let app_index = if is_tx { app_index } else { app_index - 1 };
                    let last_app = last_update_app.get(&app_index).unwrap();

                    if last_app.timestamp != 0 && last_app.byte_count_l2 <= app_byte { // catch overflow of 48 bit stream byte register
                        let new_app_rate = RateMonitor::calculate_rate((0, app_byte, time), last_app);
                        let mapping = index_mapping.get(&app_index).unwrap();

                        if is_tx {
                            state.rate_monitor.lock().await.statistics.app_tx_l2.get_mut(port).unwrap().insert(mapping.app_id as u32, new_app_rate.rate_l2);
                        } else {
                            state.rate_monitor.lock().await.statistics.app_rx_l2.get_mut(port).unwrap().insert(mapping.app_id as u32, new_app_rate.rate_l2);
                        }

                        last_update_app.insert(app_index, new_app_rate);
                    } else {
                        last_update_app.insert(app_index, DataRate::new(0, app_byte, time, 0.0, 0.0));
                    }
                }
            } else if digest.name == RTT_IAT_DIGEST_NAME {
                let data = &digest.data;

                // we know how the digest is build
                // unwrap without error handling
                let port = data.get("port").unwrap().to_u32();

                let rtt = data.get("rtt").unwrap().to_u64();


                // catch timestamp overflow
                if rtt > 0 && rtt < (u32::MAX / 2) as u64 && rx_reverse_mapping.contains_key(&port) {
                    let port = rx_reverse_mapping.get(&port).unwrap();

                    state.rate_monitor.lock().await.rtt_storage.entry(*port).or_insert(VecDeque::with_capacity(RTT_STORAGE)).push_back(rtt);
                    state.rate_monitor.lock().await.time_statistics.rtt.entry(*port).or_insert(BTreeMap::default()).insert(elapsed_time, rtt);

                    // remove potential old data
                    state.rate_monitor.lock().await.time_statistics.rtt.entry(*port).or_default().retain(|key, _| *key <= elapsed_time);
                }


                if sample_mode {
                    let experiment = state.experiment.lock().await;

                    if experiment.running && experiment.start.elapsed().is_ok_and(|x| x > Duration::from_secs(3)) {
                        let iat = data.get("iat").unwrap().to_u64();

                        if iat > 0 && iat < (u32::MAX / 2) as u64 { // catch overflow
                            if rx_reverse_mapping.contains_key(&port) {
                                let port = rx_reverse_mapping.get(&port).unwrap();
                                state.rate_monitor.lock().await.rx_iat_storage.entry(*port).or_insert(VecDeque::with_capacity(RTT_STORAGE)).push_back(iat);
                            } else if tx_reverse_mapping.contains_key(&port) {
                                let port = tx_reverse_mapping.get(&port).unwrap();
                                state.rate_monitor.lock().await.tx_iat_storage.entry(*port).or_insert(VecDeque::with_capacity(RTT_STORAGE)).push_back(iat);
                            }
                        }
                    }
                    else {
                        state.rate_monitor.lock().await.tx_iat_storage.clear();
                        state.rate_monitor.lock().await.rx_iat_storage.clear();
                    }
                }
            }
        }
    }
}

#[async_trait]
impl TrafficGenEvent for RateMonitor {
    async fn on_start(&mut self, switch: &SwitchConnection, mode: &GenerationMode) -> Result<(), RBFRTError> {
        switch.clear_tables(vec![MONITOR_IAT_TABLE, IS_INGRESS_TABLE]).await?;

        self.time_statistics.tx_rate_l1.clear();
        self.time_statistics.rx_rate_l1.clear();

        // allow iat generation
        let req = table::Request::new(MONITOR_IAT_TABLE).match_key("ig_intr_md.ingress_port", MatchValue::lpm(0, 0)).action("ingress.p4tg.nop");

        switch.write_table_entry(req).await?;

        // only do monitoring rules if we are not monitoring other traffic
        // these rules enable RTT monitoring which is not needed for analyze mode
        if *mode != GenerationMode::Analyze {
            self.init_monitoring_rules(switch).await?;
        }

        Ok(())
    }

    async fn on_stop(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        // disable iat generation
        switch.clear_tables(vec![MONITOR_IAT_TABLE, IS_INGRESS_TABLE]).await?;

        Ok(())
    }

    /// Reset the state.
    async fn on_reset(&mut self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        self.rtt_storage.clear();
        self.tx_iat_storage.clear();
        self.rx_iat_storage.clear();
        self.time_statistics.tx_rate_l1.clear();
        self.time_statistics.rx_rate_l1.clear();
        self.time_statistics.packet_loss.clear();
        self.time_statistics.out_of_order.clear();
        self.time_statistics.rtt.clear();

        let monitoring_registers = vec!["ingress.p4tg.rx_seq",
                                        "egress.tx_seq",
                                        "ingress.p4tg.lost_packets.reg_lo",
                                        "ingress.p4tg.lost_packets.reg_lo_carry",
                                        "ingress.p4tg.lost_packets.reg_hi",
                                        "ingress.p4tg.out_of_order.reg_lo",
                                        "ingress.p4tg.out_of_order.reg_lo_carry",
                                        "ingress.p4tg.out_of_order.reg_hi",
                                        "ingress.p4tg.iat.mae_iat",
                                        "ingress.p4tg.iat.mean_iat",
        ];

        switch.clear_tables(monitoring_registers).await?;

        Ok(())
    }
}