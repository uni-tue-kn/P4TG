use std::{collections::HashMap, sync::Arc, time::Duration};

use async_trait::async_trait;
use log::{info, warn};
use rbfrt::{
    error::RBFRTError,
    table::{self, MatchValue, Request, ToBytes},
    SwitchConnection,
};

use crate::core::traffic_gen_core::const_definitions::RTT_HISTOGRAM_TABLE;
use crate::{AppState, PortMapping};

use super::{
    statistics::RttHistogram,
    traffic_gen_core::{event::TrafficGenEvent, types::GenerationMode},
};

#[derive(Clone, Debug)]
pub struct HistogramMonitor {
    port_mapping: HashMap<u32, PortMapping>,
    pub histogram: HashMap<u32, RttHistogram>,
}

impl HistogramMonitor {
    pub fn new(port_mapping: HashMap<u32, PortMapping>) -> HistogramMonitor {
        HistogramMonitor {
            port_mapping,
            histogram: Default::default(),
        }
    }

    pub async fn init_rtt_histogram_table(
        &mut self,
        switch: &SwitchConnection,
    ) -> Result<(), RBFRTError> {
        // Init default settings for detected recirculation ports
        for port in self.port_mapping.keys() {
            // Keep existing entries
            self.histogram
                .entry(*port)
                .or_insert(RttHistogram::default());
        }

        switch.clear_table(RTT_HISTOGRAM_TABLE).await?;

        let mut requests = vec![];

        for (port, hist) in self.histogram.iter() {
            let hist_config = &hist.config;

            if hist_config.max <= hist_config.min {
                return Err(RBFRTError::GenericError {
                    message: ("Maximum must be greater than minimum for histogram config"
                        .to_string()),
                });
            } else if hist_config.num_bins == 0 {
                return Err(RBFRTError::GenericError {
                    message: ("num_bins must be positive for histogram config".to_string()),
                });
            }

            // Calculate bin width based on config params
            let bin_width = hist_config.get_bin_width();

            for bin_index in 0..hist_config.num_bins {
                // For each bin, write table entries
                let start = hist_config.min + bin_index * bin_width;
                let mut end = start + bin_width - 1;
                if end > hist_config.max {
                    end = hist_config.max;
                }

                if let Some(mapping) = self.port_mapping.get(port) {
                    requests.extend(self.range_to_ternary_entries(
                        mapping.rx_recirculation,
                        start,
                        end,
                        bin_index,
                    ));
                }
            }
        }

        let number_requests = requests.len();
        if number_requests > 4096 {
            return Err(RBFRTError::GenericError { message: (format!("Number of table entries exceeds available space in table {RTT_HISTOGRAM_TABLE}")) });
        }

        switch.write_table_entries(requests).await?;

        info!("Configured table {RTT_HISTOGRAM_TABLE} with {number_requests} entries.");

        Ok(())
    }

    /// Fetches histogram data for the Configuration GUI.
    ///
    /// - `state`: App state that holds the switch connection.
    pub async fn monitor_histogram(state: Arc<AppState>) {
        loop {
            let running = {
                let experiment = state.experiment.lock().await;
                experiment.running
            };

            if running {

                let switch = &state.switch;
                // Sync RTT Histogram counters
                {
                    let sync = Request::new(RTT_HISTOGRAM_TABLE)
                        .operation(table::TableOperation::SyncCounters);
                    if switch.execute_operation(sync).await.is_err() {
                        warn!("Error in synchronization for table {RTT_HISTOGRAM_TABLE}.");
                    }
                }

                let port_mapping = {
                    let rtt_histogram_monitor = state.rtt_histogram_monitor.lock().await;
                    rtt_histogram_monitor.port_mapping.clone()
                };

                // Retrieve all entries from table for RTT histogram
                let req = Request::new(RTT_HISTOGRAM_TABLE);

                match switch.get_table_entries(req).await {
                    Ok(res) => {
                        let mut rtt_histogram_monitor = state.rtt_histogram_monitor.lock().await;

                        // Clone keys so we can iterate without borrowing whole map
                        let ports: Vec<u32> = rtt_histogram_monitor.histogram.keys().cloned().collect();

                        for port in ports {
                            if let Some(hist) = rtt_histogram_monitor.histogram.get(&port) {
                                let hist_config = &hist.config;
                                let mut bins_data = HashMap::new();

                                for b in 0..hist_config.num_bins {
                                    if let Some(mapping) = port_mapping.get(&port) {
                                        let rx_port = mapping.rx_recirculation;

                                        let hist_entries: Vec<&table::TableEntry> = res
                                            .iter()
                                            .filter(|t| {
                                                t.has_action_data("bin_index")
                                                    && t.get_action_data("bin_index").unwrap().as_u32()
                                                        == b
                                                    && t.has_key("ig_md.ig_port")
                                                    && t.get_key("ig_md.ig_port")
                                                        .unwrap()
                                                        .get_exact_value()
                                                        .to_u32()
                                                        == rx_port
                                            })
                                            .collect();

                                        let pkt_bin_count: u128 = hist_entries
                                            .iter()
                                            .map(|e| {
                                                e.get_action_data("$COUNTER_SPEC_PKTS")
                                                    .unwrap()
                                                    .as_u128()
                                            })
                                            .sum();
                                        bins_data.insert(b, pkt_bin_count);
                                    }
                                }

                                // Calculate percentiles
                                let percentiles: Vec<f64> = vec![0.25, 0.5, 0.75, 0.9];
                                let percentile_results =
                                    Self::estimate_percentiles_from_bins(&bins_data, percentiles, hist);

                                if let Some(hist_data_mut) =
                                    rtt_histogram_monitor.histogram.get_mut(&port)
                                {
                                    hist_data_mut.data.data_bins = bins_data;
                                    hist_data_mut.data.percentiles = percentile_results;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!("Encountered error while retrieving {RTT_HISTOGRAM_TABLE} table. Error: {e:#?}");
                    }
                }
            }


            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    /// Decomposes a [start, end] range into a set of ternary (value, mask) entries.
    /// Uses bitmask covering similar to prefix expansion.
    fn range_to_ternary_entries(
        &self,
        port: u32,
        start: u32,
        end: u32,
        bin_index: u32,
    ) -> Vec<Request> {
        let mut requests = Vec::new();
        let mut cur = start;

        while cur <= end {
            let remaining = end - cur;
            if remaining == 0 {
                // Handle a single value case explicitly
                let prio = 10u32.saturating_sub(bin_index);
                let req = Request::new(RTT_HISTOGRAM_TABLE)
                    .match_key("ig_md.ig_port", MatchValue::exact(port))
                    .match_key("ig_md.rtt", MatchValue::ternary(cur, 0xFFFFFFFF)) // exact match
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(prio))
                    .action("ingress.p4tg.rtt.count_histogram_bin")
                    .action_data("bin_index", bin_index);
                requests.push(req);
                break;
            }

            let max_block_size = 1 << (31 - remaining.leading_zeros()); // largest power of two ≤ remaining
            let align_size = 1 << cur.trailing_zeros(); // alignment constraint
            let size = max_block_size.min(align_size);

            let mask = !(size - 1);
            let prio = 10u32.saturating_sub(bin_index);

            let req = Request::new(RTT_HISTOGRAM_TABLE)
                .match_key("ig_md.ig_port", MatchValue::exact(port))
                .match_key("ig_md.rtt", MatchValue::ternary(cur, mask))
                .match_key("$MATCH_PRIORITY", MatchValue::exact(prio))
                .action("ingress.p4tg.rtt.count_histogram_bin")
                .action_data("bin_index", bin_index);

            requests.push(req);

            cur += size;
        }

        requests
    }

    fn estimate_percentiles_from_bins(
        bins_data: &HashMap<u32, u128>,
        percentiles: Vec<f64>,
        hist: &RttHistogram,
    ) -> HashMap<u32, f64> {
        let hist_config = &hist.config;

        let bin_width = hist_config.get_bin_width();

        // Sort bin indices just to be sure
        let mut sorted_bins: Vec<_> = bins_data.iter().collect();
        sorted_bins.sort_by_key(|&(index, _)| *index);

        let total: u128 = sorted_bins.iter().map(|&(_, count)| *count).sum();

        let mut results = HashMap::new();
        let mut cumulative = 0u128;
        let mut current_percentile_index = 0;

        for &(bin_index, count) in &sorted_bins {
            // Calculate cumulative sum of bins until percentile is reached
            cumulative += count;
            let current_fraction = cumulative as f64 / total as f64;

            // Catch up on all percentiles less than or equal to this point
            while current_percentile_index < percentiles.len()
                && current_fraction >= percentiles[current_percentile_index]
            {
                let percentile = percentiles[current_percentile_index];
                let bin_start: f64 = *bin_index as f64 * bin_width as f64;
                let bin_mid = bin_start + (bin_width as f64 / 2.0);
                results.insert(
                    (percentile * 100.0) as u32,
                    bin_mid + hist_config.min as f64,
                );
                current_percentile_index += 1;
            }

            if current_percentile_index >= percentiles.len() {
                break;
            }
        }

        results
    }
}

#[async_trait]
impl TrafficGenEvent for HistogramMonitor {
    async fn on_start(
        &mut self,
        switch: &SwitchConnection,
        _mode: &GenerationMode,
    ) -> Result<(), RBFRTError> {
        // Reconfigures the histogram table
        self.init_rtt_histogram_table(switch).await?;

        for (_, hist) in self.histogram.iter_mut() {
            hist.data.data_bins.clear();
            hist.data.percentiles.clear();
        }

        Ok(())
    }

    async fn on_stop(&self, _switch: &SwitchConnection) -> Result<(), RBFRTError> {
        Ok(())
    }

    /// Reset the state.
    async fn on_reset(&mut self, switch: &SwitchConnection) -> Result<(), RBFRTError> {
        // Reconfigures the histogram table
        self.init_rtt_histogram_table(switch).await?;

        for (_, hist) in self.histogram.iter_mut() {
            hist.data.data_bins.clear();
            hist.data.percentiles.clear();
        }

        Ok(())
    }
}
