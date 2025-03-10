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

use std::collections::HashMap;

use crate::core::traffic_gen_core::types::*;
use crate::api::server::Error;
use crate::core::traffic_gen_core::const_definitions::{MAX_BUFFER_SIZE, MAX_NUM_MPLS_LABEL, MAX_NUM_SRV6_SIDS, TG_MAX_RATE, TG_MAX_RATE_TF2, MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO1, MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO2};
use crate::core::traffic_gen_core::helper::calculate_overhead;
use crate::core::traffic_gen_core::types::{Encapsulation, GenerationMode};
use crate::PortMapping;

/// Validates an incoming traffic generation request.
/// Checks if the MPLS/SRv6 configuration is correct, i.e., if the MPLS stack matches the number of LSEs.
pub fn validate_request(streams: &[Stream], settings: &[StreamSetting], mode: &GenerationMode, tx_rx_port_mapping: &HashMap<u32, u32>, available_ports: HashMap<u32, PortMapping>, is_tofino2: bool) -> Result<(), Error> {
    for stream in streams.iter(){
        // Check max number of MPLS labels
        if stream.encapsulation == Encapsulation::Mpls || stream.encapsulation == Encapsulation::BierWithMPLS{
            if stream.number_of_lse.is_none() {
                return Err(Error::new(format!("number_of_lse missing for stream #{}", stream.stream_id)))
            }

            if stream.number_of_lse.unwrap() > MAX_NUM_MPLS_LABEL {
                return Err(Error::new(format!("Configured number of LSEs in stream with ID #{} exceeded maximum of {}.", stream.stream_id, MAX_NUM_MPLS_LABEL)));
            }

            if stream.number_of_lse.unwrap() == 0 {
                return Err(Error::new(format!("MPLS encapsulation selected for stream with ID #{} but #LSE is zero.", stream.stream_id)));
            }
        } else if stream.encapsulation == Encapsulation::SRv6 {
            if !is_tofino2 {
                return Err(Error::new(format!("SRv6 is only supported on Tofino2.")));
            }

            if stream.number_of_srv6_sids.is_none() {
                return Err(Error::new(format!("number_of_srv6_sids missing for stream #{}", stream.stream_id)))
            }

            if stream.number_of_srv6_sids.unwrap() > MAX_NUM_SRV6_SIDS {
                return Err(Error::new(format!("Configured number of SIDs in stream with ID #{} exceeded maximum of {}.", stream.stream_id, MAX_NUM_SRV6_SIDS)));
            }

            if stream.number_of_srv6_sids.unwrap() == 0 {
                return Err(Error::new(format!("SRv6 encapsulation selected for stream with ID #{} but #SIDs is zero.", stream.stream_id)));
            }
        }

        for setting in settings.iter() {
            if setting.stream_id == stream.stream_id {
                // check VLAN settings
                if (stream.encapsulation == Encapsulation::Vlan || stream.encapsulation == Encapsulation::QinQ) && setting.vlan.is_none() {
                    return Err(Error::new(format!("VLAN encapsulation selected for stream with iD #{}, but no VLAN settings provided for port {}.", stream.stream_id, setting.port)))
                }

                // check MPLS
                // check that mpls stack is set
                if (stream.encapsulation == Encapsulation::Mpls || stream.encapsulation == Encapsulation::BierWithMPLS) && setting.mpls_stack.is_none() {
                    return Err(Error::new(format!("No MPLS stack provided for stream with ID #{} on port {}.", stream.stream_id, setting.port)))
                }

                // Check BIER
                if stream.encapsulation == Encapsulation::Bier && setting.bier.is_none() {
                    return Err(Error::new(format!("No BIER header provided for stream with ID #{} on port {}.", stream.stream_id, setting.port)))
                }                

                // Validate if the configured number_of_lse per stream matches the MPLS stack size
                if (stream.encapsulation == Encapsulation::Mpls || stream.encapsulation == Encapsulation::BierWithMPLS) && setting.mpls_stack.as_ref().unwrap().len() != stream.number_of_lse.unwrap() as usize {
                    return Err(Error::new(format!("Number of LSEs in stream with ID #{} does not match length of the MPLS stack.", setting.stream_id)));
                }

                // check SRv6
                // check that SID list is set
                if stream.encapsulation == Encapsulation::SRv6 && setting.sid_list.is_none() {
                    return Err(Error::new(format!("No SID list provided for stream with ID #{} on port {}.", stream.stream_id, setting.port)))
                }

                // Validate if the configured number_of_srv6_sids per stream matches the SID list length
                if stream.encapsulation == Encapsulation::SRv6 && setting.sid_list.as_ref().unwrap().len() != stream.number_of_srv6_sids.unwrap() as usize {
                    return Err(Error::new(format!("Number of SIDs in stream with ID #{} does not match length of the SID list.", setting.stream_id)));
                }

                // Validate IP settings, but not if no inner IP header is used in SRv6
                if (stream.encapsulation == Encapsulation::SRv6 && stream.srv6_ip_tunneling.unwrap_or(true)) || stream.encapsulation != Encapsulation::SRv6 {
                    if stream.ip_version != Some(6) && stream.ip_version != Some(4) && !stream.ip_version.is_none() {
                        return Err(Error::new(format!("Unsupported IP version for stream with ID #{} on port {}.", stream.stream_id, setting.port)));
                    }

                    if stream.ip_version == Some(4) && setting.ip.is_none() {
                        return Err(Error::new(format!("Missing IPv4 settings for stream with ID #{} on port {}.", stream.stream_id, setting.port)));

                    } else if stream.ip_version == Some(6) && setting.ipv6.is_none() {
                        return Err(Error::new(format!("Missing IPv6 settings for stream with ID #{} on port {}.", stream.stream_id, setting.port)));
                    } 
                    // Validate IPv6 Address Randomization Mask size
                    if stream.ip_version == Some(6) && setting.ipv6.is_some() {
                        let ipv6_src_mask_int: u128 = setting.ipv6.as_ref().unwrap().ipv6_src_mask.into();
                        let ipv6_dst_mask_int: u128 = setting.ipv6.as_ref().unwrap().ipv6_dst_mask.into();

                        // For tofino2 at most ::ff:ffff:ffff, for tofino1 ::ffff:ffff
                        let randomization_max = if is_tofino2 {MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO2} else {MAX_ADDRESS_RANDOMIZATION_IPV6_TOFINO1};

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
                    return Err(Error::new(format!("Stream with ID #{} is a VxLAN stream but no VxLAN settings provided.", stream.stream_id)));
                }

                if stream.vxlan && stream.ip_version == Some(6) {
                    return Err(Error::new(format!("VxLAN with IPv6 is not supported! (Stream with ID #{})", stream.stream_id)));
                }

                // VxLAN with MPLS on Tofino 1 not supported
                if stream.vxlan && stream.encapsulation == Encapsulation::Mpls && !is_tofino2 {
                    return Err(Error::new(format!("Combination of VxLAN and MPLS is not supported on Tofino1 (Stream with ID #{})", stream.stream_id)));
                }  

                // Check VxLAN is disabled for SRv6
                if stream.vxlan && stream.encapsulation == Encapsulation::SRv6 {
                    return Err(Error::new(format!("Combination of VxLAN and SRv6 is not supported (Stream with ID #{})", stream.stream_id)));
                }  
            }
        }
    }

    if streams.iter().map(|s| s.frame_size).collect::<Vec<u32>>().iter().sum::<u32>() > MAX_BUFFER_SIZE {
        return Err(Error::new(format!("Sum of packet size too large. Maximal sum of packets size: {}B", MAX_BUFFER_SIZE)));
    }

    if settings.is_empty() && *mode != GenerationMode::Analyze {
        return Err(Error::new("No active streams provided."));
    }

    if streams.is_empty() && *mode != GenerationMode::Analyze {
        return Err(Error::new("No stream provided."));
    }

    // Validate max sending rate
    // at most 100 or 400 Gbps are supported
    let rate: f32 = if *mode == GenerationMode::Mpps {
        streams.iter().map(|x| (x.frame_size + calculate_overhead(x) + 20) as f32 * 8f32 * x.traffic_rate / 1000f32).sum()
    }
    else {
        streams.iter().map(|x| x.traffic_rate).sum()
    };

    if *mode != GenerationMode::Analyze && rate > if is_tofino2 {TG_MAX_RATE_TF2} else {TG_MAX_RATE} {
        return Err(Error::new("Traffic rate in sum larger than maximal supported rate."))
    }

    // Verify that port is actually available on this device. This might happen if a configuration from another device is imported.
    for (tx_port, rx_port) in tx_rx_port_mapping.iter(){
        if !available_ports.contains_key(&tx_port){
            return Err(Error::new(format!("Configuration error: TX port {} is not available on this device.", tx_port)));
        }
        if !available_ports.contains_key(&rx_port){
            return Err(Error::new(format!("Configuration error: RX port {} is not available on this device.", rx_port)));
        }        
    }

    Ok(())

}