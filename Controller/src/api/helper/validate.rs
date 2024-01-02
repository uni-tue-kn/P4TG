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

use crate::api::{Stream, StreamSetting};
use crate::api::server::Error;
use crate::core::traffic_gen_core::const_definitions::MAX_NUM_MPLS_LABEL;
use crate::core::traffic_gen_core::types::Encapsulation;

/// Validates an incoming traffic generation request.
/// Checks if the MPLS configuration is correct, i.e., if the MPLS stack matches the number of LSEs.
pub fn validate_request(streams: &Vec<Stream>, settings: &Vec<StreamSetting>) -> Result<(), Error> {
    // Validate if the configured number_of_lse per stream matches the MPLS stack size
    for stream in streams.iter(){
        if stream.encapsulation == Encapsulation::MPLS {

            if stream.number_of_lse > MAX_NUM_MPLS_LABEL {
                return Err(Error::new(format!("Configured number of LSEs in stream {} exceeded maximum of {}.", stream.stream_id, MAX_NUM_MPLS_LABEL)));
            }

            if stream.number_of_lse == 0 {
                return Err(Error::new(format!("MPLS encapsulation selected for stream {} but #LSE is zero.", stream.stream_id)));
            }

            for setting in settings.iter(){
                if setting.stream_id == stream.stream_id && setting.mpls_stack.len() != stream.number_of_lse as usize {
                    return Err(Error::new(format!("Number of LSEs in stream {} does not match length of the MPLS stack.", setting.stream_id)));
                }
            }
        }
    }

    Ok(())

}