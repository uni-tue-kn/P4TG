use log::{info, warn};
use rbfrt::table::{self, MatchValue};

use crate::core::traffic_gen_core::{
    const_definitions::{MAX_PATTERN_TABLE_ENTRIES, PATTERN_CONFIG_TABLE, PATTERN_TABLE},
    helper::range_to_prefixes,
    types::{GenerationPattern, GenerationPatternConfig},
};

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

/// Simple normalized sine factor in [0, 1].
fn sine_factor(k: u32, sampling_rate: u32) -> f64 {
    let x = k as f64 / sampling_rate as f64;
    // + 1 to scale from [-1, 1] to [0, 2], then *0.5 to scale to [0, 1]
    0.5 * (1.0 + (2.0 * std::f64::consts::PI * x).sin())
}

/// Simple square wave factor in {0, 1}.
fn square_factor(k: u32, low: f64, sampling_rate: u32) -> f64 {
    let x = k as f64 / sampling_rate as f64;
    if x < 0.5 {
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

fn sawtooth_factor(k: u32, sampling_rate: u32) -> f64 {
    k as f64 / sampling_rate as f64
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

/// Max rate in kbps given traffic rate in Mpps and bytes-per-packet.
fn max_rate_kbps(traffic_mpps: f64, bytes_per_pkt: u64) -> f64 {
    let pps = traffic_mpps * 1e6_f64;
    let bps = pps * bytes_per_pkt as f64 * 8.0;
    bps / 1000.0
}

/// Build pattern_generation entries for one app_id, given a bounded phase
/// counter in [0 .. period_pkts), and a desired sine pattern.
///
/// - app_id: generator/application id (matches hdr.pkt_gen.app_id)
/// - pattern_config.period: period in seconds
/// - traffic_gbps: total TX rate of the generator (Gbps)
/// - total_frame_size_bytes: actual on-wire frame size
/// - num_pipes: number of active pipes sharing that rate
///
/// This function:
///  1. Computes per-pipe Mpps from Gbps, frame size, and num_pipes
///  2. Computes period_pkts ≈ period_secs * per-pipe-pps
///  3. Splits [0..period_pkts) into NUM_SAMPLES segments
///  4. For each segment, computes a sine amplitude factor
///  5. Decomposes segment ranges into LPM prefixes and creates table entries
pub fn build_pattern_generation_entries(
    app_id: u8,
    pattern_config: GenerationPatternConfig,
    traffic_gbps: f64,
    total_frame_size_bytes: u32,
    num_pipes: f64,
) -> (u32, Vec<table::Request>) {
    // 1) Period (seconds) and per-pipe Mpps
    let period_secs = (pattern_config.period).max(0.001);
    let sampling_rate = pattern_config.sample_rate;

    let gbps_per_pipe = traffic_gbps / num_pipes.max(1.0);
    // per-pipe Mpps = (Gbps * 1e3) / (bytes * 8)
    let mut traffic_mpps = gbps_per_pipe * 1e3 / (total_frame_size_bytes as f64 * 8.0);
    if traffic_mpps <= 0.0 {
        traffic_mpps = 1.0;
    }

    // 2) Packets per period (this drives the bounded modulo in dataplane)
    let period_pkts_f = period_secs * traffic_mpps * 1e6_f64;
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

    // 4) Max rate used as amplitude (kbps)
    let max_kbps = max_rate_kbps(traffic_mpps, total_frame_size_bytes as u64);

    let mut entries = Vec::new();

    for point_idx in 0..total_points {
        // Map point to sample on the sine
        let sample_idx = (point_idx * sampling_rate / total_points) % sampling_rate;
        let factor = match pattern_config.pattern_type {
            GenerationPattern::Sine => sine_factor(sample_idx, sampling_rate),
            GenerationPattern::Square => {
                let low = pattern_config.square_low.unwrap_or(0.0);
                square_factor(sample_idx, low, sampling_rate)
            }
            GenerationPattern::Triangle => triangle_factor(sample_idx, sampling_rate),
            GenerationPattern::Sawtooth => sawtooth_factor(sample_idx, sampling_rate),
            GenerationPattern::CatWave => cat_factor(sample_idx, sampling_rate),
            GenerationPattern::Flashcrowd => {
                let quiet_until = pattern_config.fc_quiet_until.unwrap_or(0.2); // 0–20% of period: no load
                let ramp_until = pattern_config.fc_ramp_until.unwrap_or(0.25); // 20–25% of period: fast ramp to 1
                let decay_rate = pattern_config.fc_decay_rate.unwrap_or(4.0); // bigger = faster decay in the tail
                flashcrowd_factor(
                    sample_idx,
                    sampling_rate,
                    quiet_until,
                    ramp_until,
                    decay_rate,
                )
            }
        };

        let cir_kbps = (factor * max_kbps) as u64;
        let pir_kbps = cir_kbps;
        // Size the buckets larger enough such that we do not starve the tokens
        let cbs_kbits = 100 * total_frame_size_bytes * 8 / 1000;
        let pbs_kbits = 100 * total_frame_size_bytes * 8 / 1000;

        // Segment range in [0..period_pkts)
        let (start, end) = point_range_in_space(point_idx, total_points, space);
        if end < start {
            continue;
        }

        // Range-to-prefix (LPM) seems to consume less MAT space than range-to-ternary here.
        let prefixes = range_to_prefixes(start, end);

        for (base, prefix_len) in prefixes {
            if entries.len() >= MAX_PATTERN_TABLE_ENTRIES {
                warn!(
                    "WARNING: reached MAX_PATTERN_TABLE_ENTRIES ({}) while building pattern table",
                    MAX_PATTERN_TABLE_ENTRIES
                );
                return (period_pkts_u32, entries);
            }

            let req = table::Request::new(PATTERN_TABLE)
                .match_key("hdr.pkt_gen.app_id", MatchValue::exact(app_id))
                .match_key(
                    "ig_md.pattern_interval_number",
                    MatchValue::lpm(base, prefix_len.into()),
                )
                .action("ingress.p4tg.pattern_shaping.pattern_shape")
                .action_data("$METER_SPEC_CIR_KBPS", cir_kbps as u32)
                .action_data("$METER_SPEC_PIR_KBPS", pir_kbps as u32)
                .action_data("$METER_SPEC_CBS_KBITS", cbs_kbits)
                .action_data("$METER_SPEC_PBS_KBITS", pbs_kbits);

            entries.push(req);
        }
    }

    (period_pkts_u32, entries)
}

/// Build the single pattern_config entry for this app_id,
/// programming `period_pkts` into ig_md.period_pkts.
pub fn build_pattern_config_entry(app_id: u8, period_pkts: u32) -> table::Request {
    table::Request::new(PATTERN_CONFIG_TABLE)
        .match_key("hdr.pkt_gen.app_id", MatchValue::exact(app_id))
        .action("ingress.p4tg.pattern_shaping.set_pattern_config")
        .action_data("period_pkts_cp", period_pkts - 1)
}
