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
 
/*
Computes round trip time (RTT)
*/
control RTT(inout header_t hdr,
            inout ingress_metadata_t ig_md,
            in ingress_intrinsic_metadata_t ig_intr_md,
            inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md) {

    // used to limit the digest rate
    Meter<bit<9>>(512, MeterType_t.BYTES) digest_rate;

    DirectCounter<bit<64>>(CounterType_t.PACKETS) histogram_counter;

    action calculate_rtt(in bit<48> tx_stamp, out bit<32> ret_rtt) {
        ret_rtt = (bit<32>) (ig_intr_md.ingress_mac_tstamp - tx_stamp);
    }

    action count_histogram_bin(bit<16> bin_index) {
        histogram_counter.count();
        ig_md.bin_index = bin_index;
    }

    action count_missed_bin(){
        histogram_counter.count();
    }

    table rtt_histogram {
        key = {
            ig_md.ig_port: exact;
            ig_md.rtt: ternary;
        }
        actions = {
            count_histogram_bin;
            count_missed_bin;
        } 
        counters = histogram_counter;
        default_action = count_missed_bin;
        size = 8192;
    }

    apply {
        bit<8> color = digest_rate.execute(ig_intr_md.ingress_port);

        calculate_rtt(hdr.path.tx_tstmp, ig_md.rtt);

        /*
        The rtt_histogram table models the bins of the histogram.
        Because we cannot use the range match type here, a bin is modelled by multiple ternary entries.
        Those entries are mapped to a single bin using the bin_index action parameter.
        The ternary entries to model a single histogram bin are computed in the control plane.
        */
        rtt_histogram.apply();
        if (ig_md.bin_index != 65535) {
            // bin_index is not used in the data plane. It is included in a condition, to avoid removal by compiler optimization
            ig_md.bin_index = 0;
        }

        // packet is not colored red
        // this limits the digest rate to a control plane specified value        
        if(color != 0b11) {
            ig_dprsr_md.digest_type = 2;
        }


    }
}
