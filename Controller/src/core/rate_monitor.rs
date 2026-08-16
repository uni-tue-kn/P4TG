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
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime};

use async_trait::async_trait;
use log::{error, info, warn};
use rbfrt::error::RBFRTError;
use rbfrt::register::Register;
use rbfrt::table::{MatchValue, ToBytes};
use rbfrt::{register, table, SwitchConnection};
use tokio::time::sleep;

use crate::core::statistics::{IATStatistics, RateMonitorStatistics, TimeStatistics};
use crate::core::traffic_gen_core::event::TrafficGenEvent;
use crate::core::traffic_gen_core::types::GenerationMode;
use crate::core::traffic_gen_core::types::MonitoringMapping;
use crate::{AppState, PortMapping};

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

/// Monitoring packets create digests every 500 ms per port, independent of
/// running tests. No digests for this long means the digest pipeline is dead.
pub const DIGEST_TIMEOUT_SECS: u64 = 10;

/// Seconds since the unix epoch.
pub fn unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Wrap-around period of the switch timestamp. `monitor_t.tstmp` is a
/// free-running `bit<48>` nanosecond counter, so it wraps every ~78.2 h.
const TSTMP_WRAP: u64 = 1 << 48;

/// Elapsed seconds of the current test for a switch-domain timestamp.
///
/// Digest timestamps live in the switch clock domain and have an arbitrary
/// value at test start, so they are only ever used as a delta against `start`,
/// the timestamp of the first digest of the test. The first sample of a test
/// therefore lands on key 0.
///
/// Returns `None` for digests that were generated before the epoch.
fn elapsed_secs(now: u64, start: u64) -> Option<u32> {
    let delta = if now >= start {
        now - start
    } else if start - now > TSTMP_WRAP / 2 {
        // The switch clock wrapped past the epoch mid-test. A straggler sits a
        // few hundred ms behind `start`, a wrap almost a full period behind it,
        // so the half-period split tells the two apart for any test < ~39 h.
        now + TSTMP_WRAP - start
    } else {
        return None;
    };

    Some((delta / Duration::from_secs(1).as_nanos() as u64) as u32)
}

/// This module handles the initialization of the `egress.frame_size_monitor` table
/// that counts the different frame sizes that are received/sent
pub struct RateMonitor {
    port_mapping: HashMap<u32, PortMapping>,
    pub statistics: RateMonitorStatistics,
    pub time_statistics: TimeStatistics,
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
    pub fn new(
        byte_count_l1: u64,
        byte_count_l2: u64,
        timestamp: u64,
        rate_l1: f64,
        rate_l2: f64,
    ) -> DataRate {
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
        RateMonitor {
            port_mapping,
            statistics: RateMonitorStatistics::default(),
            time_statistics: TimeStatistics::default(),
            rtt_storage: Default::default(),
            tx_iat_storage: Default::default(),
            rx_iat_storage: Default::default(),
            running: true,
        }
    }

    pub async fn init_monitoring_rules(&self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        // clear table
        let delete_request = table::Request::new(IS_INGRESS_TABLE);
        switch.delete_table_entry(delete_request).await?;

        let mut entries = vec![];

        for mapping in self.port_mapping.values() {
            entries.push(
                table::Request::new(IS_INGRESS_TABLE)
                    .match_key(
                        "ig_intr_md.ingress_port",
                        MatchValue::exact(mapping.rx_recirculation),
                    )
                    .action("ingress.p4tg.nop"),
            );
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

            let req = table::Request::new(RTT_METER_TABLE)
                .match_key("$METER_INDEX", MatchValue::exact(x))
                .action_data("$METER_SPEC_CIR_KBPS", cir_kbps)
                .action_data("$METER_SPEC_PIR_KBPS", pir_kbps)
                .action_data("$METER_SPEC_CBS_KBITS", cbs)
                .action_data("$METER_SPEC_PBS_KBITS", pbs);

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
    pub async fn init_iat_meter(
        &self,
        switch: &SwitchConnection,
        sample_mode: bool,
    ) -> Result<(), RBFRTError> {
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

        info!("Configured IAT meter table. Sampling mode: {sample_mode}");

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
            mean_iat_requests
                .push(register::Request::new(MEAN_IAT_REGISTER).index(mapping.tx_recirculation));
            mean_iat_requests
                .push(register::Request::new(MEAN_IAT_REGISTER).index(mapping.rx_recirculation));

            mae_iat_requests
                .push(register::Request::new(MAE_IAT_REGISTER).index(mapping.tx_recirculation));
            mae_iat_requests
                .push(register::Request::new(MAE_IAT_REGISTER).index(mapping.rx_recirculation));

            tx_mapping.insert(mapping.tx_recirculation, *port);
            rx_mapping.insert(mapping.rx_recirculation, *port);
        }

        loop {
            let mean_iat_register = {
                let switch = &state.switch;
                let sync = table::Request::new(MEAN_IAT_REGISTER)
                    .operation(table::TableOperation::SyncRegister);

                // sync register
                if switch.execute_operation(sync).await.is_err() {
                    warn!("Error in synchronization for register {MEAN_IAT_REGISTER}.");
                }

                let fut = switch.get_register_entries(mean_iat_requests.clone()).await;

                match fut {
                    Ok(f) => f,
                    Err(err) => {
                        warn!("Error in monitor_iat. Error: {err:#?}");
                        Register::new("default", HashMap::new())
                    }
                }
            };

            let mae_iat_register = {
                let switch = &state.switch;
                let sync = table::Request::new(MAE_IAT_REGISTER)
                    .operation(table::TableOperation::SyncRegister);

                // sync register
                if switch.execute_operation(sync).await.is_err() {
                    warn!("Error in synchronization for register {MAE_IAT_REGISTER}.");
                }

                let fut = switch.get_register_entries(mae_iat_requests.clone()).await;

                match fut {
                    Ok(f) => f,
                    Err(err) => {
                        warn!("Error in monitor_iat. Error: {err:#?}");
                        Register::new("default", HashMap::new())
                    }
                }
            };

            // update mean iat register in data plane for mae calculation
            let mut update_requests = vec![];

            // mean iat
            for (index, entry) in mean_iat_register.entries() {
                let data = entry.get_data();
                let sum = data.get(&format!("{MEAN_IAT_REGISTER}.sum"));
                let n = data.get(&format!("{MEAN_IAT_REGISTER}.n"));

                if let Some(sum) = sum {
                    if let Some(n) = n {
                        // get the pipe number to get the correct register value
                        // a register has a value per pipe
                        let pipe = (index >> 7) as usize; // index = port number

                        if sum.len() > pipe {
                            let sum = sum.get(pipe).unwrap().to_u128();
                            let n = max(1, n.get(pipe).unwrap().to_u128());

                            let rate_monitor = &mut state.rate_monitor.lock().await;

                            if tx_mapping.contains_key(index) {
                                let port = tx_mapping.get(index).unwrap();
                                let iat_stats = rate_monitor
                                    .statistics
                                    .iats
                                    .entry(*port)
                                    .or_insert_with(IATStatistics::default);

                                iat_stats.tx.mean = (sum as f64 / n as f64) as f32;
                                iat_stats.tx.n = n as u32;

                                update_requests.push(
                                    register::Request::new(CURRENT_MEAN_IAT_REGISTER)
                                        .index(*index)
                                        .data(
                                            &format!("{CURRENT_MEAN_IAT_REGISTER}.f1"),
                                            iat_stats.tx.mean.round() as u32,
                                        ),
                                );
                            } else if rx_mapping.contains_key(index) {
                                let port = rx_mapping.get(index).unwrap();
                                let iat_stats = rate_monitor
                                    .statistics
                                    .iats
                                    .entry(*port)
                                    .or_insert_with(IATStatistics::default);
                                iat_stats.rx.mean = (sum as f64 / n as f64) as f32;
                                iat_stats.rx.n = n as u32;

                                update_requests.push(
                                    register::Request::new(CURRENT_MEAN_IAT_REGISTER)
                                        .index(*index)
                                        .data(
                                            &format!("{CURRENT_MEAN_IAT_REGISTER}.f1"),
                                            iat_stats.rx.mean.round() as u32,
                                        ),
                                );
                            }
                        }
                    }
                }
            }

            // mae iat
            for (index, entry) in mae_iat_register.entries() {
                let data = entry.get_data();
                let sum = data.get(&format!("{MAE_IAT_REGISTER}.sum"));
                let n = data.get(&format!("{MAE_IAT_REGISTER}.n"));

                if let Some(sum) = sum {
                    if let Some(n) = n {
                        let pipe = (index >> 7) as usize; // index = port number

                        if sum.len() > pipe {
                            let sum = sum.get(pipe).unwrap().to_u128();
                            let n = max(1, n.get(pipe).unwrap().to_u128());

                            let rate_monitor = &mut state.rate_monitor.lock().await;

                            if tx_mapping.contains_key(index) {
                                let port = tx_mapping.get(index).unwrap();
                                let iat_stats = rate_monitor
                                    .statistics
                                    .iats
                                    .entry(*port)
                                    .or_insert_with(IATStatistics::default);

                                iat_stats.tx.mae = (sum as f64 / n as f64) as f32;
                            } else if rx_mapping.contains_key(index) {
                                let port = rx_mapping.get(index).unwrap();
                                let iat_stats = rate_monitor
                                    .statistics
                                    .iats
                                    .entry(*port)
                                    .or_insert_with(IATStatistics::default);
                                iat_stats.rx.mae = (sum as f64 / n as f64) as f32;
                            }
                        }
                    }
                }
            }

            // write register updates
            {
                let switch = &state.switch;
                if switch
                    .write_register_entries(update_requests)
                    .await
                    .is_err()
                {
                    warn!("Error in updating {CURRENT_MEAN_IAT_REGISTER} register.");
                }
            }

            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    /// Calculates the L1 and L2 rate given current values and a last measurement.
    fn calculate_rate(
        (current_byte_count_l1, current_byte_count_l2, current_tstmp): (u64, u64, u64),
        last_rate: &DataRate,
    ) -> DataRate {
        if current_byte_count_l1 < last_rate.byte_count_l1
            || current_byte_count_l2 < last_rate.byte_count_l2
        {
            // Counter regression, e.g. after a data plane restart.
            // Re-seed the measurement instead of underflowing the difference.
            return DataRate::new(
                current_byte_count_l1,
                current_byte_count_l2,
                current_tstmp,
                last_rate.rate_l1,
                last_rate.rate_l2,
            );
        }

        if current_tstmp > (last_rate.timestamp + (Duration::from_secs(1).as_nanos() as u64)) {
            let time_diff: f64 = (current_tstmp - last_rate.timestamp) as f64;
            let byte_diff_l1: f64 = (current_byte_count_l1 - last_rate.byte_count_l1) as f64;

            let byte_diff_l2: f64 = (current_byte_count_l2 - last_rate.byte_count_l2) as f64;

            let rate_1 =
                8f64 * (byte_diff_l1 / time_diff) * (Duration::from_secs(1).as_nanos() as f64);
            let rate_2 =
                8f64 * (byte_diff_l2 / time_diff) * (Duration::from_secs(1).as_nanos() as f64);

            DataRate::new(
                current_byte_count_l1,
                current_byte_count_l2,
                current_tstmp,
                rate_1,
                rate_2,
            )
        } else if last_rate.timestamp > current_tstmp {
            // timestamp overflow
            DataRate::new(0, 0, 0, last_rate.rate_l1, last_rate.rate_l2)
        } else {
            last_rate.clone() // do not update, not enough time elapsed for measurement
        }
    }

    /// Monitors the digests that are received from the switch.
    /// This method runs in a thread.
    pub async fn monitor_digests(
        state: Arc<AppState>,
        index_mapping: &HashMap<u32, MonitoringMapping>,
        sample_mode: bool,
    ) {
        // Tofino2 supports 15 generation apps (1..=15), Tofino1 supports 7 (1..=7).
        let app_ids: Vec<u32> = {
            if state.traffic_generator.lock().await.is_tofino2 {
                (1..16).collect()
            } else {
                (1..8).collect()
            }
        };

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
                rate_monitor
                    .statistics
                    .app_tx_l2
                    .insert(*port, HashMap::new());
                rate_monitor
                    .statistics
                    .app_rx_l2
                    .insert(*port, HashMap::new());

                for &app_id in &app_ids {
                    rate_monitor
                        .statistics
                        .app_tx_l2
                        .get_mut(port)
                        .unwrap()
                        .insert(app_id, 0.0f64);
                    rate_monitor
                        .statistics
                        .app_rx_l2
                        .get_mut(port)
                        .unwrap()
                        .insert(app_id, 0.0f64);
                }
            }
        }

        // initialize app storage
        for index in index_mapping.keys() {
            last_app_tx.insert(*index, DataRate::new(0, 0, 0, 0.0, 0.0));
            last_app_rx.insert(*index, DataRate::new(0, 0, 0, 0.0, 0.0));
        }

        // Skip malformed digests instead of panicking; a panic here would
        // silently kill this task and freeze all rate statistics.
        macro_rules! field {
            ($data:expr, $name:expr) => {
                match $data.get($name) {
                    Some(v) => v,
                    None => {
                        warn!("Digest without expected field {}. Digest skipped.", $name);
                        continue;
                    }
                }
            };
        }

        let mut stale_logged: Option<Instant> = None;

        // Start time of the test we are currently attributing digests to. A
        // changed start time is the signal that a new test began.
        let mut seen_start: Option<SystemTime> = None;
        // Switch timestamp of the first digest of the current test; the epoch
        // that turns switch-domain timestamps into elapsed seconds.
        let mut start_tstmp: Option<u64> = None;
        // Most recent switch timestamp seen. The RTT/IAT digests carry no
        // timestamp of their own and fall back to this.
        let mut dp_clock: Option<u64> = None;

        // listen on the channel that receives digests
        loop {
            match state.switch.digest_queue.try_recv() {
                Ok(digest) => {
                    state.last_digest.store(unix_secs(), Ordering::Relaxed);
                    let (exp_start, running) = {
                        let exp = state.experiment.lock().await;
                        (exp.start, exp.running)
                    };

                    if running && seen_start != Some(exp_start) {
                        // A new test began. Drop everything that was queued
                        // before it started: those digests carry counter values
                        // from before `on_reset` zeroed them, and anchoring the
                        // epoch on one would shift the whole series early.
                        // This runs in the task that owns the receiver, so it
                        // cannot race with another consumer.
                        while state.switch.digest_queue.try_recv().is_ok() {}

                        seen_start = Some(exp_start);
                        start_tstmp = None;
                        dp_clock = None;

                        // The digest in hand predates the test as well.
                        continue;
                    }

                    if digest.name == RATE_DIGEST_NAME {
                        let data = &digest.data;

                        let port = field!(data, "port").to_u32();

                        if !tx_reverse_mapping.contains_key(&port)
                            && !rx_reverse_mapping.contains_key(&port)
                        {
                            // we are not interested in non recirc digests
                            continue;
                        }

                        let time = field!(data, "tstmp").to_u64();

                        // Anchor the epoch on the first digest of the test and
                        // keep the switch clock cached for the RTT/IAT digests.
                        let epoch = *start_tstmp.get_or_insert(time);
                        dp_clock = Some(time);

                        // Time series key: seconds since the test began, taken
                        // from the switch clock so that a digest delayed in the
                        // queue still lands in the second it was generated in.
                        let elapsed_time = if running {
                            elapsed_secs(time, epoch)
                        } else {
                            None
                        };

                        let l1_byte = field!(data, "byte_counter_l1").to_u64();
                        let l2_byte = field!(data, "byte_counter_l2").to_u64();
                        let app_byte = field!(data, "app_counter").to_u64();
                        let app_index = field!(data, "index").to_u32();
                        let packet_loss = field!(data, "packet_loss").to_u64();
                        let out_of_order = field!(data, "out_of_order").to_u64();

                        // out of order packets are also counted as packet loss in the data plane
                        // therefore subtract them from the packet loss counter
                        let packet_loss = packet_loss.saturating_sub(out_of_order);

                        let is_tx = tx_reverse_mapping.contains_key(&port);

                        let last_update = if is_tx { &mut last_tx } else { &mut last_rx };
                        let last_update_app = if is_tx {
                            &mut last_app_tx
                        } else {
                            &mut last_app_rx
                        };

                        // get the front panel dev port number
                        let port = if is_tx {
                            tx_reverse_mapping.get(&port).unwrap()
                        } else {
                            rx_reverse_mapping.get(&port).unwrap()
                        };

                        let last = last_update.get(port).unwrap();

                        let index_port_app_mapping = index_mapping.get(&app_index);

                        if last.timestamp != 0 {
                            let new_rate =
                                RateMonitor::calculate_rate((l1_byte, l2_byte, time), last);

                            if is_tx {
                                state
                                    .rate_monitor
                                    .lock()
                                    .await
                                    .statistics
                                    .tx_rate_l1
                                    .insert(*port, new_rate.rate_l1);
                                state
                                    .rate_monitor
                                    .lock()
                                    .await
                                    .statistics
                                    .tx_rate_l2
                                    .insert(*port, new_rate.rate_l2);

                                // time statistic
                                if let Some(elapsed_time) = elapsed_time {
                                    state
                                        .rate_monitor
                                        .lock()
                                        .await
                                        .time_statistics
                                        .tx_rate_l1
                                        .entry(*port)
                                        .or_default()
                                        .insert(elapsed_time, new_rate.rate_l1);
                                }
                            } else {
                                state
                                    .rate_monitor
                                    .lock()
                                    .await
                                    .statistics
                                    .rx_rate_l1
                                    .insert(*port, new_rate.rate_l1);
                                state
                                    .rate_monitor
                                    .lock()
                                    .await
                                    .statistics
                                    .rx_rate_l2
                                    .insert(*port, new_rate.rate_l2);

                                // time statistics
                                if let Some(elapsed_time) = elapsed_time {
                                    state
                                        .rate_monitor
                                        .lock()
                                        .await
                                        .time_statistics
                                        .rx_rate_l1
                                        .entry(*port)
                                        .or_default()
                                        .insert(elapsed_time, new_rate.rate_l1);
                                    state
                                        .rate_monitor
                                        .lock()
                                        .await
                                        .time_statistics
                                        .packet_loss
                                        .entry(*port)
                                        .or_default()
                                        .insert(elapsed_time, packet_loss);
                                    state
                                        .rate_monitor
                                        .lock()
                                        .await
                                        .time_statistics
                                        .out_of_order
                                        .entry(*port)
                                        .or_default()
                                        .insert(elapsed_time, out_of_order);
                                }

                                // only write packet loss if its from a rx recirc port
                                state
                                    .rate_monitor
                                    .lock()
                                    .await
                                    .statistics
                                    .packet_loss
                                    .insert(*port, packet_loss);
                                state
                                    .rate_monitor
                                    .lock()
                                    .await
                                    .statistics
                                    .out_of_order
                                    .insert(*port, out_of_order);
                            }

                            last_update.insert(*port, new_rate);
                        } else {
                            last_update
                                .insert(*port, DataRate::new(l1_byte, l2_byte, time, 0.0, 0.0));
                        }

                        // Update app rates
                        if index_port_app_mapping.is_some() {
                            // we need to subtract 1 on the RX path of the app index
                            let app_index = if is_tx { app_index } else { app_index - 1 };
                            // guards against digests with an unexpected index;
                            // index_mapping has the same key set, so the unwrap
                            // below is covered by this check as well
                            let Some(last_app) = last_update_app.get(&app_index) else {
                                warn!(
                                    "Digest with unexpected app index {app_index}. Digest skipped."
                                );
                                continue;
                            };

                            if last_app.timestamp != 0 && last_app.byte_count_l2 <= app_byte {
                                // catch overflow of 48 bit stream byte register
                                let new_app_rate =
                                    RateMonitor::calculate_rate((0, app_byte, time), last_app);
                                let mapping = index_mapping.get(&app_index).unwrap();

                                if is_tx {
                                    state
                                        .rate_monitor
                                        .lock()
                                        .await
                                        .statistics
                                        .app_tx_l2
                                        .get_mut(port)
                                        .unwrap()
                                        .insert(mapping.app_id as u32, new_app_rate.rate_l2);

                                    if let Some(elapsed_time) = elapsed_time {
                                        state
                                            .rate_monitor
                                            .lock()
                                            .await
                                            .time_statistics
                                            .app_tx_l2
                                            .entry(*port)
                                            .or_default()
                                            .entry(mapping.app_id as u32)
                                            .or_default()
                                            .insert(elapsed_time, new_app_rate.rate_l2);
                                    }
                                } else {
                                    state
                                        .rate_monitor
                                        .lock()
                                        .await
                                        .statistics
                                        .app_rx_l2
                                        .get_mut(port)
                                        .unwrap()
                                        .insert(mapping.app_id as u32, new_app_rate.rate_l2);

                                    if let Some(elapsed_time) = elapsed_time {
                                        state
                                            .rate_monitor
                                            .lock()
                                            .await
                                            .time_statistics
                                            .app_rx_l2
                                            .entry(*port)
                                            .or_default()
                                            .entry(mapping.app_id as u32)
                                            .or_default()
                                            .insert(elapsed_time, new_app_rate.rate_l2);
                                    }
                                }

                                last_update_app.insert(app_index, new_app_rate);
                            } else {
                                last_update_app
                                    .insert(app_index, DataRate::new(0, app_byte, time, 0.0, 0.0));
                            }
                        }
                    } else if digest.name == RTT_IAT_DIGEST_NAME {
                        let data = &digest.data;

                        let port = field!(data, "port").to_u32();

                        let rtt = field!(data, "rtt").to_u64();

                        // These digests carry no timestamp of their own, so
                        // fall back to the switch clock cached from the last
                        // rate digest. Digests are processed in order, so a
                        // backlogged rate digest advances the clock and the
                        // RTT digests behind it follow.
                        let elapsed_time = match (running, dp_clock, start_tstmp) {
                            (true, Some(now), Some(epoch)) => elapsed_secs(now, epoch),
                            _ => None,
                        };

                        // catch timestamp overflow
                        if rtt > 0
                            && rtt < (u32::MAX / 2) as u64
                            && rx_reverse_mapping.contains_key(&port)
                        {
                            let port = rx_reverse_mapping.get(&port).unwrap();

                            {
                                let mut rate_monitor = state.rate_monitor.lock().await;
                                let samples = rate_monitor
                                    .rtt_storage
                                    .entry(*port)
                                    .or_insert(VecDeque::with_capacity(RTT_STORAGE));
                                // keep the storage bounded; drop the oldest sample when full
                                if samples.len() >= RTT_STORAGE {
                                    samples.pop_front();
                                }
                                samples.push_back(rtt);
                            }
                            if let Some(elapsed_time) = elapsed_time {
                                state
                                    .rate_monitor
                                    .lock()
                                    .await
                                    .time_statistics
                                    .rtt
                                    .entry(*port)
                                    .or_insert(BTreeMap::default())
                                    .insert(elapsed_time, rtt);
                            }
                        }

                        if sample_mode {
                            let experiment = state.experiment.lock().await;

                            if experiment.running
                                && experiment
                                    .start
                                    .elapsed()
                                    .is_ok_and(|x| x > Duration::from_secs(3))
                            {
                                let iat = field!(data, "iat").to_u64();

                                if iat > 0 && iat < (u32::MAX / 2) as u64 {
                                    // catch overflow
                                    if rx_reverse_mapping.contains_key(&port) {
                                        let port = rx_reverse_mapping.get(&port).unwrap();
                                        let mut rate_monitor = state.rate_monitor.lock().await;
                                        let samples = rate_monitor
                                            .rx_iat_storage
                                            .entry(*port)
                                            .or_insert(VecDeque::with_capacity(RTT_STORAGE));
                                        // keep the storage bounded; drop the oldest sample when full
                                        if samples.len() >= RTT_STORAGE {
                                            samples.pop_front();
                                        }
                                        samples.push_back(iat);
                                    } else if tx_reverse_mapping.contains_key(&port) {
                                        let port = tx_reverse_mapping.get(&port).unwrap();
                                        let mut rate_monitor = state.rate_monitor.lock().await;
                                        let samples = rate_monitor
                                            .tx_iat_storage
                                            .entry(*port)
                                            .or_insert(VecDeque::with_capacity(RTT_STORAGE));
                                        // keep the storage bounded; drop the oldest sample when full
                                        if samples.len() >= RTT_STORAGE {
                                            samples.pop_front();
                                        }
                                        samples.push_back(iat);
                                    }
                                }
                            } else {
                                state.rate_monitor.lock().await.tx_iat_storage.clear();
                                state.rate_monitor.lock().await.rx_iat_storage.clear();
                            }
                        }
                    }
                }
                Err(e) => {
                    if e.is_disconnected() {
                        // The rbfrt digest stream died (e.g., gRPC stream error).
                        // It cannot recover in-process; all digest-based statistics
                        // freeze from now on.
                        error!("Digest channel to the switch disconnected. Rate/loss/RTT statistics will no longer update. Restart the controller to recover.");
                        return;
                    }

                    // Sleep if there’s nothing to process. If we do not do this, the CPU load is very high.
                    sleep(Duration::from_millis(400)).await; // Sleep for 400ms before trying again

                    // Watchdog: even a connected channel can starve if digest
                    // delivery stalls on the switch side.
                    let silent_for =
                        unix_secs().saturating_sub(state.last_digest.load(Ordering::Relaxed));
                    if silent_for > DIGEST_TIMEOUT_SECS {
                        if stale_logged.is_none_or(|t| t.elapsed() >= Duration::from_secs(60)) {
                            error!("No digests received from the switch for {silent_for}s. Statistics are stale; restart the controller if this persists.");
                            stale_logged = Some(Instant::now());
                        }
                    } else {
                        stale_logged = None;
                    }
                }
            }
            tokio::task::yield_now().await;
        }
    }
}

#[async_trait]
impl TrafficGenEvent for RateMonitor {
    async fn on_start(
        &mut self,
        switch: &SwitchConnection,
        mode: &GenerationMode,
    ) -> Result<(), RBFRTError> {
        switch
            .clear_tables(vec![MONITOR_IAT_TABLE, IS_INGRESS_TABLE])
            .await?;

        // Clear every series, not just the rates. The digest loop keys samples
        // by switch-clock delta and no longer prunes stale keys per digest, so
        // a leftover series from the previous test would otherwise survive.
        self.time_statistics.tx_rate_l1.clear();
        self.time_statistics.rx_rate_l1.clear();
        self.time_statistics.app_tx_l2.clear();
        self.time_statistics.app_rx_l2.clear();
        self.time_statistics.packet_loss.clear();
        self.time_statistics.out_of_order.clear();
        self.time_statistics.rtt.clear();

        // allow iat generation
        let req = table::Request::new(MONITOR_IAT_TABLE)
            .match_key("ig_intr_md.ingress_port", MatchValue::lpm(0, 0))
            .action("ingress.p4tg.nop");

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
        switch
            .clear_tables(vec![MONITOR_IAT_TABLE, IS_INGRESS_TABLE])
            .await?;

        Ok(())
    }

    /// Reset the state.
    async fn on_reset(&mut self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        self.rtt_storage.clear();
        self.tx_iat_storage.clear();
        self.rx_iat_storage.clear();
        self.time_statistics.tx_rate_l1.clear();
        self.time_statistics.rx_rate_l1.clear();
        self.time_statistics.app_tx_l2.clear();
        self.time_statistics.app_rx_l2.clear();
        self.time_statistics.packet_loss.clear();
        self.time_statistics.out_of_order.clear();
        self.time_statistics.rtt.clear();

        // Reset the in-memory gauges as well. They are only refreshed by
        // digests (one per MONITORING_PACKET_INTERVAL), so without this a
        // consumer sampling right after a reset reads the previous test's
        // final values, e.g. as a baseline for RFC2544 loss measurements.
        for port in self.port_mapping.keys() {
            self.statistics.packet_loss.insert(*port, 0);
            self.statistics.out_of_order.insert(*port, 0);
            self.statistics.tx_rate_l1.insert(*port, 0.0);
            self.statistics.tx_rate_l2.insert(*port, 0.0);
            self.statistics.rx_rate_l1.insert(*port, 0.0);
            self.statistics.rx_rate_l2.insert(*port, 0.0);
            if let Some(app_rates) = self.statistics.app_tx_l2.get_mut(port) {
                app_rates.values_mut().for_each(|rate| *rate = 0.0);
            }
            if let Some(app_rates) = self.statistics.app_rx_l2.get_mut(port) {
                app_rates.values_mut().for_each(|rate| *rate = 0.0);
            }
        }

        let monitoring_registers = vec![
            "ingress.p4tg.rx_seq",
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
