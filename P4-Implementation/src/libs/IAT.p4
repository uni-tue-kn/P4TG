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

struct mean_iat_t {
    bit<32> sum;
    bit<32> n;
}
control IAT(inout header_t hdr,
            inout ingress_metadata_t ig_md,
            in ingress_intrinsic_metadata_t ig_intr_md,
            inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md) {

    // IAT monitoring
    Register<bit<32>, PortId_t>(512, 0) lower_last_rx;
    Register<bit<16>, PortId_t>(512, 0) higher_last_rx;
    Register<mean_iat_t, PortId_t>(512, {0, 0}) mean_iat;
    Register<bit<32>, PortId_t>(512, 0) current_mean_iat; // written by control plane
    Register<mean_iat_t, PortId_t>(512, {0, 0}) mae_iat;

    RegisterAction<mean_iat_t, PortId_t, bit<1>>(mean_iat) count_iat = {
            void apply(inout mean_iat_t value, out bit<1> read_value) {
                if(value.sum + ig_md.iat < 2147483648) {
                    value.sum = value.sum + ig_md.iat;
                    value.n = value.n + 1;
                    read_value = 0;
                }
                else {
                    value.sum = ig_md.iat;
                    value.n = 1;
                    read_value = 1; // we reset mean register; also triggers reset of mae_iat
                }
            }
    };

    RegisterAction<bit<32>, PortId_t, bit<32>>(current_mean_iat) read_current_iat_diff = { // compute difference between mean and current sample
            void apply(inout bit<32> value, out bit<32> read_value) {
                if(value > ig_md.iat) {
                    read_value = value - ig_md.iat;
                }
                else {
                    read_value = ig_md.iat - value;
                }
            }
    };


    RegisterAction<mean_iat_t, PortId_t, bit<32>>(mae_iat) count_mae_iat = {
            void apply(inout mean_iat_t value, out bit<32> read_value) {
                if(value.sum + ig_md.iat_diff_for_mae < 2147483648 && value.n < 2147483640) {
                    value.sum = value.sum + ig_md.iat_diff_for_mae;
                    value.n = value.n + 1;
                }
                else {
                    value.sum = ig_md.iat_diff_for_mae;
                    value.n = 1;
                }
            }
    };

    RegisterAction<mean_iat_t, PortId_t, bit<32>>(mae_iat) reset_mae_iat = {
            void apply(inout mean_iat_t value, out bit<32> read_value) {
                value.sum = 0;
                value.n = 0;
            }
    };

    // used to limit the digest rate
    Meter<bit<9>>(512, MeterType_t.BYTES) digest_rate;

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
        if(!hdr.monitor.isValid() && !hdr.pkt_gen.isValid()) {
            bit<48> last_rx = 0;

            last_rx[31:0] = set_lower_last_rx.execute(ig_intr_md.ingress_port);
            last_rx[47:32] = set_higher_last_rx.execute(ig_intr_md.ingress_port);

            bit<8> color = digest_rate.execute(ig_intr_md.ingress_port);

            compute_iat(last_rx, ig_md.iat);
            ig_md.iat_mae_reset = count_iat.execute(ig_intr_md.ingress_port); // calculate sum of iats; controller uses this to calculate mean iat
            ig_md.iat_diff_for_mae = read_current_iat_diff.execute(ig_intr_md.ingress_port);

            if(ig_md.iat_mae_reset == 0) {
                count_mae_iat.execute(ig_intr_md.ingress_port);
            }
            else { // mean overflow; reset
                reset_mae_iat.execute(ig_intr_md.ingress_port);
            }

            // packet is not colored red
            // this limits the digest rate to a control plane specified value
            if(color != 0b11 && last_rx[31:0] != 0) { // ignore iat after reset
                ig_dprsr_md.digest_type = 2;
            }
            else {
                ig_md.iat = 0; // reset iat
            }
        }
    }
}
