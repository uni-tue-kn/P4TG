use log::{info, warn};
use rbfrt::table::{self, MatchValue};

use crate::core::traffic_gen_core::{
    const_definitions::{PATTERN_CONFIG_TABLE, PATTERN_METER_TABLE, PATTERN_TABLE},
    helper::range_to_prefixes,
    types::{GenerationPattern, GenerationPatternConfig},
};

const MAX_AUTOMATIC_BURST_MASKED_INTERVAL_FRACTION: f64 = 0.05;
const PREFERRED_AUTOMATIC_PATTERN_BURST_PACKETS: u64 = 100;

fn minimum_pattern_burst_packets(factor: f64, generator_burst_packets: u64) -> u64 {
    let factor = factor.clamp(0.0, 1.0);
    ((factor * generator_burst_packets.max(1) as f64).ceil() as u64).max(1)
}

fn maximum_transition_burst_packets(factor: f64, interval_packets: u64) -> u64 {
    let factor = factor.clamp(0.0, 1.0);
    (MAX_AUTOMATIC_BURST_MASKED_INTERVAL_FRACTION * (1.0 - factor) * interval_packets as f64)
        .floor() as u64
}

/// Compute the [start, end] range (inclusive) of the `i`-th "point"
/// when splitting [0, space) into `total_points` equal-ish segments.
fn point_range_in_space(i: u32, total_points: u32, space: u64) -> (u32, u32) {
    assert!(total_points > 0);
    assert!(space > 0);

    let start = (space * i as u64) / total_points as u64;
    let end_exclusive = (space * (i as u64 + 1)) / total_points as u64;

    let start_u32 = start as u32;
    let end_u32 = (end_exclusive - 1) as u32; // inclusive

    (start_u32, end_u32)
}

fn pattern_burst_packets(
    factor: f64,
    configured_burst_packets: Option<u64>,
    interval_packets: u64,
    generator_burst_packets: u64,
) -> (u64, bool) {
    if let Some(burst_packets) = configured_burst_packets {
        return (burst_packets, false);
    }

    // The bucket must hold the tokens accrued between pktgen bursts or the
    // interval systematically undershoots its configured rate.
    let minimum_burst_packets = minimum_pattern_burst_packets(factor, generator_burst_packets);

    let preferred_burst_packets =
        minimum_burst_packets.max(PREFERRED_AUTOMATIC_PATTERN_BURST_PACKETS);

    if factor >= 1.0 {
        return (preferred_burst_packets, false);
    }

    // A full bucket is drained by the difference between offered and target
    // rates. Reduce the preferred capacity when needed to drain within 5% of
    // this interval, but never below the minimum viable bucket. If even that
    // minimum is too large, report that the transition cannot be represented.
    let maximum_transition_burst_packets =
        maximum_transition_burst_packets(factor, interval_packets);

    if minimum_burst_packets > maximum_transition_burst_packets {
        (minimum_burst_packets, true)
    } else {
        (
            preferred_burst_packets.min(maximum_transition_burst_packets),
            false,
        )
    }
}

fn packet_burst_to_kbits(packet_size_bytes: u32, burst_packets: u64) -> u32 {
    if burst_packets == 0 {
        return 0;
    }

    let bits = burst_packets
        .saturating_mul(packet_size_bytes as u64)
        .saturating_mul(8);

    bits.saturating_add(999)
        .saturating_div(1000)
        .max(1)
        .min(u32::MAX as u64) as u32
}

fn same_meter_factor(a: f64, b: f64) -> bool {
    (a - b).abs() < f64::EPSILON
}

/// Simple normalized sine factor in [0, 1].
fn sine_factor(k: u32, sampling_rate: u32) -> f64 {
    let x = k as f64 / sampling_rate as f64;
    // + 1 to scale from [-1, 1] to [0, 2], then *0.5 to scale to [0, 1]
    0.5 * (1.0 + (2.0 * std::f64::consts::PI * x).sin())
}

/// Simple square wave factor in {low, 1}.
fn square_factor(k: u32, low: f64, high_until: f64, sampling_rate: u32, inverted: bool) -> f64 {
    let x = k as f64 / sampling_rate as f64;
    let high_first = x < high_until;
    if high_first != inverted {
        1.0
    } else {
        low
    }
}

fn triangle_factor(k: u32, sampling_rate: u32) -> f64 {
    let x = k as f64 / sampling_rate as f64;
    if x < 0.5 {
        2.0 * x
    } else {
        2.0 * (1.0 - x)
    }
}

fn cat_factor(k: u32, sampling_rate: u32) -> f64 {
    let x = (k as f64 / sampling_rate as f64) % 1.0;

    // Control points (x_i, y_i)
    // xs: [0.00, 0.10, 0.20, 0.25, 0.30, 0.40, 0.60, 0.70, 0.75, 0.80, 0.90, 1.00]
    // ys: [0.00, 0.15, 0.55, 0.95, 0.55, 0.60, 0.60, 0.55, 0.95, 0.55, 0.15, 0.00]

    if x < 0.10 {
        // segment [0.00 → 0.10]
        let t = (x - 0.00) / (0.10 - 0.00);
        0.00 + t * (0.15 - 0.00)
    } else if x < 0.20 {
        // segment [0.10 → 0.20]
        let t = (x - 0.10) / (0.20 - 0.10);
        0.15 + t * (0.55 - 0.15)
    } else if x < 0.25 {
        // segment [0.20 → 0.25]
        let t = (x - 0.20) / (0.25 - 0.20);
        0.55 + t * (0.95 - 0.55)
    } else if x < 0.30 {
        // segment [0.25 → 0.30]
        let t = (x - 0.25) / (0.30 - 0.25);
        0.95 + t * (0.55 - 0.95)
    } else if x < 0.40 {
        // segment [0.30 → 0.40]
        let t = (x - 0.30) / (0.40 - 0.30);
        0.55 + t * (0.60 - 0.55)
    } else if x < 0.60 {
        // segment [0.40 → 0.60]
        0.60
    } else if x < 0.70 {
        // segment [0.60 → 0.70]
        let t = (x - 0.60) / (0.70 - 0.60);
        0.60 + t * (0.55 - 0.60)
    } else if x < 0.75 {
        // segment [0.70 → 0.75]
        let t = (x - 0.70) / (0.75 - 0.70);
        0.55 + t * (0.95 - 0.55)
    } else if x < 0.80 {
        // segment [0.75 → 0.80]
        let t = (x - 0.75) / (0.80 - 0.75);
        0.95 + t * (0.55 - 0.95)
    } else if x < 0.90 {
        // segment [0.80 → 0.90]
        let t = (x - 0.80) / (0.90 - 0.80);
        0.55 + t * (0.15 - 0.55)
    } else {
        // segment [0.90 → 1.00]
        let t = (x - 0.90) / (1.00 - 0.90);
        0.15 + t * (0.00 - 0.15)
    }
}

fn sawtooth_factor(k: u32, sampling_rate: u32, inverted: bool) -> f64 {
    // Include both endpoints for multi-sample ramps. Dividing by
    // `sampling_rate` never reached the configured peak rate.
    let factor = if sampling_rate <= 1 {
        0.0
    } else {
        k.min(sampling_rate - 1) as f64 / (sampling_rate - 1) as f64
    };
    if inverted {
        1.0 - factor
    } else {
        factor
    }
}

fn default_flashcrowd_quiet_until(period_ns: f64) -> f64 {
    period_ns * 0.2
}

fn default_flashcrowd_ramp_until(period_ns: f64) -> f64 {
    period_ns * 0.25
}

fn resolve_flashcrowd_timings(pattern_config: &GenerationPatternConfig) -> (f64, f64, f64) {
    let quiet_until_ns = pattern_config
        .fc_quiet_until
        .unwrap_or(default_flashcrowd_quiet_until(pattern_config.period));
    let ramp_until_ns = pattern_config
        .fc_ramp_until
        .unwrap_or(default_flashcrowd_ramp_until(pattern_config.period));
    let decay_rate = pattern_config.fc_decay_rate.unwrap_or(4.0);

    (
        quiet_until_ns / pattern_config.period,
        ramp_until_ns / pattern_config.period,
        decay_rate,
    )
}

fn flashcrowd_factor(
    k: u32,
    sampling_rate: u32,
    quiet_until: f64,
    ramp_until: f64,
    decay_rate: f64,
) -> f64 {
    let x = k as f64 / sampling_rate as f64; // phase in [0,1)

    if x < quiet_until {
        // Quiet baseline
        0.0
    } else if x < ramp_until {
        // Linear ramp from 0 → 1 over a short window
        (x - quiet_until) / (ramp_until - quiet_until)
    } else {
        // Exponential decay tail from 1 → ~0 over the rest of the period
        let t = (x - ramp_until) / (1.0 - ramp_until); // map [ramp_until,1) -> [0,1)
        (-(t * decay_rate)).exp().min(1.0)
    }
}

pub struct PatternGenerationEntries {
    pub period_pkts: u32,
    pub table_entries: Vec<table::Request>,
    pub meter_entries: Vec<table::Request>,
    pub next_interval_id: u32,
}

/// Build pattern_generation entries for one app_id, given a bounded phase
/// counter in [0 .. period_pkts), and a desired sine pattern.
///
/// - app_id: generator/application id (matches hdr.pkt_gen.app_id)
/// - pattern_config.period: period in seconds
/// - traffic_gbps: total TX rate of the generator (Gbps)
/// - offered_pps_per_pipe: effective configured packet rate per pipe from pktgen timing
/// - total_frame_size_bytes: on-wire size used by line-rate calculations (L1 model)
/// - meter_packet_size_bytes: packet size in bytes as seen by ingress meter
/// - num_pipes: number of active pipes sharing that rate
/// - generator_burst_packets: packets emitted per pipe in one pktgen timer event,
///   including all configured batches
///
/// This function:
///  1. Uses effective per-pipe pps from configured pktgen timing
///  2. Computes period_pkts ≈ period_secs * per-pipe-pps
///  3. Splits [0..period_pkts) into NUM_SAMPLES segments
///  4. For each segment, computes a sine amplitude factor
///  5. Creates one indexed-meter entry per logical interval
///  6. Decomposes interval ranges into LPM prefixes that all point at that meter
pub fn build_pattern_generation_entries(
    app_id: u8,
    pattern_config: GenerationPatternConfig,
    traffic_gbps: f64,
    offered_pps_per_pipe: f64,
    total_frame_size_bytes: u32,
    meter_packet_size_bytes: u32,
    num_pipes: f64,
    generator_burst_packets: u64,
    first_interval_id: u32,
) -> PatternGenerationEntries {
    // 1) The pattern period config is in nanoseconds. Convert it to seconds.
    let period_ns = pattern_config.period.max(1.0);
    let period_secs = period_ns / 1e9_f64;
    let sampling_rate = pattern_config.sample_rate;

    let gbps_per_pipe = traffic_gbps / num_pipes.max(1.0);
    let mut traffic_mpps = offered_pps_per_pipe / 1e6_f64;
    if traffic_mpps <= 0.0 {
        traffic_mpps = 1.0;
    }

    // 2) Packets per period (this drives the bounded modulo in dataplane)
    let period_pkts_f = period_secs * offered_pps_per_pipe;
    let mut period_pkts = period_pkts_f.round() as u64;
    if period_pkts == 0 {
        period_pkts = 1;
    }
    if period_pkts > u32::MAX as u64 {
        period_pkts = u32::MAX as u64;
    }
    let period_pkts_u32 = period_pkts as u32;

    // Effective period (for logging) given this discrete packet count
    let pps = traffic_mpps * 1e6_f64;
    let effective_period_secs = period_pkts as f64 / pps;

    info!(
        "App {}: requested period ~{:.3} s @ {:.3} Gbps (per-pipe ~{:.3} Mpps), Frame size {:} B \
         -> period_pkts ~= {:.3}M, effective ~{:.3} s",
        app_id,
        period_secs,
        traffic_gbps,
        traffic_mpps,
        total_frame_size_bytes,
        period_pkts as f64 / 1e6_f64,
        effective_period_secs,
    );

    // 3) Split [0..period_pkts) into NUM_SAMPLES segments
    // If period_pkts is very small, reduce sample count so each segment
    // still has at least 1 packet.
    let total_points = sampling_rate.min(period_pkts_u32);
    let space = period_pkts; // length of phase space for this app_id

    // 4) Max rate used as amplitude (kbps).
    // Convert configured line-rate target into the byte domain seen by the ingress meter.
    let meter_to_line_ratio = meter_packet_size_bytes as f64 / total_frame_size_bytes.max(1) as f64;
    let max_kbps = gbps_per_pipe * 1e6_f64 * meter_to_line_ratio;
    let inverted = pattern_config.inverted.unwrap_or(false);

    let mut ranges = Vec::new();

    for point_idx in 0..total_points {
        // Map point to sample on the sine
        let sample_idx = (point_idx * sampling_rate / total_points) % sampling_rate;
        let factor = match &pattern_config.pattern_type {
            GenerationPattern::Sine => sine_factor(sample_idx, sampling_rate),
            GenerationPattern::Square => {
                let low = pattern_config.square_low.unwrap_or(0.0);
                let high_until = pattern_config
                    .square_high_until
                    .unwrap_or(pattern_config.period * 0.5)
                    / pattern_config.period;
                square_factor(sample_idx, low, high_until, sampling_rate, inverted)
            }
            GenerationPattern::Triangle => triangle_factor(sample_idx, sampling_rate),
            GenerationPattern::Sawtooth => sawtooth_factor(sample_idx, sampling_rate, inverted),
            GenerationPattern::CatWave => cat_factor(sample_idx, sampling_rate),
            GenerationPattern::Flashcrowd => {
                let (quiet_until, ramp_until, decay_rate) =
                    resolve_flashcrowd_timings(&pattern_config);
                flashcrowd_factor(
                    sample_idx,
                    sampling_rate,
                    quiet_until,
                    ramp_until,
                    decay_rate,
                )
            }
        };

        // Segment range in [0..period_pkts)
        let (start, end) = point_range_in_space(point_idx, total_points, space);
        if end < start {
            continue;
        }

        if let Some((_, last_end, last_factor)) = ranges.last_mut() {
            if *last_end + 1 == start && same_meter_factor(*last_factor, factor) {
                *last_end = end;
                continue;
            }
        }

        ranges.push((start, end, factor));
    }

    let mut table_entries = Vec::new();
    let mut meter_entries = Vec::new();
    let mut next_interval_id = first_interval_id;
    let mut automatic_burst_transition_violations = 0usize;
    let mut automatic_burst_range: Option<(u64, u64)> = None;
    let mut manual_burst_rate_violations = 0usize;
    let mut manual_burst_transition_violations = 0usize;
    let mut largest_manual_minimum = 0u64;

    for (start, end, factor) in ranges {
        let interval_id = next_interval_id;
        next_interval_id = next_interval_id.saturating_add(1);

        let cir_kbps = (factor * max_kbps) as u64;
        let pir_kbps = cir_kbps;
        let interval_packets = end as u64 - start as u64 + 1;
        if let Some(configured_burst_packets) = pattern_config.burst_packets {
            let minimum_burst_packets =
                minimum_pattern_burst_packets(factor, generator_burst_packets);
            if configured_burst_packets < minimum_burst_packets {
                manual_burst_rate_violations += 1;
                largest_manual_minimum = largest_manual_minimum.max(minimum_burst_packets);
            }

            if factor < 1.0
                && configured_burst_packets
                    > maximum_transition_burst_packets(factor, interval_packets)
            {
                manual_burst_transition_violations += 1;
            }
        }
        let (burst_packets, transition_bound_exceeded) = pattern_burst_packets(
            factor,
            pattern_config.burst_packets,
            interval_packets,
            generator_burst_packets,
        );
        automatic_burst_transition_violations += transition_bound_exceeded as usize;
        if pattern_config.burst_packets.is_none() {
            automatic_burst_range = Some(match automatic_burst_range {
                Some((minimum, maximum)) => {
                    (minimum.min(burst_packets), maximum.max(burst_packets))
                }
                None => (burst_packets, burst_packets),
            });
        }
        let cbs_kbits = packet_burst_to_kbits(meter_packet_size_bytes, burst_packets);
        let pbs_kbits = cbs_kbits;

        let meter_req = table::Request::new(PATTERN_METER_TABLE)
            .match_key("$METER_INDEX", MatchValue::exact(interval_id))
            .action_data("$METER_SPEC_CIR_KBPS", cir_kbps as u32)
            .action_data("$METER_SPEC_PIR_KBPS", pir_kbps as u32)
            .action_data("$METER_SPEC_CBS_KBITS", cbs_kbits)
            .action_data("$METER_SPEC_PBS_KBITS", pbs_kbits);

        meter_entries.push(meter_req);

        // Range-to-prefix (LPM) seems to consume less MAT space than range-to-ternary here.
        let prefixes = range_to_prefixes(start, end);

        for (base, prefix_len) in prefixes {
            let req = table::Request::new(PATTERN_TABLE)
                .match_key("hdr.pkt_gen.app_id", MatchValue::exact(app_id))
                .match_key(
                    "ig_md.pattern_interval_number",
                    MatchValue::lpm(base, prefix_len.into()),
                )
                .action("ingress.p4tg.pattern_shaping.set_interval_id")
                .action_data("interval_id", interval_id);

            table_entries.push(req);
        }
    }

    if let Some((minimum, maximum)) = automatic_burst_range {
        info!(
            "App {}: calculated pattern meter burst range: {}-{} packets.",
            app_id, minimum, maximum,
        );
    }

    if automatic_burst_transition_violations > 0 {
        warn!(
            "App {}: automatic pattern meter burst cannot settle within {:.0}% of the interval for {} interval(s). The minimum burst needed to sustain the requested rate is used. Increase the pattern period, reduce its sample rate, or reduce pktgen burstiness for sharper transitions.",
            app_id,
            MAX_AUTOMATIC_BURST_MASKED_INTERVAL_FRACTION * 100.0,
            automatic_burst_transition_violations,
        );
    }

    if manual_burst_rate_violations > 0 {
        warn!(
            "App {}: configured pattern meter burst of {} packets is below the required hardware burst (up to {} packets) for {} interval(s); the requested interval rate may not be reached. Leave burst_packets omitted to calculate a viable value.",
            app_id,
            pattern_config.burst_packets.unwrap_or_default(),
            largest_manual_minimum,
            manual_burst_rate_violations,
        );
    }

    if manual_burst_transition_violations > 0 {
        warn!(
            "App {}: configured pattern meter burst of {} packets can mask more than {:.0}% of {} interval transition(s); the requested pattern may be blurred. Leave burst_packets omitted to calculate a transition-aware value.",
            app_id,
            pattern_config.burst_packets.unwrap_or_default(),
            MAX_AUTOMATIC_BURST_MASKED_INTERVAL_FRACTION * 100.0,
            manual_burst_transition_violations,
        );
    }

    PatternGenerationEntries {
        period_pkts: period_pkts_u32,
        table_entries,
        meter_entries,
        next_interval_id,
    }
}

/// Build the single pattern_config entry for this app_id,
/// programming `period_pkts` into ig_md.period_pkts.
pub fn build_pattern_config_entry(app_id: u8, period_pkts: u32) -> table::Request {
    table::Request::new(PATTERN_CONFIG_TABLE)
        .match_key("hdr.pkt_gen.app_id", MatchValue::exact(app_id))
        .action("ingress.p4tg.pattern_shaping.set_pattern_config")
        .action_data("period_pkts_cp", period_pkts - 1)
}
