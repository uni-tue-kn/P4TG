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
Computes round trip time (RTT)
*/
control RTT(inout header_t hdr,
            inout ingress_metadata_t ig_md,
            in ingress_intrinsic_metadata_t ig_intr_md,
            inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md) {

    // used to limit the digest rate
    Meter<bit<9>>(512, MeterType_t.BYTES) digest_rate;

    action calculate_rtt(in bit<48> tx_stamp, out bit<32> ret_rtt) {
        ret_rtt = (bit<32>) (ig_intr_md.ingress_mac_tstamp - tx_stamp);
    }

    apply {
        bit<8> color = digest_rate.execute(ig_intr_md.ingress_port);

        // packet is not colored red
        // this limits the digest rate to a control plane specified value
        if(color != 0b11) {
            calculate_rtt(hdr.path.tx_tstmp, ig_md.rtt);
            ig_dprsr_md.digest_type = 2;
        }


    }
}
