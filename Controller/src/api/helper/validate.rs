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

use crate::core::traffic_gen_core::types::*;
use crate::api::server::Error;
use crate::core::traffic_gen_core::const_definitions::{MAX_BUFFER_SIZE, MAX_NUM_MPLS_LABEL, TG_MAX_RATE, TG_MAX_RATE_TF2};
use crate::core::traffic_gen_core::helper::calculate_overhead;
use crate::core::traffic_gen_core::types::{Encapsulation, GenerationMode};

/// Validates an incoming traffic generation request.
/// Checks if the MPLS configuration is correct, i.e., if the MPLS stack matches the number of LSEs.
pub fn validate_request(streams: &[Stream], settings: &[StreamSetting], mode: &GenerationMode, is_tofino2: bool) -> Result<(), Error> {
    for stream in streams.iter(){
        // Check max number of MPLS labels
        if stream.encapsulation == Encapsulation::Mpls {
            if stream.number_of_lse.is_none() {
                return Err(Error::new(format!("number_of_lse missing for stream #{}", stream.stream_id)))
            }

            if stream.number_of_lse.unwrap() > MAX_NUM_MPLS_LABEL {
                return Err(Error::new(format!("Configured number of LSEs in stream with ID #{} exceeded maximum of {}.", stream.stream_id, MAX_NUM_MPLS_LABEL)));
            }

            if stream.number_of_lse.unwrap() == 0 {
                return Err(Error::new(format!("MPLS encapsulation selected for stream with ID #{} but #LSE is zero.", stream.stream_id)));
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
                if stream.encapsulation == Encapsulation::Mpls && setting.mpls_stack.is_none() {
                    return Err(Error::new(format!("No MPLS stack provided for stream with ID #{} on port {}.", stream.stream_id, setting.port)))
                }

                // Validate if the configured number_of_lse per stream matches the MPLS stack size
                if stream.encapsulation == Encapsulation::Mpls && setting.mpls_stack.as_ref().unwrap().len() != stream.number_of_lse.unwrap() as usize {
                    return Err(Error::new(format!("Number of LSEs in stream with ID #{} does not match length of the MPLS stack.", setting.stream_id)));
                }
            }

            // Check VxLAN
            if stream.vxlan && setting.vxlan.is_none() {
                return Err(Error::new(format!("Stream with ID #{} is a VxLAN stream but no VxLAN settings provided.", stream.stream_id)));
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

    Ok(())

}