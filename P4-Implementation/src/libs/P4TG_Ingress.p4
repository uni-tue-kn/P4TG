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
 
#include "./IAT.p4"
#include "./RTT.p4"
#include "./ingress/Frame_Type_Monitor.p4"

control P4TG_Ingress (
    inout header_t hdr,
    inout ingress_metadata_t ig_md, in ingress_intrinsic_metadata_t ig_intr_md, in ingress_intrinsic_metadata_from_parser_t ig_prsr_md,
    inout ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md,
    inout ingress_intrinsic_metadata_for_tm_t ig_tm_md) {

    IAT() iat;
    RTT() rtt;
    Frame_Type_Monitor() frame_type;

    // poisson
    Random<bit<16>>() rand;

    Register<seq_t, PortId_t>(512, 0) rx_seq;
    Add_64_64(512) lost_packets;
    Add_64_64(512) out_of_order;

    RegisterAction<seq_t, PortId_t, seq_t>(rx_seq) get_rx = {
        void apply(inout seq_t value, out seq_t read_value) {
            read_value = value;

            if(hdr.path.seq >= value) {
                value = hdr.path.seq + 1;
            }
            else if(value - hdr.path.seq > 2147483648) {
                value = hdr.path.seq + 1;
                //ig_md.overflow = 1;
                //read_value = hdr.path.seq;
            }
            else {
                value = value;
            }
        }
    };

    action port_forward(PortId_t e_port) {
            ig_tm_md.ucast_egress_port = e_port;
    }

    action forward_monitor(PortId_t e_port, bit<15> index) {
            ig_tm_md.ucast_egress_port = e_port;
            //ig_tm_md.bypass_egress = 1w1;

            hdr.monitor.index = index;
    }

    action mc_forward(bit<16> mcid) {
        ig_tm_md.mcast_grp_a = mcid;
    }



    action make_digest() {
        ig_dprsr_md.digest_type = 1;
    }

    action make_digest_and_forward(PortId_t e_port, bit<15> index) {
        ig_dprsr_md.digest_type = 1;
        ig_tm_md.ucast_egress_port = e_port;

        hdr.monitor.index = index;
        //hdr.monitor.app_id = app_id;
    }

    table tg_forward {
        key = {
              ig_intr_md.ingress_port: exact;
              hdr.pkt_gen.app_id: exact;
              ig_md.rand_value: range;
          }
        actions = {
              port_forward;
              mc_forward;
        }
        size = 64;
    }

    table monitor_forward {
        key = {
              ig_intr_md.ingress_port: exact;
              hdr.monitor.index: exact;
        }
        actions = {
            port_forward;
            forward_monitor;
            mc_forward;
            make_digest;
            make_digest_and_forward;
        }
        size = 256;
    }

    table forward {
        key = {
              ig_intr_md.ingress_port: exact;
          }
        actions = {
              port_forward;
        }
        size = 64;
    }


    action nop() {}

    // this table checks if a packet was received on an ingress port
    table is_ingress {
        key = {
            ig_intr_md.ingress_port: exact;
        }
        actions = {
            nop;

        }
        size = 64;
    }

    // this table is used to activate/deactivate
    // iat monitoring
    table monitor_iat {
        key = {
            ig_intr_md.ingress_port: lpm;
        }
        actions = {
            nop;
        }
        size = 1;
    }

    apply {
        // monitor iats and send to controller
        // limited by meter
        if(monitor_iat.apply().hit) {
            iat.apply(hdr, ig_md, ig_intr_md, ig_dprsr_md);
        }

        // monitor frame types
        frame_type.apply(hdr, ig_md, ig_intr_md);

        // random value used for poisson traffic
        ig_md.rand_value = rand.get();

        ig_md.ig_port = ig_intr_md.ingress_port;

        bit<64> dummy = 0;

        if(hdr.path.isValid() && hdr.path.dst_port == UDP_P4TG_PORT) { // this is P4TG traffic
                                                               // identified through the dst port in the UDP frame
            if(is_ingress.apply().hit) {

                // calculate rtt and send to controller
                // limited by meter
                rtt.apply(hdr, ig_md, ig_intr_md, ig_dprsr_md);

                // get next expected rx
                seq_t r_seq = get_rx.execute(ig_md.ig_port);

                seq_t m = max(r_seq, hdr.path.seq);
                seq_t diff = (hdr.path.seq - r_seq);

                if(m == hdr.path.seq) { // packet loss
                    lost_packets.apply(dummy, (bit<64>) diff, (bit<32>)ig_md.ig_port);
                }
                else { // sequence number lower than expected
                    out_of_order.apply(dummy, 1, (bit<32>)ig_md.ig_port);
                }
            }
        }
        else if(hdr.monitor.isValid()) {
            bit<64> reordered_packets = 0;
            monitor_forward.apply();

            lost_packets.apply(hdr.monitor.packet_loss, 0, (bit<32>)ig_md.ig_port);

            out_of_order.apply(reordered_packets, 0, (bit<32>)ig_md.ig_port);

            hdr.monitor.out_of_order = (bit<40>) reordered_packets;
        }

        if(hdr.pkt_gen.isValid() && !hdr.monitor.isValid()) {
            tg_forward.apply();
        }
        else {
            if(!hdr.monitor.isValid()) {
                forward.apply();
            }
        }

   }
}
