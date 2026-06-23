use std::collections::{HashMap, HashSet};
use std::sync::Arc;
use std::time::{Duration, Instant};

use log::{error, info, warn};
use tokio_util::sync::CancellationToken;

use crate::api::traffic_gen::start_single_test;
use crate::core::traffic_gen_core::const_definitions::BATCH_FACTOR;
use crate::core::traffic_gen_core::helper::{
    calculate_overhead, generate_front_panel_to_dev_port_mappings, get_num_pipes,
    translate_fp_channel_to_dev_port_mapping,
};
use crate::core::traffic_gen_core::optimization::calculate_send_behaviour;
use crate::core::traffic_gen_core::types::{
    GenerationMode, GenerationPattern, GenerationPatternConfig, GenerationUnit, Rfc2544Config,
    Rfc2544FrameLossResult, Rfc2544LatencyResult, Rfc2544PortMapping, Rfc2544ResetResult,
    Rfc2544Results, Rfc2544SystemRecoveryResult, Rfc2544ThroughputResult, RxTarget, TrafficGenData,
};
use crate::AppState;

const MIN_THROUGHPUT_LOSS_OBSERVATION_SECS: u32 = 4;

struct TrialSample {
    rx_rate_gbps: f64,
    lost_frames: u64,
    tx_frames: u128,
    rx_frames: u128,
    rtts: Vec<u64>,
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
    payload.name = Some(format!("RFC2544 {frame_size}B"));
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
    if stream.batches.is_some_and(|b| b && stream.burst != 1) {
        timeout *= BATCH_FACTOR;
    }
    if n_packets == 0 || timeout == 0 {
        return Some(
            "System recovery pattern period cannot be represented for this rate.".to_string(),
        );
    }

    let batch_factor = if stream.batches.is_some_and(|b| b && stream.burst != 1) {
        BATCH_FACTOR as f64
    } else {
        1.0
    };
    let offered_pps_per_pipe = n_packets as f64 * batch_factor * 1e9_f64 / timeout as f64;
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
        rx_rate_gbps,
        lost_frames,
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

async fn trial_cooldown(
    state: &Arc<AppState>,
    config: &Rfc2544Config,
    context: String,
    cancel_token: &CancellationToken,
) -> bool {
    if config.cooldown_duration_secs == 0 {
        return true;
    }

    set_status(
        state,
        format!(
            "RFC2544 cool-down | {context} | waiting {}s before next trial",
            config.cooldown_duration_secs
        ),
    )
    .await;

    if wait_with_cancel(
        Duration::from_secs(config.cooldown_duration_secs as u64),
        cancel_token,
    )
    .await
    {
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
    set_status(
        state,
        format!(
            "RFC2544 throughput | mapping {}/{} | {} | {frame_size} B",
            mapping_index,
            mapping_count,
            mapping_label(mapping)
        ),
    )
    .await;

    let line_rate_gbps = config.line_rate_gbps as f64;
    let total_trials = config.throughput_search_steps.saturating_add(1);
    let line_rate_loss = run_fixed_rate_loss_trial(
        state,
        base,
        config,
        frame_size,
        line_rate_gbps,
        mapping,
        mapping_index,
        mapping_count,
        1,
        total_trials,
        mapping_warmup_done,
        cancel_token,
    )
    .await?;

    let (zero_loss_rate_gbps, first_loss_rate, result_lost_frames) = if line_rate_loss == 0 {
        (line_rate_gbps, None, 0)
    } else {
        let mut low_rate = 0.0;
        let mut high_rate = line_rate_gbps;
        let mut first_loss_rate = Some(line_rate_gbps);
        let mut result_lost_frames = line_rate_loss;

        for step in 0..config.throughput_search_steps {
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
                step + 2,
                total_trials,
                mapping_warmup_done,
                cancel_token,
            )
            .await?;

            if mid_loss == 0 {
                low_rate = mid_rate;
            } else {
                high_rate = mid_rate;
                first_loss_rate = Some(mid_rate);
                result_lost_frames = mid_loss;
            }
        }

        let zero_loss_rate_gbps = if positive_rate(low_rate) {
            low_rate
        } else {
            warn!(
                "RFC2544 throughput for {frame_size} byte frames did not find a positive no-loss fixed-rate trial; using half of first positive loss rate for follow-up trials."
            );
            usable_trial_rate(high_rate / 2.0, config)
        };

        (zero_loss_rate_gbps, first_loss_rate, result_lost_frames)
    };

    let result = Rfc2544ThroughputResult {
        mapping: mapping.clone(),
        frame_size,
        zero_loss_rate_gbps,
        first_loss_rate_gbps: first_loss_rate,
        lost_frames: result_lost_frames,
    };

    if let Some(results) = state.rfc2544_results.lock().await.as_mut() {
        results.throughput.push(result.clone());
    }

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
    trial_index: u32,
    trial_count: u32,
    mapping_warmup_done: &mut bool,
    cancel_token: &CancellationToken,
) -> Option<u64> {
    let rate_gbps = usable_trial_rate(rate_gbps, config);
    set_status(
        state,
        format!(
            "RFC2544 throughput | mapping {}/{} | {} | {frame_size} B | trial {}/{} | {:.3} Gbit/s",
            mapping_index,
            mapping_count,
            mapping_label(mapping),
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
        "Throughput | mapping {}/{} | {} | {frame_size} B | trial {}/{} | {:.3} Gbit/s",
        mapping_index,
        mapping_count,
        mapping_label(mapping),
        trial_index,
        trial_count,
        rate_gbps
    );
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

    let baseline = sample_trial(state, &trial).await;
    let baseline_loss = baseline.lost_frames;
    let measurement_start = Instant::now();
    let deadline = measurement_start + Duration::from_secs(config.trial_duration_secs as u64);
    let early_loss_stop_at = measurement_start
        + Duration::from_secs(
            config
                .trial_duration_secs
                .min(MIN_THROUGHPUT_LOSS_OBSERVATION_SECS) as u64,
        );
    let mut interval = tokio::time::interval(Duration::from_secs(1));
    interval.tick().await;
    let mut trial_loss = 0;

    let completed = loop {
        tokio::select! {
            _ = interval.tick() => {
                let sample = sample_trial(state, &trial).await;
                trial_loss = sample.lost_frames.saturating_sub(baseline_loss);

                if trial_loss > 0 && Instant::now() >= early_loss_stop_at {
                    break true;
                }

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
    let sample = sample_trial(state, &trial).await;
    trial_loss = trial_loss.max(sample.lost_frames.saturating_sub(baseline_loss));

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

        let baseline = sample_trial(state, &trial).await;
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
