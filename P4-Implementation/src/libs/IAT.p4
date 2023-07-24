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
Computes inter arrival time (IAT) and possibly
reports it to the control plane.
The creation of a digest is limited by a meter instance wich is configured by the control plane
Pkt in -> Compute IAT -> If meter allows --> Create digest
*/
control IAT(inout header_t hdr,
            inout ingress_metadata_t ig_md,
            in ingress_intrinsic_metadata_t ig_intr_md,
            inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md) {

    // IAT monitoring
    Register<bit<32>, PortId_t>(256, 0) lower_last_rx;
    Register<bit<16>, PortId_t>(256, 0) higher_last_rx;

    // used to limit the digest rate
    Meter<bit<9>>(256, MeterType_t.BYTES) digest_rate;

    RegisterAction<bit<32>, PortId_t, bit<32>>(lower_last_rx) set_lower_last_rx = {
            void apply(inout bit<32> value, out bit<32> read_value) {
                read_value = value;
                value = ig_intr_md.ingress_mac_tstamp[31:0];
            }
    };

    RegisterAction<bit<16>, PortId_t, bit<16>>(higher_last_rx) set_higher_last_rx = {
            void apply(inout bit<16> value, out bit<16> read_value) {
                read_value = value;
                value = ig_intr_md.ingress_mac_tstamp[47:32];
            }
    };

    action compute_iat(in bit<48> last_rx, out bit<32> iat) {
        iat = (bit<32>)(ig_intr_md.ingress_mac_tstamp - last_rx);
    }

    apply {
        // normal data packet, calculate iat
        if(!hdr.monitor.isValid()) {
            bit<48> last_rx = 0;

            last_rx[31:0] = set_lower_last_rx.execute(ig_intr_md.ingress_port);
            last_rx[47:32] = set_higher_last_rx.execute(ig_intr_md.ingress_port);

            compute_iat(last_rx, ig_md.iat);

            bit<8> color = digest_rate.execute(ig_intr_md.ingress_port);

            // packet is not colored red
            // this limits the digest rate to a control plane specified value
            if(color != 0b11) {
                ig_dprsr_md.digest_type = 2;
            }
        }
    }
}
