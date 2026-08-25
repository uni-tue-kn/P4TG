use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{error, info, warn};
use tokio_util::sync::CancellationToken;

use crate::api::traffic_gen::start_single_test;
use crate::core::traffic_gen_core::const_definitions::MONITORING_PACKET_INTERVAL;
use crate::core::traffic_gen_core::helper::{
    calculate_overhead, generate_front_panel_to_dev_port_mappings, get_batch_factor, get_num_pipes,
    translate_fp_channel_to_dev_port_mapping,
};
use crate::core::traffic_gen_core::optimization::calculate_send_behaviour;
use crate::core::traffic_gen_core::types::{
    GenerationMode, GenerationPattern, GenerationPatternConfig, GenerationUnit, Rfc2544Config,
    Rfc2544FrameLossResult, Rfc2544LatencyResult, Rfc2544LossToleranceUnit, Rfc2544PortMapping,
    Rfc2544ResetResult, Rfc2544Results, Rfc2544SystemRecoveryResult, Rfc2544ThroughputAggregation,
    Rfc2544ThroughputRepetitionResult, Rfc2544ThroughputResult, RxTarget, Stream, TrafficGenData,
    RFC2544_IMIX_FRAME_SIZE,
};
use crate::AppState;

const THROUGHPUT_SWEEP_SAMPLE_RATE: u32 = 128;
const THROUGHPUT_SWEEP_PADDING_SAMPLES: usize = 4;
const IMIX_STREAM_SPECS: [(u32, u32); 3] = [(64, 7), (512, 4), (1518, 1)];
const L1_OVERHEAD_BYTES: u32 = 20;

fn frame_profile_label(frame_size: u32) -> String {
    if frame_size == RFC2544_IMIX_FRAME_SIZE {
        "IMIX".to_string()
    } else {
        format!("{frame_size} B")
    }
}

fn effective_imix_l1_frame_size(frame_size: u32, template: &Stream) -> u32 {
    // A 64-byte IPv6 packet cannot contain P4TG's headers, so traffic setup
    // expands it to 73 bytes plus the FCS before programming pktgen.
    let frame_size = if template.ip_version == Some(6) && frame_size == 64 {
        73 + 4
    } else {
        frame_size
    };

    frame_size + calculate_overhead(template) + L1_OVERHEAD_BYTES
}

fn split_imix_rate(total_rate_gbps: f64, template: &Stream) -> [f32; IMIX_STREAM_SPECS.len()] {
    let weights = IMIX_STREAM_SPECS.map(|(frame_size, packet_weight)| {
        f64::from(packet_weight) * f64::from(effective_imix_l1_frame_size(frame_size, template))
    });
    let total_weight = weights.iter().sum::<f64>();
    weights.map(|weight| (total_rate_gbps * weight / total_weight) as f32)
}

/// Minimum wait between trial start and the baseline sample. The statistics
/// gauges are only refreshed by digests (one per MONITORING_PACKET_INTERVAL,
/// 500 ms) and periodic table reads, so a baseline taken earlier can still
/// contain the previous trial's counters and mask all loss of this trial.
const TRIAL_STATS_SETTLE_SECS: u32 = 2;

/// Minimum wait after stopping a trial before the next trial may reset the
/// counters. Packets of the stopped trial that are still buffered in the DUT
/// would otherwise arrive after the sequence register reset: the first stale
/// high sequence number is counted as a huge loss and all following packets of
/// the next trial are misclassified as out-of-order until the sequence numbers
/// catch up, hiding real loss.
const MIN_TRIAL_DRAIN_SECS: u32 = 1;

/// Effective wait after a trial: the configured cool-down, but at least the
/// DUT drain time.
fn effective_cooldown_secs(config: &Rfc2544Config) -> u32 {
    config.cooldown_duration_secs.max(MIN_TRIAL_DRAIN_SECS)
}

struct TrialSample {
    tx_rate_gbps: f64,
    rx_rate_gbps: f64,
    lost_frames: u64,
    out_of_order: u64,
    tx_frames: u128,
    rx_frames: u128,
    rtts: Vec<u64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ThroughputCounters {
    raw_gaps: u64,
    out_of_order: u64,
    tx_frames: u128,
}

impl ThroughputCounters {
    fn from_sample(sample: &TrialSample) -> Self {
        Self {
            raw_gaps: sample.lost_frames.saturating_add(sample.out_of_order),
            out_of_order: sample.out_of_order,
            tx_frames: sample.tx_frames,
        }
    }

    fn regressed_from(self, previous: Self) -> bool {
        self.raw_gaps < previous.raw_gaps
            || self.out_of_order < previous.out_of_order
            || self.tx_frames < previous.tx_frames
    }

    fn loss_since(self, baseline: Self) -> ThroughputTrialLoss {
        let raw_gaps = self.raw_gaps.saturating_sub(baseline.raw_gaps);
        let out_of_order = self.out_of_order.saturating_sub(baseline.out_of_order);

        ThroughputTrialLoss {
            lost_frames: raw_gaps.saturating_sub(out_of_order),
            tx_frames: self.tx_frames.saturating_sub(baseline.tx_frames),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct ThroughputTrialLoss {
    lost_frames: u64,
    tx_frames: u128,
}

#[derive(Clone, Copy, Debug)]
struct ThroughputSweepPoint {
    rate_gbps: f64,
    exceeds_tolerance: bool,
}

#[derive(Debug)]
enum ThroughputSweepOutcome {
    Loss {
        low_rate_gbps: f64,
        high_rate_gbps: f64,
    },
    NoLoss,
}

impl ThroughputTrialLoss {
    fn exceeds_tolerance(&self, config: &Rfc2544Config) -> bool {
        let tolerance = config.throughput_loss_tolerance.value.max(0.0);
        match config.throughput_loss_tolerance.unit {
            Rfc2544LossToleranceUnit::Packets => self.lost_frames as f64 > tolerance,
            Rfc2544LossToleranceUnit::Percent => {
                if self.tx_frames == 0 {
                    // Without TX evidence, never let observed loss pass as zero-loss.
                    return self.lost_frames > 0;
                }
                (self.lost_frames as f64 * 100.0 / self.tx_frames as f64) > tolerance.min(100.0)
            }
        }
    }
}

fn positive_rate(rate_gbps: f64) -> bool {
    rate_gbps.is_finite() && rate_gbps > 0.0
}

fn usable_trial_rate(rate_gbps: f64, config: &Rfc2544Config) -> f64 {
    if positive_rate(rate_gbps) {
        return rate_gbps;
    }

    let line_rate = config.line_rate_gbps as f64;
    if positive_rate(line_rate) {
        line_rate
    } else {
        0.001
    }
}

fn padded_sweep_outcome(
    points: &[ThroughputSweepPoint],
    final_loss: ThroughputTrialLoss,
    config: &Rfc2544Config,
    line_rate_gbps: f64,
) -> ThroughputSweepOutcome {
    let line_rate_gbps = line_rate_gbps.max(0.0);
    if !final_loss.exceeds_tolerance(config) {
        return ThroughputSweepOutcome::NoLoss;
    }

    // Only the final, still-unresolved loss epoch is useful for bracketing.
    // Earlier loss excursions that returned within tolerance were sequence
    // gaps subsequently reconciled by out-of-order arrivals.
    let first_loss_index = points
        .iter()
        .rposition(|point| !point.exceeds_tolerance)
        .map_or(0, |index| index.saturating_add(1));

    let last_pass_index = first_loss_index.checked_sub(1);
    let low_rate_gbps = last_pass_index
        .and_then(|index| index.checked_sub(THROUGHPUT_SWEEP_PADDING_SAMPLES))
        .and_then(|index| points.get(index))
        .map(|point| point.rate_gbps)
        .unwrap_or(0.0)
        .clamp(0.0, line_rate_gbps);

    let requested_high_index = first_loss_index.saturating_add(THROUGHPUT_SWEEP_PADDING_SAMPLES);
    let high_rate_gbps =
        if first_loss_index < points.len() && requested_high_index < points.len() {
            points[first_loss_index..=requested_high_index]
                .iter()
                .map(|point| point.rate_gbps)
                .filter(|rate| rate.is_finite())
                .fold(0.0_f64, f64::max)
                .clamp(0.0, line_rate_gbps)
        } else {
            line_rate_gbps
        }
        .max(low_rate_gbps);

    ThroughputSweepOutcome::Loss {
        low_rate_gbps,
        high_rate_gbps,
    }
}

fn active_stream_ids(payload: &TrafficGenData) -> HashSet<u8> {
    payload
        .stream_settings
        .iter()
        .filter(|setting| setting.active)
        .map(|setting| setting.stream_id)
        .collect()
}

fn system_recovery_total_duration_secs(config: &Rfc2544Config) -> u32 {
    config
        .system_recovery_overload_duration_secs
        .saturating_add(config.system_recovery_observation_duration_secs)
        .max(1)
}

fn mapping_label(mapping: &Rfc2544PortMapping) -> String {
    format!(
        "{}/{} → {}/{}",
        mapping.tx_port, mapping.tx_channel, mapping.rx_port, mapping.rx_channel
    )
}

fn mapping_key(mapping: &Rfc2544PortMapping) -> (u32, u8, u32, u8) {
    (
        mapping.tx_port,
        mapping.tx_channel,
        mapping.rx_port,
        mapping.rx_channel,
    )
}

fn has_mapping_frame_result<T>(
    rows: &[T],
    mapping: &Rfc2544PortMapping,
    frame_size: u32,
    row_mapping: impl Fn(&T) -> &Rfc2544PortMapping,
    row_frame_size: impl Fn(&T) -> u32,
) -> bool {
    rows.iter().any(|row| {
        row_frame_size(row) == frame_size && mapping_key(row_mapping(row)) == mapping_key(mapping)
    })
}

fn mapping_has_measured_result(results: &Rfc2544Results, mapping: &Rfc2544PortMapping) -> bool {
    let key = mapping_key(mapping);
    results
        .throughput
        .iter()
        .any(|row| mapping_key(&row.mapping) == key)
        || results
            .latency
            .iter()
            .any(|row| mapping_key(&row.mapping) == key)
        || results
            .reset
            .iter()
            .any(|row| mapping_key(&row.mapping) == key)
        || results
            .frame_loss
            .iter()
            .any(|row| mapping_key(&row.mapping) == key)
}

fn frame_loss_complete(
    results: &Rfc2544Results,
    mapping: &Rfc2544PortMapping,
    frame_size: u32,
) -> bool {
    let rows = results
        .frame_loss
        .iter()
        .filter(|row| {
            row.frame_size == frame_size && mapping_key(&row.mapping) == mapping_key(mapping)
        })
        .collect::<Vec<_>>();
    rows.len() >= 10
        || rows
            .windows(2)
            .any(|window| window[0].lost_frames == 0 && window[1].lost_frames == 0)
}

fn estimate_rfc2544_remaining_secs(config: &Rfc2544Config, results: &Rfc2544Results) -> u32 {
    let throughput_needed =
        config.throughput || config.latency || config.reset || config.system_recovery;
    let throughput_trials = config
        .throughput_search_steps
        // One sawtooth sweep, up to two fixed-rate bracket probes, and the
        // configured binary refinements.
        .saturating_add(3)
        .saturating_mul(config.throughput_repetitions.max(1));
    let recovery_duration = config
        .system_recovery_overload_duration_secs
        .saturating_add(config.system_recovery_observation_duration_secs);
    let mut warmup_pending = results
        .selected_mappings
        .iter()
        .filter(|mapping| !mapping_has_measured_result(results, mapping))
        .map(mapping_key)
        .collect::<HashSet<_>>();
    let mut remaining = 0_u32;

    let mut measured_trial_cost =
        |base_secs: u32, trials: u32, mapping: &Rfc2544PortMapping| -> u32 {
            if trials == 0 {
                return 0;
            }

            // Each trial waits for its warm-up or at least the statistics
            // settle time before taking the baseline sample.
            let pre_baseline_secs = if config.warmup_once_per_mapping {
                let first_trial_secs = if warmup_pending.remove(&mapping_key(mapping)) {
                    config.warmup_duration_secs.max(TRIAL_STATS_SETTLE_SECS)
                } else {
                    TRIAL_STATS_SETTLE_SECS
                };
                first_trial_secs.saturating_add(TRIAL_STATS_SETTLE_SECS.saturating_mul(trials - 1))
            } else {
                config
                    .warmup_duration_secs
                    .max(TRIAL_STATS_SETTLE_SECS)
                    .saturating_mul(trials)
            };

            trials
                .saturating_mul(base_secs.saturating_add(effective_cooldown_secs(config)))
                .saturating_add(pre_baseline_secs)
        };

    for mapping in &results.selected_mappings {
        for &frame_size in &results.selected_frame_sizes {
            if throughput_needed
                && !has_mapping_frame_result(
                    &results.throughput,
                    mapping,
                    frame_size,
                    |row| &row.mapping,
                    |row| row.frame_size,
                )
            {
                remaining = remaining.saturating_add(measured_trial_cost(
                    config.trial_duration_secs,
                    throughput_trials,
                    mapping,
                ));
            }

            // IMIX is intentionally offered as a pragmatic ZLT-only profile;
            // the remaining RFC2544 procedures continue to use fixed sizes.
            if frame_size == RFC2544_IMIX_FRAME_SIZE {
                continue;
            }

            if config.frame_loss && !frame_loss_complete(results, mapping, frame_size) {
                let completed_trials = results
                    .frame_loss
                    .iter()
                    .filter(|row| {
                        row.frame_size == frame_size
                            && mapping_key(&row.mapping) == mapping_key(mapping)
                    })
                    .count() as u32;
                remaining = remaining.saturating_add(measured_trial_cost(
                    config.trial_duration_secs,
                    10_u32.saturating_sub(completed_trials),
                    mapping,
                ));
            }

            if config.latency
                && !has_mapping_frame_result(
                    &results.latency,
                    mapping,
                    frame_size,
                    |row| &row.mapping,
                    |row| row.frame_size,
                )
            {
                remaining = remaining.saturating_add(measured_trial_cost(
                    config.latency_duration_secs,
                    config.latency_repetitions,
                    mapping,
                ));
            }

            if config.reset
                && !has_mapping_frame_result(
                    &results.reset,
                    mapping,
                    frame_size,
                    |row| &row.mapping,
                    |row| row.frame_size,
                )
            {
                remaining = remaining.saturating_add(measured_trial_cost(
                    config.reset_timeout_secs,
                    1,
                    mapping,
                ));
            }

            if config.system_recovery
                && !has_mapping_frame_result(
                    &results.system_recovery,
                    mapping,
                    frame_size,
                    |row| &row.mapping,
                    |row| row.frame_size,
                )
            {
                remaining = remaining.saturating_add(
                    recovery_duration.saturating_add(effective_cooldown_secs(config)),
                );
            }
        }
    }

    remaining
}

async fn refresh_runtime_estimate(state: &Arc<AppState>, config: &Rfc2544Config) {
    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.estimated_remaining_runtime_secs = estimate_rfc2544_remaining_secs(config, results);
    }
}

fn start_runtime_estimate_ticker(state: Arc<AppState>, cancel_token: CancellationToken) {
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(Duration::from_secs(1));
        interval.tick().await;

        loop {
            tokio::select! {
                _ = interval.tick() => {
                    let mut guard = state.rfc2544_results.lock().await;
                    let Some(results) = guard.as_mut() else {
                        break;
                    };
                    if !results.running {
                        break;
                    }
                    results.estimated_remaining_runtime_secs =
                        results.estimated_remaining_runtime_secs.saturating_sub(1);
                }
                _ = cancel_token.cancelled() => {
                    break;
                }
            }
        }
    });
}

fn serial_mappings(payload: &TrafficGenData) -> Vec<Rfc2544PortMapping> {
    let mut mappings = payload
        .port_tx_rx_mapping
        .iter()
        .flat_map(|(tx_port, per_channel)| {
            per_channel.iter().filter_map(|(tx_channel, rx_target)| {
                let mapping = Rfc2544PortMapping {
                    tx_port: tx_port.parse().ok()?,
                    tx_channel: tx_channel.parse().ok()?,
                    rx_port: rx_target.port,
                    rx_channel: rx_target.channel,
                };

                payload
                    .stream_settings
                    .iter()
                    .any(|setting| {
                        setting.active
                            && setting.port == mapping.tx_port
                            && setting.channel.unwrap_or(0) == mapping.tx_channel
                    })
                    .then_some(mapping)
            })
        })
        .collect::<Vec<_>>();

    mappings.sort_by_key(|mapping| {
        (
            mapping.tx_port,
            mapping.tx_channel,
            mapping.rx_port,
            mapping.rx_channel,
        )
    });
    mappings
}

fn payload_for_mapping(
    base: &TrafficGenData,
    mapping: &Rfc2544PortMapping,
) -> Option<TrafficGenData> {
    let mut payload = base.clone();
    let tx_port = mapping.tx_port.to_string();
    let tx_channel = mapping.tx_channel.to_string();

    let mut per_channel = HashMap::new();
    per_channel.insert(
        tx_channel.clone(),
        RxTarget {
            port: mapping.rx_port,
            channel: mapping.rx_channel,
        },
    );
    payload.port_tx_rx_mapping = HashMap::from([(tx_port, per_channel)]);

    payload.stream_settings = base
        .stream_settings
        .iter()
        .filter(|setting| {
            setting.active
                && setting.port == mapping.tx_port
                && setting.channel.unwrap_or(0) == mapping.tx_channel
        })
        .cloned()
        .collect();

    if payload.stream_settings.is_empty() {
        None
    } else {
        Some(payload)
    }
}

fn build_trial_payload(
    base: &TrafficGenData,
    frame_size: u32,
    target_rate_gbps: f64,
    pattern: Option<GenerationPatternConfig>,
) -> TrafficGenData {
    let mut payload = base.clone();
    let active_ids = active_stream_ids(&payload);

    if frame_size == RFC2544_IMIX_FRAME_SIZE {
        let template_stream = payload
            .streams
            .iter()
            .find(|stream| active_ids.contains(&stream.stream_id))
            .cloned()
            .expect("validated RFC2544 payload must contain an active stream");
        let template_settings = payload
            .stream_settings
            .iter()
            .filter(|setting| setting.active && setting.stream_id == template_stream.stream_id)
            .cloned()
            .collect::<Vec<_>>();
        let rates = split_imix_rate(target_rate_gbps, &template_stream);

        payload.streams = IMIX_STREAM_SPECS
            .iter()
            .enumerate()
            .map(|(index, (imix_frame_size, _))| {
                let mut stream = template_stream.clone();
                let stream_id = (index + 1) as u8;
                stream.stream_id = stream_id;
                stream.app_id = stream_id;
                stream.frame_size = *imix_frame_size;
                stream.traffic_rate = rates[index];
                stream.unit = Some(GenerationUnit::Gbps);
                stream.pattern = pattern.clone();
                stream
            })
            .collect();
        payload.stream_settings = IMIX_STREAM_SPECS
            .iter()
            .enumerate()
            .flat_map(|(index, _)| {
                template_settings.iter().cloned().map(move |mut setting| {
                    setting.stream_id = (index + 1) as u8;
                    setting
                })
            })
            .collect();
        payload.mode = GenerationMode::Rfc2544;
        payload.duration = None;
        payload.name = Some("RFC2544 ZLT IMIX".to_string());
        return payload;
    }

    let active_stream_count = payload
        .streams
        .iter()
        .filter(|stream| active_ids.contains(&stream.stream_id))
        .count()
        .max(1);
    let per_stream_rate = (target_rate_gbps / active_stream_count as f64) as f32;

    for stream in &mut payload.streams {
        if active_ids.contains(&stream.stream_id) {
            stream.frame_size = frame_size;
            stream.traffic_rate = per_stream_rate;
            stream.unit = Some(GenerationUnit::Gbps);
            stream.pattern = pattern.clone();
        }
    }

    payload.mode = GenerationMode::Rfc2544;
    payload.duration = None;
    payload.name = Some(format!("RFC2544 {}", frame_profile_label(frame_size)));
    payload
}

fn build_system_recovery_payload(
    base: &TrafficGenData,
    config: &Rfc2544Config,
    frame_size: u32,
    throughput_rate_gbps: f64,
) -> Option<(TrafficGenData, f64, f64)> {
    let active_ids = active_stream_ids(base);
    let template_stream = base
        .streams
        .iter()
        .find(|stream| active_ids.contains(&stream.stream_id))?;
    let template_settings = base
        .stream_settings
        .iter()
        .filter(|setting| setting.active && setting.stream_id == template_stream.stream_id)
        .cloned()
        .collect::<Vec<_>>();

    if template_settings.is_empty() {
        return None;
    }

    let throughput_rate_gbps = usable_trial_rate(throughput_rate_gbps, config);
    let overload_rate_gbps = usable_trial_rate(
        (throughput_rate_gbps * 1.10).min(config.line_rate_gbps as f64),
        config,
    );
    let recovery_rate_gbps = usable_trial_rate(throughput_rate_gbps * 0.50, config);
    let total_duration_secs = system_recovery_total_duration_secs(config);

    // Keep recovery in one square-wave stream. A separate inverted stream with
    // square_low=0 can starve in its initial low phase and never reach high.
    let recovery_factor = (recovery_rate_gbps / overload_rate_gbps).clamp(0.0, 1.0);

    let mut recovery_trial_stream = template_stream.clone();
    recovery_trial_stream.stream_id = 1;
    recovery_trial_stream.app_id = 1;
    recovery_trial_stream.frame_size = frame_size;
    recovery_trial_stream.traffic_rate = overload_rate_gbps as f32;
    recovery_trial_stream.unit = Some(GenerationUnit::Gbps);
    recovery_trial_stream.pattern = Some(square_pattern(
        total_duration_secs,
        config.system_recovery_overload_duration_secs,
        recovery_factor,
    ));

    let mut stream_settings = Vec::with_capacity(template_settings.len());
    for setting in template_settings {
        let mut recovery_setting = setting;
        recovery_setting.stream_id = 1;
        recovery_setting.active = true;
        stream_settings.push(recovery_setting);
    }

    let mut payload = base.clone();
    payload.mode = GenerationMode::Rfc2544;
    payload.duration = None;
    payload.name = Some(format!("RFC2544 system recovery {frame_size}B"));
    payload.streams = vec![recovery_trial_stream];
    payload.stream_settings = stream_settings;

    Some((payload, overload_rate_gbps, recovery_rate_gbps))
}

fn square_pattern(
    total_duration_secs: u32,
    high_duration_secs: u32,
    low_factor: f64,
) -> GenerationPatternConfig {
    GenerationPatternConfig {
        pattern_type: GenerationPattern::Square,
        period: total_duration_secs as f64 * 1_000_000_000.0,
        sample_rate: 128,
        inverted: Some(false),
        fc_quiet_until: None,
        fc_ramp_until: None,
        fc_decay_rate: None,
        square_low: Some(low_factor),
        square_high_until: Some(high_duration_secs as f64 * 1_000_000_000.0),
    }
}

fn sawtooth_pattern(duration_secs: u32) -> GenerationPatternConfig {
    GenerationPatternConfig {
        pattern_type: GenerationPattern::Sawtooth,
        period: duration_secs.max(1) as f64 * 1_000_000_000.0,
        sample_rate: THROUGHPUT_SWEEP_SAMPLE_RATE,
        inverted: Some(false),
        fc_quiet_until: None,
        fc_ramp_until: None,
        fc_decay_rate: None,
        square_low: None,
        square_high_until: None,
    }
}

async fn system_recovery_period_error(
    state: &Arc<AppState>,
    trial: &TrafficGenData,
    total_duration_secs: u32,
) -> Option<String> {
    let stream = trial.streams.first()?;
    let num_pipes = {
        let tg = state.traffic_generator.lock().await;
        get_num_pipes(stream, tg.num_pipes)
    };
    let encapsulation_overhead = calculate_overhead(stream) + 20;
    let frame_size = if stream.ip_version == Some(6) && stream.frame_size == 64 {
        73 + 4
    } else {
        stream.frame_size
    };
    let generation_frame_size = frame_size + encapsulation_overhead;
    let per_pipe_rate = stream.traffic_rate / num_pipes.max(1) as f32;
    if per_pipe_rate <= 0.0 || !per_pipe_rate.is_finite() {
        return Some(
            "System recovery pattern period cannot be checked for non-positive rate.".to_string(),
        );
    }

    let (n_packets, mut timeout) =
        calculate_send_behaviour(generation_frame_size, per_pipe_rate, stream.burst);
    let batch_factor = get_batch_factor(stream);
    timeout *= batch_factor;
    if n_packets == 0 || timeout == 0 {
        return Some(
            "System recovery pattern period cannot be represented for this rate.".to_string(),
        );
    }

    let offered_pps_per_pipe = n_packets as f64 * batch_factor as f64 * 1e9_f64 / timeout as f64;
    let requested_period_pkts = total_duration_secs as f64 * offered_pps_per_pipe;
    let max_period_pkts = u32::MAX as f64;
    if requested_period_pkts.round() <= max_period_pkts {
        return None;
    }

    let max_period_secs = max_period_pkts / offered_pps_per_pipe;
    Some(format!(
        "System recovery pattern period too long: requested {}s requires {:.3}G pattern intervals per pipe, but P4TG can represent at most {:.3}s at {:.3} Gbit/s for this frame size. Reduce overload/observation duration or the offered rate.",
        total_duration_secs,
        requested_period_pkts / 1e9_f64,
        max_period_secs,
        stream.traffic_rate
    ))
}

fn trial_ports(state: &Arc<AppState>, payload: &TrafficGenData) -> (HashSet<u32>, HashSet<u32>) {
    let front_panel_dev_port_mappings =
        generate_front_panel_to_dev_port_mappings(&state.port_mapping, state.tofino2);
    let tx_rx_mapping = translate_fp_channel_to_dev_port_mapping(
        &payload.port_tx_rx_mapping,
        &front_panel_dev_port_mappings,
    );

    let tx_ports = tx_rx_mapping
        .keys()
        .filter_map(|port| port.parse::<u32>().ok())
        .collect();
    let rx_ports = tx_rx_mapping.values().copied().collect();

    (tx_ports, rx_ports)
}

async fn sample_trial(state: &Arc<AppState>, payload: &TrafficGenData) -> TrialSample {
    let (tx_ports, rx_ports) = trial_ports(state, payload);

    let rate_monitor = state.rate_monitor.lock().await;
    let tx_rate_gbps = tx_ports
        .iter()
        .map(|port| {
            rate_monitor
                .statistics
                .tx_rate_l1
                .get(port)
                .copied()
                .unwrap_or(0.0)
        })
        .sum::<f64>()
        / 1e9_f64;
    let rx_rate_gbps = rx_ports
        .iter()
        .map(|port| {
            rate_monitor
                .statistics
                .rx_rate_l1
                .get(port)
                .copied()
                .unwrap_or(0.0)
        })
        .sum::<f64>()
        / 1e9_f64;
    let lost_frames = rx_ports
        .iter()
        .map(|port| {
            rate_monitor
                .statistics
                .packet_loss
                .get(port)
                .copied()
                .unwrap_or(0)
        })
        .sum::<u64>();
    let out_of_order = rx_ports
        .iter()
        .map(|port| {
            rate_monitor
                .statistics
                .out_of_order
                .get(port)
                .copied()
                .unwrap_or(0)
        })
        .sum::<u64>();
    let rtts = rx_ports
        .iter()
        .flat_map(|port| rate_monitor.rtt_storage.get(port))
        .flat_map(|samples| samples.iter().copied())
        .collect::<Vec<_>>();
    drop(rate_monitor);

    let frame_size_monitor = state.frame_size_monitor.lock().await;
    let tx_frames = tx_ports
        .iter()
        .filter_map(|port| frame_size_monitor.statistics.frame_size.get(port))
        .flat_map(|range| range.tx.iter())
        .map(|entry| entry.packets)
        .sum();
    let rx_frames = rx_ports
        .iter()
        .filter_map(|port| frame_size_monitor.statistics.frame_size.get(port))
        .flat_map(|range| range.rx.iter())
        .map(|entry| entry.packets)
        .sum();

    TrialSample {
        tx_rate_gbps,
        rx_rate_gbps,
        lost_frames,
        out_of_order,
        tx_frames,
        rx_frames,
        rtts,
    }
}

async fn set_status(state: &Arc<AppState>, status: String) {
    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.status = status;
    }
}

async fn finish(state: &Arc<AppState>, status: String) {
    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.running = false;
        results.status = status;
        results.estimated_remaining_runtime_secs = 0;
    }
}

async fn stop_trial(state: &Arc<AppState>) {
    if let Err(err) = state
        .traffic_generator
        .lock()
        .await
        .stop(&state.switch)
        .await
    {
        error!("Error while stopping RFC2544 trial: {err}");
    }
    state.experiment.lock().await.running = false;
}

async fn wait_with_cancel(duration: Duration, cancel_token: &CancellationToken) -> bool {
    let deadline = Instant::now() + duration;
    let mut interval = tokio::time::interval(Duration::from_secs(1));

    loop {
        tokio::select! {
            _ = interval.tick() => {
                if Instant::now() >= deadline {
                    return true;
                }
            }
            _ = cancel_token.cancelled() => {
                return false;
            }
        }
    }
}

async fn maybe_warmup(
    state: &Arc<AppState>,
    config: &Rfc2544Config,
    mapping_warmup_done: &mut bool,
    context: String,
    cancel_token: &CancellationToken,
) -> bool {
    if config.warmup_duration_secs == 0 {
        return true;
    }

    if config.warmup_once_per_mapping && *mapping_warmup_done {
        return true;
    }

    set_status(
        state,
        format!(
            "RFC2544 warm-up | {context} | running traffic for {}s before measurement",
            config.warmup_duration_secs
        ),
    )
    .await;

    if wait_with_cancel(
        Duration::from_secs(config.warmup_duration_secs as u64),
        cancel_token,
    )
    .await
    {
        *mapping_warmup_done = true;
        true
    } else {
        stop_trial(state).await;
        finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
        false
    }
}

/// Returns whether [maybe_warmup] will run a warm-up wait for the next trial.
/// Must be evaluated before calling [maybe_warmup], which sets the done flag.
fn warmup_will_run(config: &Rfc2544Config, mapping_warmup_done: bool) -> bool {
    config.warmup_duration_secs > 0 && !(config.warmup_once_per_mapping && mapping_warmup_done)
}

/// Waits until the statistics monitors have published post-reset counters so
/// that a following baseline sample cannot contain stale values from the
/// previous trial. A warm-up wait of at least [TRIAL_STATS_SETTLE_SECS]
/// seconds already covers this; otherwise wait for the remainder.
async fn settle_statistics(
    state: &Arc<AppState>,
    config: &Rfc2544Config,
    warmup_ran: bool,
    cancel_token: &CancellationToken,
) -> bool {
    let waited_secs = if warmup_ran {
        config.warmup_duration_secs
    } else {
        0
    };
    let remaining_secs = TRIAL_STATS_SETTLE_SECS.saturating_sub(waited_secs);
    if remaining_secs == 0 {
        return true;
    }

    if wait_with_cancel(Duration::from_secs(remaining_secs as u64), cancel_token).await {
        true
    } else {
        stop_trial(state).await;
        finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
        false
    }
}

async fn trial_cooldown(
    state: &Arc<AppState>,
    config: &Rfc2544Config,
    context: String,
    cancel_token: &CancellationToken,
) -> bool {
    // Even with cool-down 0, wait for the DUT to drain in-flight packets of
    // the stopped trial before the next trial resets the sequence registers.
    let wait_secs = effective_cooldown_secs(config);

    set_status(
        state,
        format!("RFC2544 cool-down | {context} | waiting {wait_secs}s before next trial"),
    )
    .await;

    if wait_with_cancel(Duration::from_secs(wait_secs as u64), cancel_token).await {
        true
    } else {
        finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
        false
    }
}

fn latency_result(
    mapping: &Rfc2544PortMapping,
    frame_size: u32,
    rate_gbps: f64,
    samples: &[u64],
) -> Rfc2544LatencyResult {
    if samples.is_empty() {
        return Rfc2544LatencyResult {
            mapping: mapping.clone(),
            frame_size,
            rate_gbps,
            mean_latency_ns: 0.0,
            current_latency_ns: 0.0,
            min_latency_ns: 0,
            max_latency_ns: 0,
            jitter_ns: 0.0,
            samples: 0,
        };
    }

    let mean_rtt = samples.iter().map(|sample| *sample as f64).sum::<f64>() / samples.len() as f64;
    let jitter_rtt = (samples
        .iter()
        .map(|sample| {
            let delta = *sample as f64 - mean_rtt;
            delta * delta
        })
        .sum::<f64>()
        / samples.len() as f64)
        .sqrt();

    Rfc2544LatencyResult {
        mapping: mapping.clone(),
        frame_size,
        rate_gbps,
        mean_latency_ns: mean_rtt / 2.0,
        current_latency_ns: samples.last().copied().unwrap_or(0) as f64 / 2.0,
        min_latency_ns: samples.iter().min().copied().unwrap_or(0) as u32 / 2,
        max_latency_ns: samples.iter().max().copied().unwrap_or(0) as u32 / 2,
        jitter_ns: jitter_rtt / 2.0,
        samples: samples.len() as u32,
    }
}

fn median_rate(mut rates: Vec<f64>) -> f64 {
    rates.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
    let middle = rates.len() / 2;
    if rates.len().is_multiple_of(2) {
        (rates[middle - 1] + rates[middle]) / 2.0
    } else {
        rates[middle]
    }
}

fn aggregate_throughput_rate(
    config: &Rfc2544Config,
    repetitions: &[Rfc2544ThroughputRepetitionResult],
) -> (f64, bool) {
    let rates = repetitions
        .iter()
        .map(|result| result.zero_loss_rate_gbps)
        .collect::<Vec<_>>();

    match config.throughput_aggregation {
        // Raw mode does not calculate a synthetic result. The response keeps
        // every measurement in `repetitions`; the legacy scalar (and any
        // follow-up RFC2544 procedure that needs one rate) uses the final run.
        Rfc2544ThroughputAggregation::Raw => (
            rates
                .last()
                .copied()
                .unwrap_or(config.line_rate_gbps as f64),
            false,
        ),
        Rfc2544ThroughputAggregation::Minimum => (
            rates
                .iter()
                .copied()
                .min_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal))
                .unwrap_or(config.line_rate_gbps as f64),
            false,
        ),
        Rfc2544ThroughputAggregation::Median => (median_rate(rates), false),
        Rfc2544ThroughputAggregation::Clustered => {
            let mut sorted = rates;
            sorted.sort_by(|left, right| left.partial_cmp(right).unwrap_or(Ordering::Equal));
            if sorted.len() <= 1 {
                return (median_rate(sorted), false);
            }

            let tolerance = config.throughput_cluster_tolerance_gbps.max(0.0);
            let mut best_start = 0_usize;
            let mut best_end = 0_usize;
            let mut start = 0_usize;

            for end in 0..sorted.len() {
                while sorted[end] - sorted[start] > tolerance {
                    start += 1;
                }

                let current_len = end - start + 1;
                let best_len = best_end - best_start + 1;
                if current_len > best_len {
                    best_start = start;
                    best_end = end;
                }
            }

            if best_end > best_start {
                (median_rate(sorted[best_start..=best_end].to_vec()), false)
            } else {
                (median_rate(sorted), true)
            }
        }
    }
}

fn representative_throughput_repetition<'a>(
    config: &Rfc2544Config,
    repetitions: &'a [Rfc2544ThroughputRepetitionResult],
    selected_rate_gbps: f64,
) -> &'a Rfc2544ThroughputRepetitionResult {
    if matches!(
        config.throughput_aggregation,
        Rfc2544ThroughputAggregation::Raw
    ) {
        return repetitions
            .last()
            .expect("throughput aggregation requires at least one repetition");
    }

    repetitions
        .iter()
        .min_by(|left, right| {
            let left_delta = (left.zero_loss_rate_gbps - selected_rate_gbps).abs();
            let right_delta = (right.zero_loss_rate_gbps - selected_rate_gbps).abs();
            left_delta
                .partial_cmp(&right_delta)
                .unwrap_or(Ordering::Equal)
                .then_with(|| {
                    left.zero_loss_rate_gbps
                        .partial_cmp(&right.zero_loss_rate_gbps)
                        .unwrap_or(Ordering::Equal)
                })
        })
        .expect("throughput aggregation requires at least one repetition")
}

async fn run_throughput_sweep(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    frame_size: u32,
    repetition_index: u32,
    repetition_count: u32,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> Option<ThroughputSweepOutcome> {
    let line_rate_gbps = config.line_rate_gbps as f64;
    let pattern = sawtooth_pattern(config.trial_duration_secs);
    let sweep = build_trial_payload(base, frame_size, line_rate_gbps, Some(pattern));
    let frame_profile = frame_profile_label(frame_size);
    let context = format!(
        "Throughput sweep | mapping {}/{} | {} | {} | repetition {}/{}",
        mapping_index,
        mapping_count,
        mapping_label(mapping),
        frame_profile,
        repetition_index,
        repetition_count
    );

    // A configured warm-up must not consume the beginning of the measured
    // zero-to-line-rate ramp. Run it as a separate instance of the same
    // traffic pattern, then restart the sweep with fresh counters.
    if warmup_will_run(config, *mapping_warmup_done) {
        if let Err(err) = start_single_test(state, sweep.clone()).await {
            error!("RFC2544 throughput sweep warm-up failed: {err}");
            finish(
                state,
                format!("RFC2544 throughput sweep warm-up failed: {err}"),
            )
            .await;
            return None;
        }
        if !maybe_warmup(
            state,
            config,
            mapping_warmup_done,
            context.clone(),
            cancel_token,
        )
        .await
        {
            return None;
        }
        stop_trial(state).await;
        if !trial_cooldown(state, config, context.clone(), cancel_token).await {
            return None;
        }
    }

    set_status(
        state,
        format!(
            "RFC2544 throughput sweep | mapping {}/{} | {} | {} | repetition {}/{} | 0 to {:.3} Gbit/s",
            mapping_index,
            mapping_count,
            mapping_label(mapping),
            frame_profile,
            repetition_index,
            repetition_count,
            line_rate_gbps
        ),
    )
    .await;

    if let Err(err) = start_single_test(state, sweep.clone()).await {
        error!("RFC2544 throughput sweep failed: {err}");
        finish(state, format!("RFC2544 throughput sweep failed: {err}")).await;
        return None;
    }

    // Unlike fixed-rate trials, the sweep cannot wait before taking its
    // baseline without discarding the low-rate portion. Reset clears the
    // gauges, and the regression guards below correct a stale first sample.
    let baseline = sample_trial(state, &sweep).await;
    let mut baseline_counters = ThroughputCounters::from_sample(&baseline);
    let mut last_counters = baseline_counters;
    let mut points = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(config.trial_duration_secs as u64);
    let sample_interval = Duration::from_nanos(MONITORING_PACKET_INTERVAL as u64);
    let mut interval = tokio::time::interval(sample_interval);
    interval.tick().await;

    let completed = loop {
        tokio::select! {
            _ = interval.tick() => {
                let sample = sample_trial(state, &sweep).await;
                let counters = ThroughputCounters::from_sample(&sample);
                if counters.regressed_from(last_counters) {
                    // Raw gap, out-of-order, and TX counters are monotonic
                    // within one trial. A regression means earlier samples
                    // belonged to stale pre-reset statistics. Corrected loss
                    // itself may legitimately decrease as reordered frames
                    // arrive, so it is deliberately not used for this guard.
                    points.clear();
                    baseline_counters = counters;
                }
                last_counters = counters;
                let trial_loss = counters.loss_since(baseline_counters);
                let exceeds_tolerance = trial_loss.exceeds_tolerance(config);

                let rate_gbps = if sample.tx_rate_gbps.is_finite() {
                    sample.tx_rate_gbps.clamp(0.0, line_rate_gbps)
                } else {
                    0.0
                };
                points.push(ThroughputSweepPoint {
                    rate_gbps,
                    exceeds_tolerance,
                });

                if Instant::now() >= deadline {
                    break true;
                }
            }
            _ = cancel_token.cancelled() => {
                break false;
            }
        }
    };

    stop_trial(state).await;
    if !completed {
        finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
        return None;
    }
    if !trial_cooldown(state, config, context, cancel_token).await {
        return None;
    }

    let final_sample = sample_trial(state, &sweep).await;
    let final_counters = ThroughputCounters::from_sample(&final_sample);
    let final_loss = final_counters.loss_since(baseline_counters);
    if final_loss.tx_frames == 0 {
        error!(
            "RFC2544 throughput sweep for {} observed no TX frames. Aborting benchmark.",
            frame_profile
        );
        finish(
            state,
            "RFC2544 throughput sweep observed no TX frames. Traffic generation may not be running correctly."
                .to_string(),
        )
        .await;
        return None;
    }

    Some(padded_sweep_outcome(
        &points,
        final_loss,
        config,
        line_rate_gbps,
    ))
}

async fn run_throughput_repetition(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    frame_size: u32,
    repetition_index: u32,
    repetition_count: u32,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> Option<Rfc2544ThroughputRepetitionResult> {
    let frame_profile = frame_profile_label(frame_size);
    set_status(
        state,
        format!(
            "RFC2544 throughput | mapping {}/{} | {} | {} | repetition {}/{}",
            mapping_index,
            mapping_count,
            mapping_label(mapping),
            frame_profile,
            repetition_index,
            repetition_count
        ),
    )
    .await;

    let line_rate_gbps = config.line_rate_gbps as f64;
    let total_trials = config.throughput_search_steps.saturating_add(3);
    let sweep_outcome = run_throughput_sweep(
        state,
        base,
        config,
        mapping,
        mapping_index,
        mapping_count,
        frame_size,
        repetition_index,
        repetition_count,
        mapping_warmup_done,
        cancel_token,
    )
    .await?;

    let mut next_trial = 2;
    let mut confirmed_pass_rate: Option<f64>;
    let mut confirmed_fail: (f64, u64);

    match sweep_outcome {
        ThroughputSweepOutcome::NoLoss => {
            let line_rate_loss = run_fixed_rate_loss_trial(
                state,
                base,
                config,
                frame_size,
                line_rate_gbps,
                mapping,
                mapping_index,
                mapping_count,
                repetition_index,
                repetition_count,
                next_trial,
                total_trials,
                mapping_warmup_done,
                cancel_token,
            )
            .await?;
            next_trial = next_trial.saturating_add(1);
            if !line_rate_loss.exceeds_tolerance(config) {
                return Some(Rfc2544ThroughputRepetitionResult {
                    repetition: repetition_index,
                    zero_loss_rate_gbps: line_rate_gbps,
                    first_loss_rate_gbps: None,
                    lost_frames: 0,
                });
            }

            // A loss-free ramp does not prove that its brief highest-rate
            // segment is sustainable. Line rate is now a confirmed failure.
            confirmed_pass_rate = None;
            confirmed_fail = (line_rate_gbps, line_rate_loss.lost_frames);
        }
        ThroughputSweepOutcome::Loss {
            low_rate_gbps,
            high_rate_gbps,
        } => {
            let high_rate_gbps = usable_trial_rate(high_rate_gbps, config).min(line_rate_gbps);
            // The sweep bounds are estimates, not fixed-rate evidence. Probe
            // the upper estimate first so a low estimate cannot trap all
            // refinements in a narrow, unconfirmed interval.
            let high_loss = run_fixed_rate_loss_trial(
                state,
                base,
                config,
                frame_size,
                high_rate_gbps,
                mapping,
                mapping_index,
                mapping_count,
                repetition_index,
                repetition_count,
                next_trial,
                total_trials,
                mapping_warmup_done,
                cancel_token,
            )
            .await?;
            next_trial = next_trial.saturating_add(1);

            if high_loss.exceeds_tolerance(config) {
                confirmed_pass_rate = None;
                confirmed_fail = (high_rate_gbps, high_loss.lost_frames);

                // If the padded lower estimate is positive, verify it once.
                // A failure moves the upper boundary down immediately; zero
                // remains the implicit lower boundary for subsequent search.
                if positive_rate(low_rate_gbps) && (high_rate_gbps - low_rate_gbps).abs() >= 0.001 {
                    let low_loss = run_fixed_rate_loss_trial(
                        state,
                        base,
                        config,
                        frame_size,
                        low_rate_gbps,
                        mapping,
                        mapping_index,
                        mapping_count,
                        repetition_index,
                        repetition_count,
                        next_trial,
                        total_trials,
                        mapping_warmup_done,
                        cancel_token,
                    )
                    .await?;
                    next_trial = next_trial.saturating_add(1);

                    if low_loss.exceeds_tolerance(config) {
                        confirmed_fail = (low_rate_gbps, low_loss.lost_frames);
                    } else {
                        confirmed_pass_rate = Some(low_rate_gbps);
                    }
                }
            } else {
                confirmed_pass_rate = Some(high_rate_gbps);
                if (line_rate_gbps - high_rate_gbps).abs() < 0.001 {
                    return Some(Rfc2544ThroughputRepetitionResult {
                        repetition: repetition_index,
                        zero_loss_rate_gbps: line_rate_gbps,
                        first_loss_rate_gbps: None,
                        lost_frames: 0,
                    });
                }

                // The approximate upper bound passed. Jump directly to line
                // rate; only binary-search this widened interval if line rate
                // is a confirmed failure.
                let line_rate_loss = run_fixed_rate_loss_trial(
                    state,
                    base,
                    config,
                    frame_size,
                    line_rate_gbps,
                    mapping,
                    mapping_index,
                    mapping_count,
                    repetition_index,
                    repetition_count,
                    next_trial,
                    total_trials,
                    mapping_warmup_done,
                    cancel_token,
                )
                .await?;
                next_trial = next_trial.saturating_add(1);

                if !line_rate_loss.exceeds_tolerance(config) {
                    return Some(Rfc2544ThroughputRepetitionResult {
                        repetition: repetition_index,
                        zero_loss_rate_gbps: line_rate_gbps,
                        first_loss_rate_gbps: None,
                        lost_frames: 0,
                    });
                }

                confirmed_fail = (line_rate_gbps, line_rate_loss.lost_frames);
            }
        }
    }

    let (mut high_rate, mut result_lost_frames) = confirmed_fail;
    let mut low_rate = confirmed_pass_rate.unwrap_or(0.0);

    for _ in 0..config.throughput_search_steps {
        let mid_rate = (low_rate + high_rate) / 2.0;
        if !positive_rate(mid_rate) || (high_rate - low_rate).abs() < 0.001 {
            break;
        }

        let mid_loss = run_fixed_rate_loss_trial(
            state,
            base,
            config,
            frame_size,
            mid_rate,
            mapping,
            mapping_index,
            mapping_count,
            repetition_index,
            repetition_count,
            next_trial,
            total_trials,
            mapping_warmup_done,
            cancel_token,
        )
        .await?;
        next_trial = next_trial.saturating_add(1);

        if mid_loss.exceeds_tolerance(config) {
            high_rate = mid_rate;
            result_lost_frames = mid_loss.lost_frames;
        } else {
            low_rate = mid_rate;
            confirmed_pass_rate = Some(mid_rate);
        }
    }

    let zero_loss_rate_gbps = confirmed_pass_rate.unwrap_or_else(|| {
        warn!(
            "RFC2544 throughput for {} did not find a positive no-loss fixed-rate trial; using half of first positive loss rate for follow-up trials.",
            frame_profile
        );
        usable_trial_rate(high_rate / 2.0, config)
    });

    Some(Rfc2544ThroughputRepetitionResult {
        repetition: repetition_index,
        zero_loss_rate_gbps,
        first_loss_rate_gbps: Some(high_rate),
        lost_frames: result_lost_frames,
    })
}

async fn run_throughput(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    frame_size: u32,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> Option<Rfc2544ThroughputResult> {
    let repetition_count = config.throughput_repetitions.max(1);
    let mut repetitions = Vec::with_capacity(repetition_count as usize);

    for repetition_index in 1..=repetition_count {
        let result = run_throughput_repetition(
            state,
            base,
            config,
            mapping,
            mapping_index,
            mapping_count,
            frame_size,
            repetition_index,
            repetition_count,
            mapping_warmup_done,
            cancel_token,
        )
        .await?;
        repetitions.push(result);
    }

    let (zero_loss_rate_gbps, clustered_fallback) = aggregate_throughput_rate(config, &repetitions);
    if clustered_fallback {
        let frame_profile = frame_profile_label(frame_size);
        warn!(
            "RFC2544 throughput clustered aggregation for {} {} did not find a multi-run cluster; using median.",
            mapping_label(mapping),
            frame_profile
        );
        set_status(
            state,
            format!(
                "RFC2544 throughput | {} | {} | no clustered ZLT group found, using median",
                mapping_label(mapping),
                frame_profile
            ),
        )
        .await;
    }

    let selected_repetition =
        representative_throughput_repetition(config, &repetitions, zero_loss_rate_gbps);
    let first_loss_rate_gbps = selected_repetition.first_loss_rate_gbps;
    let lost_frames = selected_repetition.lost_frames;
    let result = Rfc2544ThroughputResult {
        mapping: mapping.clone(),
        frame_size,
        zero_loss_rate_gbps,
        first_loss_rate_gbps,
        lost_frames,
        aggregation: config.throughput_aggregation,
        repetition_count,
        cluster_tolerance_gbps: config.throughput_cluster_tolerance_gbps,
        repetitions,
    };

    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.throughput.push(result.clone());
    }
    refresh_runtime_estimate(state, config).await;

    Some(result)
}

async fn run_fixed_rate_loss_trial(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    frame_size: u32,
    rate_gbps: f64,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    repetition_index: u32,
    repetition_count: u32,
    trial_index: u32,
    trial_count: u32,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> Option<ThroughputTrialLoss> {
    let rate_gbps = usable_trial_rate(rate_gbps, config);
    let frame_profile = frame_profile_label(frame_size);
    set_status(
        state,
        format!(
            "RFC2544 throughput | mapping {}/{} | {} | {} | repetition {}/{} | trial {}/{} | {:.3} Gbit/s",
            mapping_index,
            mapping_count,
            mapping_label(mapping),
            frame_profile,
            repetition_index,
            repetition_count,
            trial_index,
            trial_count,
            rate_gbps
        ),
    )
    .await;

    let trial = build_trial_payload(base, frame_size, rate_gbps, None);
    if let Err(err) = start_single_test(state, trial.clone()).await {
        error!("RFC2544 throughput confirmation trial failed: {err}");
        finish(
            state,
            format!("RFC2544 throughput confirmation failed: {err}"),
        )
        .await;
        return None;
    }

    let context = format!(
        "Throughput | mapping {}/{} | {} | {} | repetition {}/{} | trial {}/{} | {:.3} Gbit/s",
        mapping_index,
        mapping_count,
        mapping_label(mapping),
        frame_profile,
        repetition_index,
        repetition_count,
        trial_index,
        trial_count,
        rate_gbps
    );
    let warmup_ran = warmup_will_run(config, *mapping_warmup_done);
    if !maybe_warmup(
        state,
        config,
        mapping_warmup_done,
        context.clone(),
        cancel_token,
    )
    .await
    {
        return None;
    }
    if !settle_statistics(state, config, warmup_ran, cancel_token).await {
        return None;
    }

    let baseline = sample_trial(state, &trial).await;
    let baseline_counters = ThroughputCounters::from_sample(&baseline);
    let completed = wait_with_cancel(
        Duration::from_secs(config.trial_duration_secs as u64),
        cancel_token,
    )
    .await;

    stop_trial(state).await;

    if !completed {
        finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
        return None;
    }

    if !trial_cooldown(state, config, context, cancel_token).await {
        return None;
    }
    let sample = sample_trial(state, &trial).await;
    let trial_loss = ThroughputCounters::from_sample(&sample).loss_since(baseline_counters);

    if trial_loss.tx_frames == 0 {
        error!(
            "RFC2544 throughput trial at {rate_gbps:.3} Gbit/s observed no TX frames. Aborting benchmark."
        );
        finish(
            state,
            format!(
                "RFC2544 throughput trial at {rate_gbps:.3} Gbit/s observed no TX frames. Traffic generation may not be running correctly."
            ),
        )
        .await;
        return None;
    }

    Some(trial_loss)
}

async fn run_latency(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    frame_size: u32,
    rate_gbps: f64,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> bool {
    set_status(
        state,
        format!(
            "RFC2544 latency | mapping {}/{} | {} | {frame_size} B",
            mapping_index,
            mapping_count,
            mapping_label(mapping)
        ),
    )
    .await;

    let rate_gbps = usable_trial_rate(rate_gbps, config);
    let mut all_rtts = Vec::new();
    for repetition in 0..config.latency_repetitions {
        let trial = build_trial_payload(base, frame_size, rate_gbps, None);
        if let Err(err) = start_single_test(state, trial.clone()).await {
            error!("RFC2544 latency trial failed: {err}");
            finish(state, format!("RFC2544 latency failed: {err}")).await;
            return false;
        }

        let context = format!(
            "Latency | mapping {}/{} | {} | {frame_size} B | repetition {}/{}",
            mapping_index,
            mapping_count,
            mapping_label(mapping),
            repetition + 1,
            config.latency_repetitions
        );
        let warmup_ran = warmup_will_run(config, *mapping_warmup_done);
        if !maybe_warmup(
            state,
            config,
            mapping_warmup_done,
            context.clone(),
            cancel_token,
        )
        .await
        {
            return false;
        }
        if !settle_statistics(state, config, warmup_ran, cancel_token).await {
            return false;
        }
        let baseline = sample_trial(state, &trial).await;
        let baseline_rtt_count = baseline.rtts.len();

        set_status(
            state,
            format!(
                "RFC2544 latency | mapping {}/{} | {} | {frame_size} B | repetition {}/{}",
                mapping_index,
                mapping_count,
                mapping_label(mapping),
                repetition + 1,
                config.latency_repetitions
            ),
        )
        .await;

        let completed = wait_with_cancel(
            Duration::from_secs(config.latency_duration_secs as u64),
            cancel_token,
        )
        .await;

        let sample = sample_trial(state, &trial).await;
        all_rtts.extend(sample.rtts.into_iter().skip(baseline_rtt_count));
        stop_trial(state).await;

        if !completed {
            finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
            return false;
        }

        if !trial_cooldown(state, config, context, cancel_token).await {
            return false;
        }
    }

    let result = latency_result(mapping, frame_size, rate_gbps, &all_rtts);
    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.latency.push(result);
    }
    refresh_runtime_estimate(state, config).await;

    true
}

async fn run_frame_loss(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    frame_size: u32,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> bool {
    let mut successive_zero_loss_trials = 0;

    for step in 0..=9 {
        let offered_percent = 100 - step * 10;
        let offered_rate_gbps = config.line_rate_gbps as f64 * offered_percent as f64 / 100.0;
        set_status(
            state,
            format!(
                "RFC2544 frame loss | mapping {}/{} | {} | {frame_size} B | {offered_percent}%",
                mapping_index,
                mapping_count,
                mapping_label(mapping)
            ),
        )
        .await;

        let trial = build_trial_payload(base, frame_size, offered_rate_gbps, None);
        if let Err(err) = start_single_test(state, trial.clone()).await {
            error!("RFC2544 frame loss trial failed: {err}");
            finish(state, format!("RFC2544 frame loss failed: {err}")).await;
            return false;
        }

        let context = format!(
            "Frame loss | mapping {}/{} | {} | {frame_size} B | {offered_percent}%",
            mapping_index,
            mapping_count,
            mapping_label(mapping)
        );
        let warmup_ran = warmup_will_run(config, *mapping_warmup_done);
        if !maybe_warmup(
            state,
            config,
            mapping_warmup_done,
            context.clone(),
            cancel_token,
        )
        .await
        {
            return false;
        }
        if !settle_statistics(state, config, warmup_ran, cancel_token).await {
            return false;
        }

        let mut baseline = sample_trial(state, &trial).await;
        let completed = wait_with_cancel(
            Duration::from_secs(config.trial_duration_secs as u64),
            cancel_token,
        )
        .await;

        stop_trial(state).await;

        if !completed {
            finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
            return false;
        }

        if !trial_cooldown(state, config, context, cancel_token).await {
            return false;
        }
        let sample = sample_trial(state, &trial).await;
        // Freshly reset counters can only grow; a sample below the baseline
        // proves the baseline contained stale pre-reset values.
        baseline.tx_frames = baseline.tx_frames.min(sample.tx_frames);
        baseline.rx_frames = baseline.rx_frames.min(sample.rx_frames);
        baseline.lost_frames = baseline.lost_frames.min(sample.lost_frames);
        let tx_frames = sample.tx_frames.saturating_sub(baseline.tx_frames);
        let rx_frames = sample.rx_frames.saturating_sub(baseline.rx_frames);
        let lost_frames = sample.lost_frames.saturating_sub(baseline.lost_frames);

        let loss_percentage = if rx_frames + lost_frames as u128 > 0 {
            lost_frames as f64 * 100.0 / (rx_frames + lost_frames as u128) as f64
        } else {
            0.0
        };

        let result = Rfc2544FrameLossResult {
            mapping: mapping.clone(),
            frame_size,
            offered_percent,
            offered_rate_gbps,
            tx_frames,
            rx_frames,
            lost_frames,
            loss_percentage,
        };

        if lost_frames == 0 {
            successive_zero_loss_trials += 1;
        } else {
            successive_zero_loss_trials = 0;
        }

        if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
            results.frame_loss.push(result);
        }
        refresh_runtime_estimate(state, config).await;

        if successive_zero_loss_trials >= 2 {
            break;
        }
    }

    true
}

async fn run_system_recovery(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    frame_size: u32,
    throughput_rate_gbps: f64,
    cancel_token: &CancellationToken,
) -> bool {
    set_status(
        state,
        format!(
            "RFC2544 system recovery | preparing | mapping {}/{} | {} | {frame_size} B",
            mapping_index,
            mapping_count,
            mapping_label(mapping)
        ),
    )
    .await;

    let throughput_rate_gbps = usable_trial_rate(throughput_rate_gbps, config);
    let Some((trial, overload_rate_gbps, recovery_rate_gbps)) =
        build_system_recovery_payload(base, config, frame_size, throughput_rate_gbps)
    else {
        let result = Rfc2544SystemRecoveryResult {
            mapping: mapping.clone(),
            frame_size,
            throughput_rate_gbps,
            overload_rate_gbps: 0.0,
            recovery_rate_gbps: 0.0,
            recovery_time_ms: None,
            lost_frames_after_reduction: 0,
            recovered: false,
            status: "No active stream template available for system recovery.".to_string(),
        };
        if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
            results.system_recovery.push(result);
        }
        refresh_runtime_estimate(state, config).await;
        finish(
            state,
            "RFC2544 system recovery failed: no active stream template available.".to_string(),
        )
        .await;
        return false;
    };

    let total_duration_secs = system_recovery_total_duration_secs(config);
    if let Some(status) = system_recovery_period_error(state, &trial, total_duration_secs).await {
        warn!("RFC2544 system recovery skipped: {status}");
        set_status(
            state,
            format!(
                "RFC2544 system recovery | skipped | mapping {}/{} | {} | {frame_size} B | pattern period too long",
                mapping_index,
                mapping_count,
                mapping_label(mapping)
            ),
        )
        .await;
        let result = Rfc2544SystemRecoveryResult {
            mapping: mapping.clone(),
            frame_size,
            throughput_rate_gbps,
            overload_rate_gbps,
            recovery_rate_gbps,
            recovery_time_ms: None,
            lost_frames_after_reduction: 0,
            recovered: false,
            status,
        };
        if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
            results.system_recovery.push(result);
        }
        refresh_runtime_estimate(state, config).await;
        return true;
    }

    if let Err(err) = start_single_test(state, trial.clone()).await {
        error!("RFC2544 system recovery trial failed: {err}");
        let result = Rfc2544SystemRecoveryResult {
            mapping: mapping.clone(),
            frame_size,
            throughput_rate_gbps,
            overload_rate_gbps,
            recovery_rate_gbps,
            recovery_time_ms: None,
            lost_frames_after_reduction: 0,
            recovered: false,
            status: format!("System recovery trial failed: {err}"),
        };
        if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
            results.system_recovery.push(result);
        }
        refresh_runtime_estimate(state, config).await;
        finish(state, format!("RFC2544 system recovery failed: {err}")).await;
        return false;
    }

    set_status(
        state,
        format!(
            "RFC2544 system recovery | overload | mapping {}/{} | {} | {frame_size} B | {:.3} Gbit/s",
            mapping_index,
            mapping_count,
            mapping_label(mapping),
            overload_rate_gbps
        ),
    )
    .await;

    let overload_completed = wait_with_cancel(
        Duration::from_secs(config.system_recovery_overload_duration_secs as u64),
        cancel_token,
    )
    .await;

    if !overload_completed {
        stop_trial(state).await;
        finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
        return false;
    }

    let reduction_at = Instant::now();
    let baseline = sample_trial(state, &trial).await;
    let baseline_loss = baseline.lost_frames;
    let mut last_loss = baseline_loss;
    let mut lost_frames_after_reduction = 0;
    let mut last_loss_increase_at: Option<Instant> = None;
    let mut stable_samples_after_loss = 0_u32;
    let mut status = "No post-reduction loss observed.".to_string();
    let observation_deadline =
        reduction_at + Duration::from_secs(config.system_recovery_observation_duration_secs as u64);
    let mut interval = tokio::time::interval(Duration::from_millis(500));

    set_status(
        state,
        format!(
            "RFC2544 system recovery | recovery | mapping {}/{} | {} | {frame_size} B | {:.3} Gbit/s",
            mapping_index,
            mapping_count,
            mapping_label(mapping),
            recovery_rate_gbps
        ),
    )
    .await;

    loop {
        tokio::select! {
            _ = interval.tick() => {
                let sample = sample_trial(state, &trial).await;
                if sample.lost_frames > last_loss {
                    lost_frames_after_reduction = sample.lost_frames.saturating_sub(baseline_loss);
                    last_loss = sample.lost_frames;
                    last_loss_increase_at = Some(Instant::now());
                    stable_samples_after_loss = 0;
                } else if last_loss_increase_at.is_some() {
                    stable_samples_after_loss += 1;
                }

                if Instant::now() >= observation_deadline {
                    break;
                }
            }
            _ = cancel_token.cancelled() => {
                stop_trial(state).await;
                finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
                return false;
            }
        }
    }

    stop_trial(state).await;
    if !trial_cooldown(
        state,
        config,
        format!(
            "System recovery | mapping {}/{} | {} | {frame_size} B",
            mapping_index,
            mapping_count,
            mapping_label(mapping)
        ),
        cancel_token,
    )
    .await
    {
        return false;
    }

    let recovered = if last_loss_increase_at.is_none() {
        true
    } else if stable_samples_after_loss >= 2 {
        status = "System recovery observed.".to_string();
        true
    } else {
        status = "Recovery not confirmed before timeout.".to_string();
        false
    };

    let recovery_time_ms = last_loss_increase_at
        .map(|instant| {
            instant
                .saturating_duration_since(reduction_at)
                .as_secs_f64()
                * 1000.0
        })
        .or(Some(0.0));

    let result = Rfc2544SystemRecoveryResult {
        mapping: mapping.clone(),
        frame_size,
        throughput_rate_gbps,
        overload_rate_gbps,
        recovery_rate_gbps,
        recovery_time_ms,
        lost_frames_after_reduction,
        recovered,
        status,
    };

    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.system_recovery.push(result);
    }
    refresh_runtime_estimate(state, config).await;

    true
}

async fn run_reset(
    state: &Arc<AppState>,
    base: &TrafficGenData,
    config: &Rfc2544Config,
    mapping: &Rfc2544PortMapping,
    mapping_index: usize,
    mapping_count: usize,
    frame_size: u32,
    rate_gbps: f64,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> bool {
    set_status(
        state,
        format!(
            "RFC2544 reset | starting | mapping {}/{} | {} | {frame_size} B",
            mapping_index,
            mapping_count,
            mapping_label(mapping)
        ),
    )
    .await;

    let rate_gbps = usable_trial_rate(rate_gbps, config);
    let trial = build_trial_payload(base, frame_size, rate_gbps, None);
    if let Err(err) = start_single_test(state, trial.clone()).await {
        error!("RFC2544 reset trial failed: {err}");
        finish(state, format!("RFC2544 reset failed: {err}")).await;
        return false;
    }

    let context = format!(
        "Reset | mapping {}/{} | {} | {frame_size} B",
        mapping_index,
        mapping_count,
        mapping_label(mapping)
    );
    let warmup_ran = warmup_will_run(config, *mapping_warmup_done);
    if !maybe_warmup(
        state,
        config,
        mapping_warmup_done,
        context.clone(),
        cancel_token,
    )
    .await
    {
        return false;
    }
    // The reset detection reads the RX rate gauge, which could still contain
    // a stale nonzero rate from the previous trial.
    if !settle_statistics(state, config, warmup_ran, cancel_token).await {
        return false;
    }

    set_status(
        state,
        format!(
            "RFC2544 reset | waiting for DUT to reset | mapping {}/{} | {} | {frame_size} B",
            mapping_index,
            mapping_count,
            mapping_label(mapping)
        ),
    )
    .await;

    let started = Instant::now();
    let timeout = Duration::from_secs(config.reset_timeout_secs as u64);
    let zero_threshold_gbps = 0.001_f64;
    let mut saw_traffic = false;
    let mut down_at: Option<Instant> = None;
    let mut reset_time_ms = None;
    let mut status = "No reset/offline event observed before timeout.".to_string();
    let mut interval = tokio::time::interval(Duration::from_millis(500));

    loop {
        tokio::select! {
            _ = interval.tick() => {
                let sample = sample_trial(state, &trial).await;
                if sample.rx_rate_gbps > zero_threshold_gbps {
                    if let Some(down) = down_at {
                        reset_time_ms = Some(down.elapsed().as_secs_f64() * 1000.0);
                        status = "Reset recovery observed.".to_string();
                        break;
                    }
                    saw_traffic = true;
                } else if saw_traffic && down_at.is_none() {
                    down_at = Some(Instant::now());
                    set_status(
                        state,
                        format!(
                            "RFC2544 reset | DUT offline, waiting for recovery | mapping {}/{} | {} | {frame_size} B",
                            mapping_index,
                            mapping_count,
                            mapping_label(mapping)
                        ),
                    )
                    .await;
                }

                if started.elapsed() >= timeout {
                    break;
                }
            }
            _ = cancel_token.cancelled() => {
                stop_trial(state).await;
                finish(state, "RFC2544 benchmark cancelled.".to_string()).await;
                return false;
            }
        }
    }

    stop_trial(state).await;
    if !trial_cooldown(state, config, context, cancel_token).await {
        return false;
    }

    let result = Rfc2544ResetResult {
        mapping: mapping.clone(),
        frame_size,
        rate_gbps,
        reset_time_ms,
        status,
    };

    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.reset.push(result);
    }
    refresh_runtime_estimate(state, config).await;

    true
}

pub async fn run(state: Arc<AppState>, payload: TrafficGenData, cancel_token: CancellationToken) {
    let Some(config) = payload.rfc2544.clone() else {
        finish(&state, "RFC2544 configuration missing.".to_string()).await;
        return;
    };

    info!("Starting RFC2544 benchmark.");
    *state.rfc2544_results.lock().await = Some(Rfc2544Results::new(&config));

    let needs_throughput =
        config.throughput || config.latency || config.reset || config.system_recovery;
    let mappings = serial_mappings(&payload);
    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.selected_mappings = mappings.clone();
    }
    refresh_runtime_estimate(&state, &config).await;
    start_runtime_estimate_ticker(state.clone(), cancel_token.clone());
    if mappings.is_empty() {
        finish(
            &state,
            "RFC2544 benchmark failed: no active TX/RX port mappings configured.".to_string(),
        )
        .await;
        return;
    }

    for (mapping_offset, mapping) in mappings.iter().enumerate() {
        let mapping_index = mapping_offset + 1;
        let mapping_count = mappings.len();
        let Some(mapping_payload) = payload_for_mapping(&payload, mapping) else {
            info!(
                "RFC2544: skipping mapping {} because it has no active stream setting.",
                mapping_label(mapping)
            );
            continue;
        };

        let mut throughput_rates: HashMap<u32, f64> = HashMap::new();
        let mut mapping_warmup_done = false;

        set_status(
            &state,
            format!(
                "RFC2544 | running mapping {}/{} serially | {}",
                mapping_index,
                mapping_count,
                mapping_label(mapping)
            ),
        )
        .await;

        for frame_size in config.frame_sizes.clone() {
            if cancel_token.is_cancelled() {
                finish(&state, "RFC2544 benchmark cancelled.".to_string()).await;
                return;
            }

            if needs_throughput {
                let Some(result) = run_throughput(
                    &state,
                    &mapping_payload,
                    &config,
                    mapping,
                    mapping_index,
                    mapping_count,
                    frame_size,
                    &mut mapping_warmup_done,
                    &cancel_token,
                )
                .await
                else {
                    return;
                };
                throughput_rates.insert(frame_size, result.zero_loss_rate_gbps);
            }

            if frame_size == RFC2544_IMIX_FRAME_SIZE {
                continue;
            }

            let zero_loss_rate = throughput_rates
                .get(&frame_size)
                .copied()
                .unwrap_or(config.line_rate_gbps as f64);
            let zero_loss_rate = usable_trial_rate(zero_loss_rate, &config);

            if config.latency
                && !run_latency(
                    &state,
                    &mapping_payload,
                    &config,
                    mapping,
                    mapping_index,
                    mapping_count,
                    frame_size,
                    zero_loss_rate,
                    &mut mapping_warmup_done,
                    &cancel_token,
                )
                .await
            {
                return;
            }

            if config.frame_loss
                && !run_frame_loss(
                    &state,
                    &mapping_payload,
                    &config,
                    mapping,
                    mapping_index,
                    mapping_count,
                    frame_size,
                    &mut mapping_warmup_done,
                    &cancel_token,
                )
                .await
            {
                return;
            }

            if config.system_recovery
                && !run_system_recovery(
                    &state,
                    &mapping_payload,
                    &config,
                    mapping,
                    mapping_index,
                    mapping_count,
                    frame_size,
                    zero_loss_rate,
                    &cancel_token,
                )
                .await
            {
                return;
            }

            if config.reset
                && !run_reset(
                    &state,
                    &mapping_payload,
                    &config,
                    mapping,
                    mapping_index,
                    mapping_count,
                    frame_size,
                    zero_loss_rate,
                    &mut mapping_warmup_done,
                    &cancel_token,
                )
                .await
            {
                return;
            }
        }
    }

    stop_trial(&state).await;
    finish(&state, "RFC2544 benchmark complete.".to_string()).await;
    info!("RFC2544 benchmark complete.");
}
