use std::{collections::HashMap, sync::Arc, time::Duration};

use async_trait::async_trait;
use log::{info, warn};
use rbfrt::{
    error::RBFRTError,
    table::{self, MatchValue, Request, ToBytes},
    SwitchConnection,
};

use crate::core::traffic_gen_core::{
    const_definitions::{IAT_HISTOGRAM_TABLE, RTT_HISTOGRAM_TABLE},
    helper::range_to_ternary,
    types::HistogramType,
};
use crate::{AppState, PortMapping};

use super::{
    statistics::{Histogram, HistogramBinEntry},
    traffic_gen_core::{event::TrafficGenEvent, types::GenerationMode},
};

#[derive(Clone, Debug)]
pub struct HistogramMonitor {
    port_mapping: HashMap<u32, PortMapping>,
    pub histogram: HashMap<u32, Histogram>,
    pub hist_type: HistogramType,
}

impl HistogramMonitor {
    pub fn new(
        port_mapping: HashMap<u32, PortMapping>,
        hist_type: HistogramType,
    ) -> HistogramMonitor {
        HistogramMonitor {
            port_mapping,
            histogram: Default::default(),
            hist_type,
        }
    }

    pub async fn init_rtt_histogram_table(
        &mut self,
        switch: &SwitchConnection,
    ) -> Result<(), RBFRTError> {
        let table_name = match self.hist_type {
            HistogramType::Rtt => RTT_HISTOGRAM_TABLE,
            HistogramType::Iat => IAT_HISTOGRAM_TABLE,
        };

        switch.clear_table(table_name).await?;

        let mut requests = vec![];

        for (port, hist) in self.histogram.iter() {
            let hist_config = &hist.config;

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
                    let ternary_entries = range_to_ternary(start, end);

                    requests.extend(self.build_ternary_table_entries(
                        ternary_entries,
                        mapping.rx_recirculation,
                        bin_index,
                    ));
                }
            }

            // Wildcard match on RTT per port. This entry catches outliers of the histogram
            if let Some(mapping) = self.port_mapping.get(port) {
                let req = match self.hist_type {
                    HistogramType::Rtt => Request::new(RTT_HISTOGRAM_TABLE)
                        .match_key("ig_md.ig_port", MatchValue::exact(mapping.rx_recirculation))
                        .match_key("ig_md.rtt", MatchValue::ternary(0, 0))
                        .action("ingress.p4tg.rtt.count_missed_bin"),
                    HistogramType::Iat => Request::new(IAT_HISTOGRAM_TABLE)
                        .match_key("ig_md.ig_port", MatchValue::exact(mapping.rx_recirculation))
                        .match_key("ig_md.iat", MatchValue::ternary(0, 0))
                        .action("ingress.p4tg.iat.count_missed_bin"),
                };
                requests.push(req);
            }
        }

        let number_requests = requests.len();

        if !requests.is_empty() {
            switch.write_table_entries(requests).await?;
            info!("Configured table {table_name} with {number_requests} entries.");
        }

        Ok(())
    }

    /// Fetches histogram data for the Configuration GUI.
    ///
    /// - `state`: App state that holds the switch connection.
    pub async fn monitor_histogram(state: Arc<AppState>, hist_type: HistogramType) {
        let table_name = match hist_type {
            HistogramType::Rtt => RTT_HISTOGRAM_TABLE,
            HistogramType::Iat => IAT_HISTOGRAM_TABLE,
        };
        let action_name = match hist_type {
            HistogramType::Rtt => "ingress.p4tg.rtt.count_missed_bin",
            HistogramType::Iat => "ingress.p4tg.iat.count_missed_bin",
        };

        loop {
            let running = {
                let experiment = state.experiment.lock().await;
                experiment.running
            };

            if running {
                let switch = &state.switch;
                // Sync Histogram counters
                {
                    let sync =
                        Request::new(table_name).operation(table::TableOperation::SyncCounters);
                    if switch.execute_operation(sync).await.is_err() {
                        warn!("Error in synchronization for table {table_name}.");
                    }
                }

                // Retrieve all entries from table for histogram
                let req = Request::new(table_name);

                match switch.get_table_entries(req).await {
                    Ok(res) => {
                        let mut histogram_monitor = match hist_type {
                            HistogramType::Rtt => state.rtt_histogram_monitor.lock().await,
                            HistogramType::Iat => state.iat_histogram_monitor.lock().await,
                        };

                        let port_mapping = histogram_monitor.port_mapping.clone();

                        // Clone keys so we can iterate without borrowing whole map
                        let ports: Vec<u32> = histogram_monitor.histogram.keys().cloned().collect();

                        for port in ports {
                            if let Some(hist) = histogram_monitor.histogram.get(&port) {
                                let hist_config = &hist.config;
                                let mut bins_data = HashMap::new();
                                let mut missed_bin_count = 0;
                                // Used to calculate the mean RTT based on the histogram
                                let mut running_sum: f64 = 0.0;
                                let mut running_sum_square: f64 = 0.0;
                                let mut total_pkt_count = 0;

                                if let Some(mapping) = port_mapping.get(&port) {
                                    let rx_port = mapping.rx_recirculation;

                                    // Filter all TableEntries for the current port
                                    let hist_entries: Vec<&table::TableEntry> = res
                                        .iter()
                                        .filter(|t| {
                                            t.has_key("ig_md.ig_port")
                                                && t.get_key("ig_md.ig_port")
                                                    .unwrap()
                                                    .get_exact_value()
                                                    .to_u32()
                                                    == rx_port // TODO tx port for IAT as well?
                                        })
                                        .collect();

                                    for b in 0..hist_config.num_bins {
                                        // Filter all TableEntries for the current bin_index and calculate sum
                                        let pkt_bin_count: u128 = hist_entries
                                            .iter()
                                            .filter(|t| {
                                                t.has_action_data("bin_index")
                                                    && t.get_action_data("bin_index")
                                                        .unwrap()
                                                        .as_u32()
                                                        == b
                                            })
                                            .map(|e| {
                                                e.get_action_data("$COUNTER_SPEC_PKTS")
                                                    .unwrap()
                                                    .as_u128()
                                            })
                                            .sum();
                                        // Insert bin count. Probabilities will be updated later
                                        bins_data.insert(
                                            b,
                                            HistogramBinEntry {
                                                count: pkt_bin_count,
                                                probability: 0f64,
                                            },
                                        );

                                        let bin_middle_value: f64 = hist_config.min as f64
                                            + b as f64 * hist_config.get_bin_width() as f64
                                            + (hist_config.get_bin_width() as f64 / 2f64);

                                        running_sum += bin_middle_value * pkt_bin_count as f64;
                                        running_sum_square +=
                                            bin_middle_value.powi(2) * pkt_bin_count as f64;
                                        total_pkt_count += pkt_bin_count;
                                    }

                                    // Get entry for this port with missed bin action
                                    missed_bin_count = hist_entries
                                        .iter()
                                        .filter(|t| t.get_action_name() == action_name)
                                        .map(|e| {
                                            e.get_action_data("$COUNTER_SPEC_PKTS")
                                                .unwrap()
                                                .as_u128()
                                        })
                                        .sum();
                                }

                                // Calculate percentiles
                                let percentiles = hist_config
                                    .percentiles
                                    .clone()
                                    .unwrap_or(vec![0.25, 0.5, 0.75, 0.9]);

                                let percentile_results = Self::estimate_percentiles_from_bins(
                                    &bins_data,
                                    percentiles,
                                    hist,
                                );

                                // Calculate mean from histogram data
                                let mean_hist: f64 =
                                    (running_sum / total_pkt_count as f64).max(0f64);

                                let variance = (total_pkt_count as f64
                                    / (total_pkt_count as f64 - 1f64))
                                    * ((running_sum_square / total_pkt_count as f64).max(0f64)
                                        - mean_hist.powi(2));
                                let std_dev = variance.sqrt();

                                // Map y-axis of histogram to probability from [0, 1]
                                for (_bin_index, entry) in bins_data.iter_mut() {
                                    entry.probability =
                                        entry.count as f64 / total_pkt_count as f64 * 100f64;
                                }

                                // Write data
                                if let Some(hist_data_mut) =
                                    histogram_monitor.histogram.get_mut(&port)
                                {
                                    hist_data_mut.data.data_bins = bins_data;
                                    hist_data_mut.data.percentiles = percentile_results;
                                    hist_data_mut.data.missed_bin_count = missed_bin_count;
                                    hist_data_mut.data.total_pkt_count = total_pkt_count;
                                    hist_data_mut.data.mean = mean_hist;
                                    hist_data_mut.data.std_dev = std_dev;
                                }
                            }
                        }
                    }
                    Err(e) => {
                        warn!(
                            "Encountered error while retrieving {table_name} table. Error: {e:#?}"
                        );
                    }
                }
            }

            tokio::time::sleep(Duration::from_secs(2)).await;
        }
    }

    fn build_ternary_table_entries(
        &self,
        entries: Vec<(u32, u32)>,
        port: u32,
        bin_index: u32,
    ) -> Vec<Request> {
        entries
            .into_iter()
            .map(|(value, mask)| match self.hist_type {
                HistogramType::Rtt => Request::new(RTT_HISTOGRAM_TABLE)
                    .match_key("ig_md.ig_port", MatchValue::exact(port))
                    .match_key("ig_md.rtt", MatchValue::ternary(value, mask))
                    .action("ingress.p4tg.rtt.count_histogram_bin")
                    .action_data("bin_index", bin_index),
                HistogramType::Iat => Request::new(IAT_HISTOGRAM_TABLE)
                    .match_key("ig_md.ig_port", MatchValue::exact(port))
                    .match_key("ig_md.iat", MatchValue::ternary(value, mask))
                    .action("ingress.p4tg.iat.count_histogram_bin")
                    .action_data("bin_index", bin_index),
            })
            .collect()
    }

    fn estimate_percentiles_from_bins(
        bins_data: &HashMap<u32, HistogramBinEntry>,
        mut percentiles: Vec<f64>, // e.g. [0.25, 0.5, 0.75, 0.9]
        hist: &Histogram,
    ) -> HashMap<u32, f64> {
        let cfg = &hist.config;
        let min = cfg.min as f64;
        let num_bins = cfg.num_bins as usize;
        if num_bins == 0 {
            return HashMap::new();
        }

        // Use floating bin width to match the frontend
        let bin_w = (cfg.max as f64 - cfg.min as f64) / cfg.num_bins as f64;

        // Sorted bins by index (missing bins treated as count=0)
        let sorted: Vec<(u32, u128)> = (0..cfg.num_bins)
            .map(|i| {
                let c = bins_data.get(&i).map(|e| e.count).unwrap_or(0);
                (i, c)
            })
            .collect();

        let total: f64 = sorted.iter().map(|&(_, c)| c as f64).sum();
        if total <= 0.0 {
            return HashMap::new();
        }

        percentiles.sort_by(|a, b| a.partial_cmp(b).unwrap());
        let mut out = HashMap::new();

        let mut cum_prev = 0.0; // cumulative fraction before current bin
        let mut p_idx = 0;

        for (i, count_u128) in sorted {
            if p_idx >= percentiles.len() {
                break;
            }
            let count = count_u128 as f64;
            let bin_frac = count / total;
            let cum_now = cum_prev + bin_frac;

            while p_idx < percentiles.len() && percentiles[p_idx] <= cum_now {
                let p = percentiles[p_idx].clamp(0.0, 1.0);
                // Linear interpolation within the bin
                let t = if bin_frac > 0.0 {
                    ((p - cum_prev) / bin_frac).clamp(0.0, 1.0)
                } else {
                    0.5 // empty bin; fall back to mid
                };
                let value = min + ((i as f64) + t) * bin_w;
                out.insert((p * 100.0).round() as u32, value);
                p_idx += 1;
            }

            cum_prev = cum_now;
        }

        out
    }

    fn clear_data(&mut self) {
        for (_, hist) in self.histogram.iter_mut() {
            hist.data.data_bins.clear();
            hist.data.percentiles.clear();
            hist.data.missed_bin_count = 0;
            hist.data.total_pkt_count = 0;
            hist.data.mean = 0f64;
            hist.data.std_dev = 0f64;
        }
    }
}

#[async_trait]
impl TrafficGenEvent for HistogramMonitor {
    async fn on_start(
        &mut self,
        switch: &SwitchConnection,
        _mode: &GenerationMode,
    ) -> Result<(), RBFRTError> {
        // Reconfigures the histogram table and deletes all statistics.
        // Histogram config is deleted in start_single_test
        self.init_rtt_histogram_table(switch).await?;
        self.clear_data();
        Ok(())
    }

    async fn on_stop(&self, _switch: &SwitchConnection) -> Result<(), RBFRTError> {
        Ok(())
    }

    /// Reset the state.
    async fn on_reset(&mut self, _switch: &SwitchConnection) -> Result<(), RBFRTError> {
        // Deletes all statistics, keeps the configuration
        self.clear_data();

        Ok(())
    }
}
