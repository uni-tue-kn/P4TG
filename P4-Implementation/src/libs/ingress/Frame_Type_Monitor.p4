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
 
/*
Monitors the frame types (multicast, unicast, broadcast) using a DirectCounter
*/
control Frame_Type_Monitor(
    inout header_t hdr,
    in ingress_intrinsic_metadata_t ig_intr_md) {

    DirectCounter<bit<64>>(CounterType_t.PACKETS_AND_BYTES) frame_type_counter;


    action unicast() {
        frame_type_counter.count();
    }

    action multicast() {
        frame_type_counter.count();
    }

    action broadcast() {
        frame_type_counter.count();
    }

    table frame_type_monitor {
        key = {
            hdr.ipv4.dst_addr: lpm;
            ig_intr_md.ingress_port: exact;
        }
        actions = {
            unicast;
            multicast;
            broadcast;
        }
        default_action = unicast;
        counters = frame_type_counter;
        size = 64;
    }

    apply {
        if(hdr.ipv4.isValid()) {
            frame_type_monitor.apply();
        }
    }
}
