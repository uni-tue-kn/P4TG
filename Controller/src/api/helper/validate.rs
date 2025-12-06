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
* Fabian Ihle (fabian.ihle@uni-tuebingen.de)
*/

use log::warn;
use std::collections::HashMap;

use crate::api::server::Error;
use crate::core::statistics::HistogramConfig;
use crate::core::traffic_gen_core::const_definitions::{
    IAT_HISTOGRAM_TABLE_SIZE, MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO1,
    MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO2, MAX_BUFFER_SIZE, MAX_NUM_MPLS_LABEL, MAX_NUM_SRV6_SIDS,
    RTT_HISTOGRAM_TABLE, RTT_HISTOGRAM_TABLE_SIZE, TG_MAX_RATE, TG_MAX_RATE_TF2,
};
use crate::core::traffic_gen_core::helper::{
    calculate_overhead, generate_front_panel_to_dev_port_mappings, mpps_to_gbps,
};
use crate::core::traffic_gen_core::types::*;
use crate::core::traffic_gen_core::types::{Encapsulation, GenerationMode};
use crate::PortMapping;

/// Validates an incoming traffic generation request.
/// Checks if the MPLS/SRv6 configuration is correct, i.e., if the MPLS stack matches the number of LSEs.
pub fn validate_request(
    payload: &TrafficGenData,
    available_ports: &HashMap<u32, PortMapping>,
    is_tofino2: bool,
) -> Result<Vec<Stream>, Error> {
    let front_panel_dev_port_mappings =
        generate_front_panel_to_dev_port_mappings(available_ports, is_tofino2);

    let active_stream_settings: Vec<StreamSetting> = payload
        .stream_settings
        .clone()
        .into_iter()
        .filter(|s| s.active)
        .collect();

    for setting in active_stream_settings.iter() {
        // Validate that front panel port is available
        if !front_panel_dev_port_mappings.contains_key(&setting.port) {
            return Err(Error::new(format!(
                "No mapping for front panel port {:?} in StreamSettings. From version 2.5.0 onwards, the configuration requires the front panel port number instead of the dev port number.",
                setting.port
            )));
        }
        // Validate that configured channels are available (i.e., port is in breakout mode, if multiple channels configured)
        if let Some(x) = setting.channel {
            if x != 0 {
                let default_pm = PortMapping::default();
                // Breakout mode
                let dev_port = front_panel_dev_port_mappings
                    .get(&setting.port)
                    .unwrap_or(&0u32);
                let breakout_mode = available_ports
                    .get(dev_port)
                    .unwrap_or(&default_pm)
                    .breakout_mode
                    .unwrap_or(false);
                if !breakout_mode {
                    return Err(Error::new(format!("Port {:?} is not configured in breakout mode, but multiple channels are configured for generation. Try resetting your local storage.", &setting.port)));
                }
            }
        }
    }

    let active_stream_ids: Vec<u8> = active_stream_settings.iter().map(|s| s.stream_id).collect();
    let active_streams: Vec<Stream> = payload
        .streams
        .clone()
        .into_iter()
        .filter(|s| active_stream_ids.contains(&s.stream_id))
        .collect();

    let tx_rx_port_mapping = &payload.port_tx_rx_mapping;

    // Validate that front panel port is available
    for (tx, channel) in tx_rx_port_mapping.iter() {
        if !front_panel_dev_port_mappings.contains_key(&tx.parse().unwrap_or(u32::MAX)) {
            return Err(Error::new(format!(
                "No mapping for front panel port {tx:?} in TX-RX mapping. From version 2.5.0 onwards, the configuration requires the front panel port number instead of the dev port number."
            )));
        }
        for (_, rx_target) in channel.iter() {
            if !front_panel_dev_port_mappings.contains_key(&rx_target.port) {
                return Err(Error::new(format!(
                "No mapping for front panel port {:?} in TX-RX mapping. From version 2.5.0 onwards, the configuration requires the front panel port number instead of the dev port number.", rx_target.port
            )));
            }
        }
    }

    let rtt_histogram_config = &payload.rtt_histogram_config;
    // Validate that front panel port is available
    if let Some(h_cfg) = rtt_histogram_config {
        for (rx, _) in h_cfg.iter() {
            if !front_panel_dev_port_mappings.contains_key(&rx.parse().unwrap_or(u32::MAX)) {
                return Err(Error::new(format!(
                "No mapping for front panel port {rx:?} in RTT histogram config. From version 2.5.0 onwards, the configuration requires the front panel port number instead of the dev port number."
            )));
            }
        }
    }
    let iat_histogram_config = &payload.iat_histogram_config;
    // Validate that front panel port is available
    if let Some(h_cfg) = iat_histogram_config {
        for (rx, _) in h_cfg.iter() {
            if !front_panel_dev_port_mappings.contains_key(&rx.parse().unwrap_or(u32::MAX)) {
                return Err(Error::new(format!(
                "No mapping for front panel port {rx:?} in IAT histogram config. From version 2.5.0 onwards, the configuration requires the front panel port number instead of the dev port number."
            )));
            }
        }
    }

    // Poisson traffic is only allowed to have a single stream
    if payload.mode == GenerationMode::Poisson && active_streams.len() != 1 {
        return Err(Error::new(
            "Poisson generation mode only allows for one stream.",
        ));
    }

    // no streams should be generated in monitor/analyze mode
    if payload.mode == GenerationMode::Analyze && !active_streams.is_empty() {
        return Err(Error::new("No stream definition in analyze mode allowed."));
    }

    for stream in active_streams.iter() {
        // Check max number of MPLS labels
        if stream.encapsulation == Encapsulation::Mpls {
            if stream.number_of_lse.is_none() {
                return Err(Error::new(format!(
                    "number_of_lse missing for stream #{}",
                    stream.stream_id
                )));
            }

            if stream.number_of_lse.unwrap() > MAX_NUM_MPLS_LABEL {
                return Err(Error::new(format!(
                    "Configured number of LSEs in stream with ID #{} exceeded maximum of {}.",
                    stream.stream_id, MAX_NUM_MPLS_LABEL
                )));
            }

            if stream.number_of_lse.unwrap() == 0 {
                return Err(Error::new(format!(
                    "MPLS encapsulation selected for stream with ID #{} but #LSE is zero.",
                    stream.stream_id
                )));
            }
        } else if stream.encapsulation == Encapsulation::SRv6 {
            if !is_tofino2 {
                return Err(Error::new("SRv6 is only supported on Tofino2.".to_string()));
            }

            if stream.number_of_srv6_sids.is_none() {
                return Err(Error::new(format!(
                    "number_of_srv6_sids missing for stream #{}",
                    stream.stream_id
                )));
            }

            if stream.number_of_srv6_sids.unwrap() > MAX_NUM_SRV6_SIDS {
                return Err(Error::new(format!(
                    "Configured number of SIDs in stream with ID #{} exceeded maximum of {}.",
                    stream.stream_id, MAX_NUM_SRV6_SIDS
                )));
            }

            if stream.number_of_srv6_sids.unwrap() == 0 {
                return Err(Error::new(format!(
                    "SRv6 encapsulation selected for stream with ID #{} but #SIDs is zero.",
                    stream.stream_id
                )));
            }
        }

        for setting in active_stream_settings.iter() {
            if setting.stream_id == stream.stream_id {
                // check VLAN settings
                if (stream.encapsulation == Encapsulation::Vlan
                    || stream.encapsulation == Encapsulation::QinQ)
                    && setting.vlan.is_none()
                {
                    return Err(Error::new(format!("VLAN encapsulation selected for stream with iD #{}, but no VLAN settings provided for port {}.", stream.stream_id, setting.port)));
                }

                // check MPLS
                // check that mpls stack is set
                if stream.encapsulation == Encapsulation::Mpls && setting.mpls_stack.is_none() {
                    return Err(Error::new(format!(
                        "No MPLS stack provided for stream with ID #{} on port {}.",
                        stream.stream_id, setting.port
                    )));
                }

                // Validate if the configured number_of_lse per stream matches the MPLS stack size
                if stream.encapsulation == Encapsulation::Mpls
                    && setting.mpls_stack.as_ref().unwrap().len()
                        != stream.number_of_lse.unwrap() as usize
                {
                    return Err(Error::new(format!("Number of LSEs in stream with ID #{} does not match length of the MPLS stack.", setting.stream_id)));
                }

                // check SRv6
                // check that SID list is set
                if stream.encapsulation == Encapsulation::SRv6 && setting.sid_list.is_none() {
                    return Err(Error::new(format!(
                        "No SID list provided for stream with ID #{} on port {}.",
                        stream.stream_id, setting.port
                    )));
                }

                // Validate if the configured number_of_srv6_sids per stream matches the SID list length
                if stream.encapsulation == Encapsulation::SRv6
                    && setting.sid_list.as_ref().unwrap().len()
                        != stream.number_of_srv6_sids.unwrap() as usize
                {
                    return Err(Error::new(format!("Number of SIDs in stream with ID #{} does not match length of the SID list.", setting.stream_id)));
                }

                // Validate IP settings, but not if no inner IP header is used in SRv6
                if (stream.encapsulation == Encapsulation::SRv6
                    && stream.srv6_ip_tunneling.unwrap_or(true))
                    || stream.encapsulation != Encapsulation::SRv6
                {
                    if stream.ip_version != Some(6)
                        && stream.ip_version != Some(4)
                        && stream.ip_version.is_some()
                    {
                        return Err(Error::new(format!(
                            "Unsupported IP version for stream with ID #{} on port {}.",
                            stream.stream_id, setting.port
                        )));
                    }

                    if stream.ip_version == Some(4) && setting.ip.is_none() {
                        return Err(Error::new(format!(
                            "Missing IPv4 settings for stream with ID #{} on port {}.",
                            stream.stream_id, setting.port
                        )));
                    } else if stream.ip_version == Some(6) && setting.ipv6.is_none() {
                        return Err(Error::new(format!(
                            "Missing IPv6 settings for stream with ID #{} on port {}.",
                            stream.stream_id, setting.port
                        )));
                    }
                    // Validate IPv6 Address Randomization Mask size
                    if stream.ip_version == Some(6) && setting.ipv6.is_some() {
                        let ipv6_src_mask_int: u128 =
                            setting.ipv6.as_ref().unwrap().ipv6_src_mask.into();
                        let ipv6_dst_mask_int: u128 =
                            setting.ipv6.as_ref().unwrap().ipv6_dst_mask.into();

                        // For tofino2 at most ::ff:ffff:ffff, for tofino1 ::ffff:ffff
                        let randomization_max = if is_tofino2 {
                            MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO2
                        } else {
                            MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO1
                        };

                        if ipv6_src_mask_int > randomization_max.into() {
                            return Err(Error::new(format!("Source address randomization mask exceeds maximum size of {} for stream with ID #{}.", randomization_max, stream.stream_id)));
                        }
                        if ipv6_dst_mask_int > randomization_max.into() {
                            return Err(Error::new(format!("Destination address randomization mask exceeds maximum size of {} for stream with ID #{}.", randomization_max, stream.stream_id)));
                        }
                    }
                }

                // Check VxLAN
                if stream.vxlan && setting.vxlan.is_none() {
                    return Err(Error::new(format!(
                        "Stream with ID #{} is a VxLAN stream but no VxLAN settings provided.",
                        stream.stream_id
                    )));
                }

                if stream.vxlan && stream.ip_version == Some(6) {
                    return Err(Error::new(format!(
                        "VxLAN with IPv6 is not supported! (Stream with ID #{})",
                        stream.stream_id
                    )));
                }

                // VxLAN with MPLS on Tofino 1 not supported
                if stream.vxlan && stream.encapsulation == Encapsulation::Mpls && !is_tofino2 {
                    return Err(Error::new(format!("Combination of VxLAN and MPLS is not supported on Tofino1 (Stream with ID #{})", stream.stream_id)));
                }

                // Check VxLAN is disabled for SRv6
                if stream.vxlan && stream.encapsulation == Encapsulation::SRv6 {
                    return Err(Error::new(format!(
                        "Combination of VxLAN and SRv6 is not supported (Stream with ID #{})",
                        stream.stream_id
                    )));
                }
            }
        }
    }

    if active_streams
        .iter()
        .map(|s| s.frame_size)
        .collect::<Vec<u32>>()
        .iter()
        .sum::<u32>()
        > MAX_BUFFER_SIZE
    {
        return Err(Error::new(format!(
            "Sum of packet size too large. Maximal sum of packets size: {MAX_BUFFER_SIZE}B"
        )));
    }

    if active_stream_settings.is_empty() && payload.mode != GenerationMode::Analyze {
        return Err(Error::new("No active streams provided."));
    }

    if active_stream_settings.is_empty() && payload.mode != GenerationMode::Analyze {
        return Err(Error::new("No stream provided."));
    }

    // Validate max sending rate
    // at most 100 or 400 Gbps are supported
    let rate: f32 = active_streams
        .iter()
        .map(|x| {
            if x.unit == Some(GenerationUnit::Mpps) || payload.mode == GenerationMode::Mpps {
                mpps_to_gbps(x.frame_size + calculate_overhead(x) + 20, x.traffic_rate)
            } else {
                x.traffic_rate
            }
        })
        .sum();

    if payload.mode != GenerationMode::Analyze
        && rate
            > if is_tofino2 {
                TG_MAX_RATE_TF2
            } else {
                TG_MAX_RATE
            }
    {
        return Err(Error::new(
            "Traffic rate in sum larger than maximal supported rate.",
        ));
    }

    if let Some(histogram_config) = rtt_histogram_config {
        // Validate histogram configuration
        validate_histogram(histogram_config, payload.name.clone(), HistogramType::Rtt)?;
    }
    if let Some(histogram_config) = iat_histogram_config {
        // Validate histogram configuration
        validate_histogram(histogram_config, payload.name.clone(), HistogramType::Iat)?;
    }

    validate_patterns(&active_streams)?;

    Ok(active_streams)
}

pub fn validate_patterns(active_streams: &[Stream]) -> Result<(), Error> {
    for s in active_streams.iter() {
        if let Some(pattern) = &s.pattern {
            // Period > 1
            if pattern.period < 1.0 {
                return Err(Error::new(format!(
                    "Pattern period must be greater than one in stream with ID #{}.",
                    s.stream_id
                )));
            }

            // Sample Rate < 1000
            if pattern.sample_rate > 1000 {
                return Err(Error::new(format!(
                    "Pattern sample rate must be smaller than 1000 in stream with ID #{}.",
                    s.stream_id
                )));
            }

            if let GenerationPattern::Flashcrowd = pattern.pattern_type {
                let quiet_until = pattern.fc_quiet_until.unwrap_or(0.2); // 0–20% of period: no load
                let ramp_until = pattern.fc_ramp_until.unwrap_or(0.25); // 20–25% of period: fast ramp to 1
                let decay_rate = pattern.fc_decay_rate.unwrap_or(4.0); // bigger = faster decay in the tail

                if quiet_until > 1.0 {
                    return Err(Error::new(format!(
                        "Quiet until parameter for flashcrowd must be in the range of [1,0] in stream with ID #{}.",
                        s.stream_id
                    )));
                }
                if ramp_until > 1.0 {
                    return Err(Error::new(format!(
                        "Ramp until parameter for flashcrowd must be in the range of [1,0] in stream with ID #{}.",
                        s.stream_id
                    )));
                }
                if quiet_until > ramp_until {
                    return Err(Error::new(format!(
                        "Ramp until parameter for flashcrowd must be larger than quiet until parameter in stream with ID #{}.",
                        s.stream_id
                    )));
                }
                if decay_rate < 0.0 {
                    return Err(Error::new(format!(
                        "Decay rate parameter for flashcrowd must be larger than zero in stream with ID #{}.",
                        s.stream_id
                    )));
                }
            }

            // Period fits into range
            let pps = match s.unit {
                Some(GenerationUnit::Mpps) => s.traffic_rate * 1_000_000.0,

                Some(GenerationUnit::Gbps) | None => {
                    let frame_bits = (s.frame_size + calculate_overhead(s) + 20) as f32 * 8.0;
                    (s.traffic_rate * 1e9) / frame_bits
                }
            };
            let period_max = (u32::MAX as f64) / pps as f64;
            if pattern.period > period_max {
                return Err(Error::new(format!(
                    "Pattern period too large in stream with ID #{}. Maximal period for configured traffic rate and frame size {} B is {} seconds.",
                    s.stream_id, s.frame_size + calculate_overhead(s) + 20, period_max as u32
                )));
            }
        }
    }

    Ok(())
}

pub fn validate_histogram(
    request: &HashMap<String, HashMap<String, HistogramConfig>>,
    test_name: Option<String>,
    hist_type: HistogramType,
) -> Result<(), Error> {
    let mut num_requests = 0;

    let mut t_name = "".to_string();
    if let Some(name) = test_name {
        t_name = format!(", Test: {name:?},");
    }

    let max_table_size = match hist_type {
        HistogramType::Rtt => RTT_HISTOGRAM_TABLE_SIZE,
        HistogramType::Iat => IAT_HISTOGRAM_TABLE_SIZE,
    };

    for (port, channel_map) in request.iter() {
        for config in channel_map.values() {
            let port: u32 = match port.parse() {
                Ok(p) => p,
                Err(_) => return Err(Error::new(format!("Invalid port number: {port}"))),
            };
            if config.min >= config.max {
                return Err(Error::new(format!("Histogram config error {t_name} port {port}: Minimum value must be less than maximum value of range.")));
            }
            if config.num_bins > 500 {
                return Err(Error::new(format!("Histogram config error {t_name} port {port}: Too many bins. 500 bins per port are supported at maximum.")));
            }
            if config.num_bins > (config.max - config.min) {
                return Err(Error::new(format!("Histogram config error {t_name} port {port}: Too many bins for too less of range. Increase range, or decrease number of bins.")));
            }
            if config.num_bins == 0 {
                return Err(Error::new(format!("Histogram config error {t_name} port {port}: num_bins must be positive for histogram config.")));
            }

            if let Some(percentiles) = &config.percentiles {
                for p in percentiles.iter() {
                    if *p < 0.0 || *p > 1.0 {
                        return Err(Error::new(format!(
                        "Histogram config error {t_name} port {port}: Percentile {p} is not in range (0.0, 1.0)."
                    )));
                    }
                }
                if percentiles.len() > 10 {
                    return Err(Error::new(format!(
                    "Histogram config error {t_name} port {port}: Too many percentiles. At most 10 percentiles are supported."
                )));
                }
            }

            // Calculate bin width based on config params
            let bin_width = config.get_bin_width();

            for bin_index in 0..config.num_bins {
                // For each bin, write table entries
                let start = config.min + bin_index * bin_width;
                let mut end = start + bin_width - 1;
                if end > config.max {
                    end = config.max;
                }

                num_requests += count_range_to_ternary_entries(start, end);
                if num_requests > max_table_size {
                    return Err(Error::new(format!("Number of table entries exceeds available space in table {RTT_HISTOGRAM_TABLE}")));
                }
            }
        }
    }

    Ok(())
}

/// Applies a lighter version of the range to ternary conversion algorithm.
/// This version only counts the number of required entries for validation.
fn count_range_to_ternary_entries(start: u32, end: u32) -> u32 {
    let mut num_requests = 0;
    let mut cur = start;

    while cur <= end {
        let remaining = end - cur;
        if remaining == 0 {
            // Handle a single value case explicitly
            num_requests += 1;
            break;
        }

        let max_block_size = 1 << (31 - remaining.leading_zeros()); // largest power of two ≤ remaining
        let align_size = if cur == 0 {
            1
        } else {
            1 << cur.trailing_zeros()
        }; // alignment constraint
        let size = max_block_size.min(align_size);

        num_requests += 1;
        cur += size;
    }
    num_requests
}

pub fn validate_multiple_test(
    tests: Vec<TrafficGenData>,
    available_ports: &HashMap<u32, PortMapping>,
    is_tofino2: bool,
) -> Result<(), Error> {
    if tests.is_empty() {
        return Err(Error::new("No tests provided."));
    }

    for (idx, test) in tests.iter().enumerate() {
        // Validate that each test has a name
        if test.name.is_none() {
            return Err(Error::new(format!("Test #{idx} has no name.")));
        }

        // Validate that names are unique
        if tests.iter().filter(|t| t.name == test.name).count() > 1 {
            if let Some(name) = &test.name {
                return Err(Error::new(format!("Test {name} has a duplicate name.")));
            } else {
                return Err(Error::new(format!("Test #{idx} has a duplicate name.")));
            }
        }

        // Validate that each test has a duration
        if test.duration.is_none() || test.duration.is_some_and(|d| d == 0) {
            warn!(
                "Test {} has no duration. It will run infinitely.",
                test.name.clone().unwrap()
            );
        }

        match validate_request(test, available_ports, is_tofino2) {
            Ok(_) => {}
            Err(e) => {
                if let Some(name) = &test.name {
                    let m = e.message;
                    return Err(Error::new(format!("Error in test {name}: {m:?}")));
                } else {
                    return Err(e);
                }
            }
        }
    }

    Ok(())
}
