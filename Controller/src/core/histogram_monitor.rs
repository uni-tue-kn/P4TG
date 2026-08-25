use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
    time::Duration,
};

use async_trait::async_trait;
use log::{info, warn};
use rbfrt::{
    error::RBFRTError,
    table::{self, MatchValue, Request, TableEntry, ToBytes},
    SwitchConnection,
};

use crate::core::{
    statistics::{HistogramBreakdown, HistogramConfig, HistogramData, HistogramPacketPath},
    traffic_gen_core::{
        const_definitions::{IAT_HISTOGRAM_TABLE, RTT_HISTOGRAM_TABLE},
        helper::range_to_ternary,
        types::HistogramType,
    },
};
use crate::{AppState, PortMapping};

use super::{
    statistics::{Histogram, HistogramBinEntry},
    traffic_gen_core::{event::TrafficGenEvent, types::GenerationMode},
};

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HistogramPathSelection {
    /// False means every route contributing to this physical path uses the
    /// legacy wildcard configuration.
    pub explicit: bool,
    pub active: HashSet<u8>,
    pub aggregate: HashSet<u8>,
    pub separate: HashSet<u8>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HistogramPortSelections {
    pub tx: HistogramPathSelection,
    pub rx: HistogramPathSelection,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
enum HistogramCounterGroup {
    Legacy,
    Aggregate,
    Stream(u8),
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct AppFilter {
    value: u8,
    mask: u8,
    group: HistogramCounterGroup,
}

#[derive(Clone, Debug)]
pub struct HistogramMonitor {
    port_mapping: HashMap<u32, PortMapping>,
    pub histogram: HashMap<u32, Histogram>,
    pub hist_type: HistogramType,
    /// Dev ports that transmit in the current test. Only these get entries on
    /// their TX recirculation port; entries on other paths never match traffic.
    pub tx_ports: HashSet<u32>,
    /// Dev ports that receive in the current test. Only these get entries on
    /// their RX recirculation port.
    pub rx_ports: HashSet<u32>,
    /// Logical dev-port selections for the TX and RX recirculation paths.
    pub selections: HashMap<u32, HistogramPortSelections>,
    /// Maps the physical recirculation port and programmed app mask back to
    /// the logical result group used while reading direct counters.
    counter_groups: HashMap<(u32, u8, u8), HistogramCounterGroup>,
}

fn classify_route(selection: &mut HistogramPathSelection, app_id: u8, config: &HistogramConfig) {
    selection.active.insert(app_id);
    let Some(groups) = config
        .stream_groups
        .as_ref()
        .filter(|groups| !groups.is_empty())
    else {
        // A legacy target contributes all of its active streams. If another
        // target sharing this TX path is explicit, this app becomes part of
        // the aggregate group compiled for the shared path.
        selection.aggregate.insert(app_id);
        return;
    };

    selection.explicit = true;
    if groups.separate.contains(&app_id) {
        selection.separate.insert(app_id);
    } else if groups.aggregate.contains(&app_id) {
        selection.aggregate.insert(app_id);
    }
}

/// Builds stream classifications per logical port/path from active
/// `(tx_dev_port, rx_dev_port, app_id)` routes. Histogram configurations are
/// keyed by RX dev port; IAT propagates each route's target classification to
/// the corresponding TX path.
pub fn build_histogram_selections(
    routes: &[(u32, u32, u8)],
    rx_configs: &HashMap<u32, HistogramConfig>,
    hist_type: &HistogramType,
) -> HashMap<u32, HistogramPortSelections> {
    let mut result: HashMap<u32, HistogramPortSelections> = HashMap::new();

    for &(tx, rx, app_id) in routes {
        let config = rx_configs
            .get(&rx)
            .cloned()
            .unwrap_or_else(|| match hist_type {
                HistogramType::Rtt => HistogramConfig::default_rtt(),
                HistogramType::Iat => HistogramConfig::default_iat(),
            });
        classify_route(&mut result.entry(rx).or_default().rx, app_id, &config);
        if matches!(hist_type, HistogramType::Iat) {
            classify_route(&mut result.entry(tx).or_default().tx, app_id, &config);
        }
    }

    result
}

fn ternary_matches(app_id: u8, value: u8, mask: u8) -> bool {
    app_id & mask == value & mask
}

type AppIdBitSet = [u64; 4];

fn app_id_bit_set(ids: impl Iterator<Item = u8>) -> AppIdBitSet {
    let mut result = [0; 4];
    for id in ids {
        result[id as usize / 64] |= 1u64 << (id as usize % 64);
    }
    result
}

fn bit_set_count(value: &AppIdBitSet) -> u32 {
    value.iter().map(|word| word.count_ones()).sum()
}

fn bit_set_contains(superset: &AppIdBitSet, subset: &AppIdBitSet) -> bool {
    superset
        .iter()
        .zip(subset)
        .all(|(superset, subset)| superset & subset == *subset)
}

fn minimum_cover_search(
    full: &AppIdBitSet,
    candidates: &[(u8, u8, AppIdBitSet)],
    covered: AppIdBitSet,
    chosen: &mut Vec<(u8, u8)>,
    best: &mut Vec<(u8, u8)>,
    visited: &mut HashMap<AppIdBitSet, usize>,
) {
    if bit_set_contains(&covered, full) {
        if chosen.len() < best.len() {
            *best = chosen.clone();
        }
        return;
    }
    if chosen.len() >= best.len() {
        return;
    }
    if visited
        .get(&covered)
        .is_some_and(|previous_len| *previous_len <= chosen.len())
    {
        return;
    }
    visited.insert(covered, chosen.len());

    let uncovered = std::array::from_fn(|index| full[index] & !covered[index]);
    let max_new = candidates
        .iter()
        .map(|(_, _, coverage)| {
            bit_set_count(&std::array::from_fn(|index| {
                coverage[index] & uncovered[index]
            }))
        })
        .max()
        .unwrap_or(0) as usize;
    if max_new == 0
        || chosen.len() + (bit_set_count(&uncovered) as usize).div_ceil(max_new) >= best.len()
    {
        return;
    }

    // Branch on the uncovered app ID with the fewest matching candidates.
    // This keeps the exact search small even for the full u8 app-ID space.
    let mut branch_candidates: Vec<usize> = vec![];
    for app_id in 0..=u8::MAX {
        let word = app_id as usize / 64;
        let bit = 1u64 << (app_id as usize % 64);
        if uncovered[word] & bit == 0 {
            continue;
        }
        let matching: Vec<usize> = candidates
            .iter()
            .enumerate()
            .filter_map(|(index, (_, _, coverage))| (coverage[word] & bit != 0).then_some(index))
            .collect();
        if branch_candidates.is_empty() || matching.len() < branch_candidates.len() {
            branch_candidates = matching;
        }
    }

    branch_candidates.sort_by(|left, right| {
        let left_new = std::array::from_fn(|index| candidates[*left].2[index] & uncovered[index]);
        let right_new = std::array::from_fn(|index| candidates[*right].2[index] & uncovered[index]);
        bit_set_count(&right_new)
            .cmp(&bit_set_count(&left_new))
            .then_with(|| candidates[*left].1.cmp(&candidates[*right].1))
            .then_with(|| candidates[*left].0.cmp(&candidates[*right].0))
    });

    for candidate_index in branch_candidates {
        let (value, mask, coverage) = candidates[candidate_index];
        let next = std::array::from_fn(|index| covered[index] | coverage[index]);
        chosen.push((value, mask));
        minimum_cover_search(full, candidates, next, chosen, best, visited);
        chosen.pop();
    }
}

/// Returns a deterministic minimum ternary cover for the aggregate set. Exact
/// per-stream IDs are don't-cares because their higher-priority entries win;
/// active IDs in neither selected set must never be matched.
pub fn minimum_app_ternary_cover(
    aggregate: &HashSet<u8>,
    separate: &HashSet<u8>,
    active: &HashSet<u8>,
) -> Vec<(u8, u8)> {
    if aggregate.is_empty() {
        return vec![];
    }

    let excluded: HashSet<u8> = active
        .difference(aggregate)
        .filter(|app_id| !separate.contains(app_id))
        .copied()
        .collect();

    let mut seen = HashSet::new();
    let mut candidates_by_coverage: HashMap<AppIdBitSet, (u8, u8)> = HashMap::new();
    for &app_id in aggregate {
        for mask in 0u16..=u8::MAX as u16 {
            let mask = mask as u8;
            let value = app_id & mask;
            if !seen.insert((value, mask))
                || excluded
                    .iter()
                    .any(|excluded_id| ternary_matches(*excluded_id, value, mask))
            {
                continue;
            }

            let coverage = app_id_bit_set(
                aggregate
                    .iter()
                    .copied()
                    .filter(|candidate_id| ternary_matches(*candidate_id, value, mask)),
            );
            candidates_by_coverage
                .entry(coverage)
                .and_modify(|current| {
                    if (mask.count_ones(), mask, value)
                        < (current.1.count_ones(), current.1, current.0)
                    {
                        *current = (value, mask);
                    }
                })
                .or_insert((value, mask));
        }
    }

    let mut candidates: Vec<(u8, u8, AppIdBitSet)> = candidates_by_coverage
        .into_iter()
        .map(|(coverage, (value, mask))| (value, mask, coverage))
        .collect();
    candidates.sort_by(|left, right| {
        bit_set_count(&right.2)
            .cmp(&bit_set_count(&left.2))
            .then_with(|| left.1.count_ones().cmp(&right.1.count_ones()))
            .then_with(|| left.1.cmp(&right.1))
            .then_with(|| left.0.cmp(&right.0))
    });

    // A candidate covering a strict subset of another candidate can never
    // improve the number of entries, so discard it before the exact search.
    let mut prime_candidates: Vec<(u8, u8, AppIdBitSet)> = vec![];
    for candidate in candidates {
        if !prime_candidates
            .iter()
            .any(|prime| bit_set_contains(&prime.2, &candidate.2))
        {
            prime_candidates.push(candidate);
        }
    }

    let full = app_id_bit_set(aggregate.iter().copied());
    let mut best: Vec<(u8, u8)> = aggregate
        .iter()
        .copied()
        .map(|app_id| (app_id, u8::MAX))
        .collect();
    let mut chosen = vec![];
    let mut visited = HashMap::new();
    minimum_cover_search(
        &full,
        &prime_candidates,
        [0; 4],
        &mut chosen,
        &mut best,
        &mut visited,
    );
    best.sort_unstable();
    best
}

fn app_filters(selection: &HistogramPathSelection) -> Vec<AppFilter> {
    if !selection.explicit {
        return vec![AppFilter {
            value: 0,
            mask: 0,
            group: HistogramCounterGroup::Legacy,
        }];
    }

    let mut filters: Vec<AppFilter> =
        minimum_app_ternary_cover(&selection.aggregate, &selection.separate, &selection.active)
            .into_iter()
            .map(|(value, mask)| AppFilter {
                value,
                mask,
                group: HistogramCounterGroup::Aggregate,
            })
            .collect();

    let mut separate: Vec<u8> = selection.separate.iter().copied().collect();
    separate.sort_unstable();
    filters.extend(separate.into_iter().map(|app_id| AppFilter {
        value: app_id,
        mask: u8::MAX,
        group: HistogramCounterGroup::Stream(app_id),
    }));
    filters
}

pub fn histogram_app_filter_count(selection: &HistogramPathSelection) -> usize {
    app_filters(selection).len()
}

/// Number of ternary table entries needed to model all bins of `config`
/// on a single ingress port.
pub fn histogram_entry_count(config: &HistogramConfig) -> u32 {
    let bin_width = config.get_bin_width();
    let mut entries = 0;

    for bin_index in 0..config.num_bins {
        let start = config.min + bin_index * bin_width;
        let mut end = start + bin_width - 1;
        if end > config.max {
            end = config.max;
        }
        entries += range_to_ternary(start, end).len() as u32;
    }

    entries
}

/// Derives the TX and RX roles (dev ports) from the TX -> RX dev port mapping.
pub fn histogram_port_roles(
    tx_rx_dev_mapping: &HashMap<String, u32>,
) -> (HashSet<u32>, HashSet<u32>) {
    let tx_ports = tx_rx_dev_mapping
        .keys()
        .filter_map(|tx| tx.parse().ok())
        .collect();
    let rx_ports = tx_rx_dev_mapping.values().copied().collect();
    (tx_ports, rx_ports)
}

/// Derives histogram roles from a topology that may contain multiple RX ports
/// for the same TX port.
pub fn histogram_edge_roles(edges: &HashSet<(u32, u32)>) -> (HashSet<u32>, HashSet<u32>) {
    (
        edges.iter().map(|(tx, _)| *tx).collect(),
        edges.iter().map(|(_, rx)| *rx).collect(),
    )
}

/// Resolves the front panel port + channel keyed histogram configs to dev ports.
fn resolve_histogram_configs(
    configs: Option<&HashMap<String, HashMap<String, HistogramConfig>>>,
    front_panel_dev_port_mappings: &HashMap<u32, u32>,
) -> HashMap<u32, HistogramConfig> {
    let mut result = HashMap::new();

    if let Some(configs) = configs {
        for (front_panel_port, channel_map) in configs {
            let Some(dev_port_base) = front_panel_port
                .parse::<u32>()
                .ok()
                .and_then(|fp| front_panel_dev_port_mappings.get(&fp))
            else {
                continue;
            };
            for (channel, config) in channel_map {
                let dev_port = dev_port_base + channel.parse::<u32>().unwrap_or(0);
                result.insert(dev_port, config.clone());
            }
        }
    }

    result
}

/// Builds the dev port keyed IAT histogram configs that will be materialized as
/// table entries. RX-keyed payload configs are propagated to TX mates without an
/// own config; remaining active ports fall back to the default config.
///
/// Used by both the table writer and the request validator so that the
/// validator counts exactly what gets written.
pub fn build_iat_histogram_configs(
    configs: Option<&HashMap<String, HashMap<String, HistogramConfig>>>,
    tx_rx_dev_mapping: &HashMap<String, u32>,
    front_panel_dev_port_mappings: &HashMap<u32, u32>,
) -> HashMap<u32, HistogramConfig> {
    let edges: HashSet<(u32, u32)> = tx_rx_dev_mapping
        .iter()
        .filter_map(|(tx, rx)| tx.parse().ok().map(|tx| (tx, *rx)))
        .collect();
    build_iat_histogram_configs_for_edges(configs, &edges, front_panel_dev_port_mappings)
}

pub fn build_iat_histogram_configs_for_edges(
    configs: Option<&HashMap<String, HashMap<String, HistogramConfig>>>,
    edges: &HashSet<(u32, u32)>,
    front_panel_dev_port_mappings: &HashMap<u32, u32>,
) -> HashMap<u32, HistogramConfig> {
    let mut result = resolve_histogram_configs(configs, front_panel_dev_port_mappings);

    // Propagate an RX config only when a TX has one unambiguous RX mate.
    let mut targets_by_tx: HashMap<u32, HashSet<u32>> = HashMap::new();
    for (tx, rx) in edges {
        targets_by_tx.entry(*tx).or_default().insert(*rx);
    }
    let propagated: Vec<(u32, HistogramConfig)> = targets_by_tx
        .iter()
        .filter_map(|(tx, targets)| {
            if result.contains_key(&tx) {
                return None;
            }
            let rx = targets.iter().next().filter(|_| targets.len() == 1)?;
            result.get(rx).map(|config| (*tx, config.clone()))
        })
        .collect();
    result.extend(propagated);

    // Default config for active ports without any config
    for (tx, rx) in edges {
        result
            .entry(*tx)
            .or_insert_with(HistogramConfig::default_iat);
        result
            .entry(*rx)
            .or_insert_with(HistogramConfig::default_iat);
    }

    result
}

/// Builds the dev port keyed RTT histogram configs that will be materialized as
/// table entries. RTT is only measured on the RX path, so only RX ports get a
/// default config.
///
/// Used by both the table writer and the request validator so that the
/// validator counts exactly what gets written.
pub fn build_rtt_histogram_configs(
    configs: Option<&HashMap<String, HashMap<String, HistogramConfig>>>,
    tx_rx_dev_mapping: &HashMap<String, u32>,
    front_panel_dev_port_mappings: &HashMap<u32, u32>,
) -> HashMap<u32, HistogramConfig> {
    let rx_ports = tx_rx_dev_mapping.values().copied().collect();
    build_rtt_histogram_configs_for_rx_ports(configs, &rx_ports, front_panel_dev_port_mappings)
}

pub fn build_rtt_histogram_configs_for_rx_ports(
    configs: Option<&HashMap<String, HashMap<String, HistogramConfig>>>,
    rx_ports: &HashSet<u32>,
    front_panel_dev_port_mappings: &HashMap<u32, u32>,
) -> HashMap<u32, HistogramConfig> {
    let mut result = resolve_histogram_configs(configs, front_panel_dev_port_mappings);

    // Default config for active RX ports without any config
    for rx in rx_ports {
        result
            .entry(*rx)
            .or_insert_with(HistogramConfig::default_rtt);
    }

    result
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
            tx_ports: Default::default(),
            rx_ports: Default::default(),
            selections: Default::default(),
            counter_groups: Default::default(),
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
        self.counter_groups.clear();

        for (port, hist) in self.histogram.iter() {
            let Some(mapping) = self.port_mapping.get(port) else {
                continue;
            };

            // Only write entries for the recirculation paths that carry traffic
            // for this port. TX IAT is measured on the TX recirculation port of
            // sending ports, RX IAT/RTT on the RX recirculation port of
            // receiving ports; entries on other paths never match.
            let write_rx = self.rx_ports.contains(port);
            let write_tx =
                matches!(self.hist_type, HistogramType::Iat) && self.tx_ports.contains(port);

            if !write_rx && !write_tx {
                continue;
            }

            let hist_config = &hist.config;
            let selections = self.selections.get(port).cloned().unwrap_or_default();
            let rx_filters = if write_rx {
                app_filters(&selections.rx)
            } else {
                vec![]
            };
            let tx_filters = if write_tx {
                app_filters(&selections.tx)
            } else {
                vec![]
            };

            for filter in &rx_filters {
                self.counter_groups.insert(
                    (mapping.rx_recirculation, filter.value, filter.mask),
                    filter.group,
                );
            }
            for filter in &tx_filters {
                self.counter_groups.insert(
                    (mapping.tx_recirculation, filter.value, filter.mask),
                    filter.group,
                );
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

                let ternary_entries = range_to_ternary(start, end);

                for filter in &rx_filters {
                    requests.extend(self.build_ternary_table_entries(
                        ternary_entries.clone(),
                        mapping.rx_recirculation,
                        bin_index,
                        *filter,
                    ));
                }
                for filter in &tx_filters {
                    requests.extend(self.build_ternary_table_entries(
                        ternary_entries.clone(),
                        mapping.tx_recirculation,
                        bin_index,
                        *filter,
                    ));
                }
            }

            // One numeric wildcard per app filter catches outliers for that
            // logical group.
            for filter in &rx_filters {
                requests.push(self.build_missed_bin_entry(mapping.rx_recirculation, *filter));
            }
            for filter in &tx_filters {
                requests.push(self.build_missed_bin_entry(mapping.tx_recirculation, *filter));
            }
        }

        let number_requests = requests.len();

        if !requests.is_empty() {
            switch.write_table_entries(requests).await?;
            info!("Configured table {table_name} with {number_requests} entries.");
        }

        Ok(())
    }

    /// Aggregates the histogram counters of one ingress port. `hist_entries`
    /// must already be narrowed to that port.
    fn aggregate_histogram_data(
        hist_entries: &[&TableEntry],
        hist_type: &HistogramType,
        hist_config: &HistogramConfig,
    ) -> HistogramData {
        let action_name = match hist_type {
            HistogramType::Rtt => "ingress.p4tg.rtt.count_missed_bin",
            HistogramType::Iat => "ingress.p4tg.iat.count_missed_bin",
        };

        // Single pass. A scan per bin is quadratic in num_bins: ~2 s per call
        // at 4096 bins, without yielding, which stalls the digest consumer.
        let mut bin_counts = vec![0u128; hist_config.num_bins as usize];
        let mut missed_bin_count: u128 = 0;

        for entry in hist_entries {
            let packets = entry
                .get_action_data("$COUNTER_SPEC_PKTS")
                .map(|data| data.as_u128())
                .unwrap_or(0);

            // Entry for this port with missed bin action
            if entry.get_action_name() == action_name {
                missed_bin_count += packets;
                continue;
            }

            if let Ok(bin_index) = entry.get_action_data("bin_index") {
                if let Some(count) = bin_counts.get_mut(bin_index.as_u32() as usize) {
                    *count += packets;
                }
            }
        }

        let bin_width = hist_config.get_bin_width() as f64;

        let mut bins_data = HashMap::with_capacity(bin_counts.len());
        // Used to calculate the mean RTT based on the histogram
        let mut running_sum: f64 = 0.0;
        let mut running_sum_square: f64 = 0.0;
        let mut total_pkt_count = 0;

        for (b, &pkt_bin_count) in bin_counts.iter().enumerate() {
            // Insert bin count. Probabilities will be updated later
            bins_data.insert(
                b as u32,
                HistogramBinEntry {
                    count: pkt_bin_count,
                    probability: 0f64,
                },
            );

            let bin_middle_value: f64 =
                hist_config.min as f64 + b as f64 * bin_width + (bin_width / 2f64);

            running_sum += bin_middle_value * pkt_bin_count as f64;
            running_sum_square += bin_middle_value.powi(2) * pkt_bin_count as f64;
            total_pkt_count += pkt_bin_count;
        }

        // Calculate percentiles
        let percentiles = hist_config
            .percentiles
            .clone()
            .unwrap_or(vec![0.25, 0.5, 0.75, 0.9]);

        let percentile_results =
            Self::estimate_percentiles_from_bins(&bins_data, percentiles, hist_config);

        // Calculate mean from histogram data
        // Guard against 0 or 1 total packets: the divisions would produce NaN
        // (serialized as null in JSON) or an infinite variance.
        let mean_hist: f64 = if total_pkt_count > 0 {
            (running_sum / total_pkt_count as f64).max(0f64)
        } else {
            0f64
        };

        let std_dev = if total_pkt_count > 1 {
            let variance = (total_pkt_count as f64 / (total_pkt_count as f64 - 1f64))
                * ((running_sum_square / total_pkt_count as f64).max(0f64) - mean_hist.powi(2));
            variance.max(0f64).sqrt()
        } else {
            0f64
        };

        // Map y-axis of histogram to probability from [0, 1]
        for entry in bins_data.values_mut() {
            entry.probability = if total_pkt_count > 0 {
                entry.count as f64 / total_pkt_count as f64 * 100f64
            } else {
                0f64
            };
        }

        HistogramData {
            data_bins: bins_data,
            percentiles: percentile_results,
            missed_bin_count,
            total_pkt_count,
            mean: mean_hist,
            std_dev,
        }
    }

    /// Fetches histogram data for the Configuration GUI.
    ///
    /// - `state`: App state that holds the switch connection.
    pub async fn monitor_histogram(state: Arc<AppState>, hist_type: HistogramType) {
        let table_name = match hist_type {
            HistogramType::Rtt => RTT_HISTOGRAM_TABLE,
            HistogramType::Iat => IAT_HISTOGRAM_TABLE,
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
                        // Group once instead of re-filtering the full table for
                        // every port and result group below.
                        let mut entries_by_port: HashMap<u32, Vec<&TableEntry>> = HashMap::new();
                        let mut entries_by_filter: HashMap<(u32, u8, u8), Vec<&TableEntry>> =
                            HashMap::new();
                        for entry in &res {
                            if let Ok(key) = entry.get_key("ig_md.ig_port") {
                                let port = key.get_exact_value().to_u32();
                                entries_by_port.entry(port).or_default().push(entry);
                                if let Ok(MatchValue::Ternary { value, mask }) =
                                    entry.get_key("hdr.path.app_id")
                                {
                                    entries_by_filter
                                        .entry((port, value.to_u32() as u8, mask.to_u32() as u8))
                                        .or_default()
                                        .push(entry);
                                }
                            }
                        }

                        let mut histogram_monitor = match hist_type {
                            HistogramType::Rtt => state.rtt_histogram_monitor.lock().await,
                            HistogramType::Iat => state.iat_histogram_monitor.lock().await,
                        };

                        let port_mapping = histogram_monitor.port_mapping.clone();
                        let selections = histogram_monitor.selections.clone();
                        let mut entries_by_group: HashMap<
                            (u32, HistogramCounterGroup),
                            Vec<&TableEntry>,
                        > = HashMap::new();
                        for (filter_key, entries) in entries_by_filter {
                            if let Some(group) = histogram_monitor.counter_groups.get(&filter_key) {
                                entries_by_group
                                    .entry((filter_key.0, *group))
                                    .or_default()
                                    .extend(entries);
                            }
                        }

                        // Clone keys so we can iterate without borrowing whole map
                        let ports: Vec<u32> = histogram_monitor.histogram.keys().cloned().collect();

                        for port in ports {
                            if let Some(hist) = histogram_monitor.histogram.get(&port) {
                                let hist_config = hist.config.clone();

                                if let Some(mapping) = port_mapping.get(&port) {
                                    let rx_port = mapping.rx_recirculation;

                                    let rx_histogram_data = Self::aggregate_histogram_data(
                                        entries_by_port
                                            .get(&rx_port)
                                            .map(Vec::as_slice)
                                            .unwrap_or_default(),
                                        &hist_type,
                                        &hist_config,
                                    );

                                    let tx_histogram_data = if let HistogramType::Iat = hist_type {
                                        let tx_port = mapping.tx_recirculation;
                                        Some(Self::aggregate_histogram_data(
                                            entries_by_port
                                                .get(&tx_port)
                                                .map(Vec::as_slice)
                                                .unwrap_or_default(),
                                            &hist_type,
                                            &hist_config,
                                        ))
                                    } else {
                                        None
                                    };

                                    let port_selection =
                                        selections.get(&port).cloned().unwrap_or_default();
                                    let has_breakdown = port_selection.rx.explicit
                                        || (matches!(hist_type, HistogramType::Iat)
                                            && port_selection.tx.explicit);
                                    let mut breakdown =
                                        has_breakdown.then(HistogramBreakdown::default);

                                    if let Some(ref mut breakdown) = breakdown {
                                        let rx_aggregate = port_selection.rx.explicit
                                            && !port_selection.rx.aggregate.is_empty();
                                        let tx_aggregate = matches!(hist_type, HistogramType::Iat)
                                            && port_selection.tx.explicit
                                            && !port_selection.tx.aggregate.is_empty();
                                        if rx_aggregate || tx_aggregate {
                                            let aggregate = breakdown
                                                .aggregate
                                                .get_or_insert_with(HistogramPacketPath::default);
                                            if rx_aggregate {
                                                aggregate.rx = Self::aggregate_histogram_data(
                                                    entries_by_group
                                                        .get(&(
                                                            rx_port,
                                                            HistogramCounterGroup::Aggregate,
                                                        ))
                                                        .map(Vec::as_slice)
                                                        .unwrap_or_default(),
                                                    &hist_type,
                                                    &hist_config,
                                                );
                                            }
                                            if tx_aggregate {
                                                aggregate.tx = Self::aggregate_histogram_data(
                                                    entries_by_group
                                                        .get(&(
                                                            mapping.tx_recirculation,
                                                            HistogramCounterGroup::Aggregate,
                                                        ))
                                                        .map(Vec::as_slice)
                                                        .unwrap_or_default(),
                                                    &hist_type,
                                                    &hist_config,
                                                );
                                            }
                                        }

                                        let stream_ids: HashSet<u8> = port_selection
                                            .rx
                                            .separate
                                            .union(&port_selection.tx.separate)
                                            .copied()
                                            .collect();
                                        for app_id in stream_ids {
                                            let path =
                                                breakdown.per_stream.entry(app_id).or_default();
                                            if port_selection.rx.separate.contains(&app_id) {
                                                path.rx = Self::aggregate_histogram_data(
                                                    entries_by_group
                                                        .get(&(
                                                            rx_port,
                                                            HistogramCounterGroup::Stream(app_id),
                                                        ))
                                                        .map(Vec::as_slice)
                                                        .unwrap_or_default(),
                                                    &hist_type,
                                                    &hist_config,
                                                );
                                            }
                                            if matches!(hist_type, HistogramType::Iat)
                                                && port_selection.tx.separate.contains(&app_id)
                                            {
                                                path.tx = Self::aggregate_histogram_data(
                                                    entries_by_group
                                                        .get(&(
                                                            mapping.tx_recirculation,
                                                            HistogramCounterGroup::Stream(app_id),
                                                        ))
                                                        .map(Vec::as_slice)
                                                        .unwrap_or_default(),
                                                    &hist_type,
                                                    &hist_config,
                                                );
                                            }
                                        }
                                    }

                                    // Write data
                                    if let Some(hist_data_mut) =
                                        histogram_monitor.histogram.get_mut(&port)
                                    {
                                        hist_data_mut.data.rx = rx_histogram_data;
                                        if let Some(tx_data) = tx_histogram_data {
                                            hist_data_mut.data.tx = tx_data;
                                        }
                                        hist_data_mut.breakdown = breakdown;
                                    }
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
        app_filter: AppFilter,
    ) -> Vec<Request> {
        let priority = match app_filter.group {
            HistogramCounterGroup::Legacy | HistogramCounterGroup::Stream(_) => 0,
            HistogramCounterGroup::Aggregate => 2,
        };
        entries
            .into_iter()
            .map(|(value, mask)| match self.hist_type {
                HistogramType::Rtt => Request::new(RTT_HISTOGRAM_TABLE)
                    .match_key("ig_md.ig_port", MatchValue::exact(port))
                    .match_key("ig_md.rtt", MatchValue::ternary(value, mask))
                    .match_key(
                        "hdr.path.app_id",
                        MatchValue::ternary(app_filter.value, app_filter.mask),
                    )
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                    .action("ingress.p4tg.rtt.count_histogram_bin")
                    .action_data("bin_index", bin_index),
                HistogramType::Iat => Request::new(IAT_HISTOGRAM_TABLE)
                    .match_key("ig_md.ig_port", MatchValue::exact(port))
                    .match_key("ig_md.iat", MatchValue::ternary(value, mask))
                    .match_key(
                        "hdr.path.app_id",
                        MatchValue::ternary(app_filter.value, app_filter.mask),
                    )
                    .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                    .action("ingress.p4tg.iat.count_histogram_bin")
                    .action_data("bin_index", bin_index),
            })
            .collect()
    }

    fn build_missed_bin_entry(&self, port: u32, app_filter: AppFilter) -> Request {
        let priority = match app_filter.group {
            HistogramCounterGroup::Legacy | HistogramCounterGroup::Stream(_) => 1,
            HistogramCounterGroup::Aggregate => 3,
        };
        match self.hist_type {
            HistogramType::Rtt => Request::new(RTT_HISTOGRAM_TABLE)
                .match_key("ig_md.ig_port", MatchValue::exact(port))
                .match_key("ig_md.rtt", MatchValue::ternary(0, 0))
                .match_key(
                    "hdr.path.app_id",
                    MatchValue::ternary(app_filter.value, app_filter.mask),
                )
                .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                .action("ingress.p4tg.rtt.count_missed_bin"),
            HistogramType::Iat => Request::new(IAT_HISTOGRAM_TABLE)
                .match_key("ig_md.ig_port", MatchValue::exact(port))
                .match_key("ig_md.iat", MatchValue::ternary(0, 0))
                .match_key(
                    "hdr.path.app_id",
                    MatchValue::ternary(app_filter.value, app_filter.mask),
                )
                .match_key("$MATCH_PRIORITY", MatchValue::exact(priority))
                .action("ingress.p4tg.iat.count_missed_bin"),
        }
    }

    fn estimate_percentiles_from_bins(
        bins_data: &HashMap<u32, HistogramBinEntry>,
        mut percentiles: Vec<f64>, // e.g. [0.25, 0.5, 0.75, 0.9]
        cfg: &HistogramConfig,
    ) -> HashMap<u32, f64> {
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
        for hist in self.histogram.values_mut() {
            hist.data = HistogramPacketPath::default();
            hist.breakdown = None;
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
