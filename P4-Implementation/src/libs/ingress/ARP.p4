/* Copyright 2024-present University of Tuebingen, Chair of Communication Networks
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

// Handles ARP requests
control ARP(inout header_t hdr, inout ingress_metadata_t ig_md, in ingress_intrinsic_metadata_t ig_intr_md,
    inout ingress_intrinsic_metadata_for_tm_t ig_tm_md) {

    action answer_arp(PortId_t e_port, bit<1> valid) {
            hdr.arp.op = 2; // create arp response
            ipv4_addr_t tmp = hdr.arp.dst_ip_addr;
            hdr.arp.dst_ip_addr = hdr.arp.src_ip_addr;
            hdr.arp.src_ip_addr = tmp;
            ig_tm_md.ucast_egress_port = e_port;
            hdr.ethernet.dst_addr = hdr.ethernet.src_addr;
            ig_md.arp_reply = valid;
    }

    table arp_reply {
        key = {
            ig_intr_md.ingress_port: exact;
        }
        actions = {
            answer_arp;
        }
        size = 64;
    }

    apply {
        if(hdr.arp.isValid() && hdr.arp.op == 1) { // it's an arp request
            if(arp_reply.apply().hit) {
                if(ig_md.arp_reply == 0) {
                    invalidate(ig_tm_md.ucast_egress_port);
                }
            }
        }
    }
}