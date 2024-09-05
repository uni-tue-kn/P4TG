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
 
#include "./libs/egress/Header_Replace.p4"
control egress(
    inout header_t hdr,
    inout egress_metadata_t eg_md, in egress_intrinsic_metadata_t eg_intr_md, in egress_intrinsic_metadata_from_parser_t eg_intr_from_prsr,
    inout egress_intrinsic_metadata_for_deparser_t eg_intr_md_for_dprsr,
    inout egress_intrinsic_metadata_for_output_port_t eg_intr_md_for_oport) {

    Header_Replace() header_replace;
    bit<16> pkt_len = 0;
    bit<32> index = 0;

    Add_64_64(4096) rate_l1;
    Add_64_64(4096) rate_l2;
    Add_64_64(4096) app;

    bit<64> dummy = 0;

    Register<seq_t, PortId_t>(512, 0) tx_seq;

    RegisterAction<seq_t, PortId_t, seq_t>(tx_seq) get_next_tx_seq = {
            void apply(inout seq_t value, out seq_t read_value) {
                read_value = value;
                value = value + 1;
            }
    };

    DirectCounter<bit<64>>(CounterType_t.PACKETS_AND_BYTES) frame_counter;

    action nop() {
        frame_counter.count();
    }

    table frame_size_monitor {
        key = {
            pkt_len: range;
            eg_intr_md.egress_port: exact;
        }
        actions = {
            nop;
        }
        size = 512;
        counters = frame_counter;
    }

    action set_tx() {
        hdr.path.tx_tstmp = eg_intr_from_prsr.global_tstamp;
    }

    table is_egress {
        key = {
            eg_intr_md.egress_port: exact;
        }
        actions = {
            set_tx;
        }
        size = 32;
    }

    action no_action() {}
    table is_tx_recirc {
        key = {
            eg_intr_md.egress_port: exact;
        }
        actions = {
            no_action;
        }
        size = 32;
    }

    action init_monitor_header(bit<15> index) {
        hdr.monitor.index = index;
    }

    table monitor_init {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.monitor.index: exact;
        }
        actions = {
            init_monitor_header;
        }
        size = 32;
    }

    action monitor_stream_rate(bit<32> idx) {
        index = idx;
    }

    table monitor_stream {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.path.app_id: exact;
            hdr.path.dst_port: exact;
        }
        actions = {
            monitor_stream_rate;
        }
        size = 256;
    }

    apply {
        bit<64> app_count = 0;

        if(hdr.monitor.isValid()) {
            monitor_init.apply();
            hdr.monitor.tstmp = eg_intr_from_prsr.global_tstamp;
            hdr.monitor.port = eg_intr_md.egress_port;
            rate_l1.apply(hdr.monitor.byte_counter_l1, 0, (bit<32>)eg_intr_md.egress_port); // do not count monitor packet size
            rate_l2.apply(hdr.monitor.byte_counter_l2, 0, (bit<32>)eg_intr_md.egress_port); //
            app.apply(app_count, 0, (bit<32>)hdr.monitor.index);

            hdr.monitor.app_counter = (bit<48>) app_count;
        }
        else {
            monitor_stream.apply();

            bit<64> l_1 = 0;
            bit<64> l_2 = 0;

            if(!is_tx_recirc.apply().hit) {
                l_1 = (bit<64>)(eg_intr_md.pkt_length + 20);
                l_2 = (bit<64>)(eg_intr_md.pkt_length);

                pkt_len = eg_intr_md.pkt_length;
            }
            else { // we need to remove pkt gen header size
                l_1 = (bit<64>)(eg_intr_md.pkt_length + 20 - 6);
                l_2 = (bit<64>)(eg_intr_md.pkt_length - 6);


                pkt_len = eg_intr_md.pkt_length - 6; // minus pkt gen header

                // we are on tx recirc; set sequence number
                if(hdr.path.isValid() && hdr.path.dst_port == UDP_P4TG_PORT) { // make sure its PTG's traffic
                  hdr.path.seq = get_next_tx_seq.execute(eg_intr_md.egress_port);
                }
            }

            rate_l1.apply(dummy, l_1, (bit<32>)eg_intr_md.egress_port);
            rate_l2.apply(dummy, l_2, (bit<32>)eg_intr_md.egress_port);

            app.apply(dummy, l_2, index);

            // set tx tstamp
            if(hdr.path.isValid() && hdr.path.dst_port == UDP_P4TG_PORT) { // make sure its PTG's traffic
                is_egress.apply();
            }

            header_replace.apply(hdr, eg_intr_md);

            frame_size_monitor.apply();
        }

        // get "correct" ipv4 header fields for P4TG UDP checksum
        // if we have VxLAN, we have two ipv4 headers
        if(hdr.inner_ipv4.isValid()) { // we have VxLAN
            eg_md.ipv4_src = hdr.inner_ipv4.src_addr;
            eg_md.ipv4_dst = hdr.inner_ipv4.dst_addr;
        }
        else if(hdr.ipv4.isValid()) { // we dont have VxLAN, just "regular" IP traffic
            eg_md.ipv4_src = hdr.ipv4.src_addr;
            eg_md.ipv4_dst = hdr.ipv4.dst_addr;
        }

    }
}
