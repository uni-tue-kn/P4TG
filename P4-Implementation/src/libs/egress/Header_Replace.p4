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
 
#include "./mpls_actions.p4"

/*
Replaces IP src / dst addresses based on random 32 bit number
*/
control Header_Replace(
    inout header_t hdr,
    in egress_intrinsic_metadata_t eg_intr_md) {

    // IP replace
    Random<bit<32>>() src_rand;
    Random<bit<32>>() dst_rand;

    MPLS_Rewrite() mpls_rewrite_c;

    bit<32> src_mask = 0;
    bit<32> dst_mask = 0;


    action rewrite(mac_addr_t src_mac, mac_addr_t dst_mac, bit<32> s_ip, bit<32> d_ip, bit<32> s_mask, bit<32> d_mask, bit<8> tos) {
            src_mask = s_mask;
            dst_mask = d_mask;
            hdr.ethernet.dst_addr = dst_mac;
            hdr.ethernet.src_addr = src_mac;

            hdr.inner_ipv4.dst_addr = d_ip;
            hdr.inner_ipv4.src_addr = s_ip;
            hdr.inner_ipv4.diffserv = tos;

    }

    action rewrite_vxlan(mac_addr_t outer_src_mac, mac_addr_t outer_dst_mac, mac_addr_t inner_src_mac,
                        mac_addr_t inner_dst_mac, bit<32> inner_s_ip, bit<32> inner_d_ip, bit<32> s_mask, bit<32> d_mask, bit<8> inner_tos,
                        bit<32> outer_s_ip, bit<32> outer_d_ip, bit<8> outer_tos, bit<16> udp_source, bit<24> vni) {
            src_mask = s_mask;
            dst_mask = d_mask;

            hdr.ethernet.dst_addr = outer_dst_mac;
            hdr.ethernet.src_addr = outer_src_mac;

            hdr.inner_ethernet.dst_addr = inner_dst_mac;
            hdr.inner_ethernet.src_addr = inner_src_mac;

            hdr.inner_ipv4.dst_addr = inner_d_ip;
            hdr.inner_ipv4.src_addr = inner_s_ip;
            hdr.inner_ipv4.diffserv = inner_tos;

            hdr.ipv4.dst_addr = outer_d_ip;
            hdr.ipv4.src_addr = outer_s_ip;
            hdr.ipv4.diffserv = outer_tos;

            hdr.udp.src_port = udp_source;
            hdr.vxlan.vxlan_vni = vni;
    }

    table header_replace {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.path.app_id: exact;
        }
        actions = {
            rewrite;
            rewrite_vxlan;
        }
        size = 64;
    }


    action rewrite_vlan(bit<3> pcp, bit<1> dei, bit<12> vlan_id) {
        hdr.vlan.pcp = pcp;
        hdr.vlan.dei = dei;
        hdr.vlan.vid = vlan_id;
    }

    action rewrite_q_in_q(bit<3> outer_pcp, bit<1> outer_dei, bit<12> outer_vlan_id, bit<3> inner_pcp, bit<1> inner_dei, bit<12> inner_vlan_id) {
        hdr.q_in_q.outer_pcp = outer_pcp;
        hdr.q_in_q.outer_dei = outer_dei;
        hdr.q_in_q.outer_vid = outer_vlan_id;
        hdr.q_in_q.inner_pcp = inner_pcp;
        hdr.q_in_q.inner_dei = inner_dei;
        hdr.q_in_q.inner_vid = inner_vlan_id;
    }

    table vlan_header_replace {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.path.app_id: exact;
        }
        actions = {
            rewrite_vlan;
            rewrite_q_in_q;
        }
        size = 64;
    }

    apply {
        bit<32> s_tmp = src_rand.get();
        bit<32> d_tmp = dst_rand.get();

        // we only rewrite IP header for P4TG packets
        // identified by valid path header and UDP port
        if(hdr.path.isValid() && hdr.path.dst_port == 50083) {
            if(header_replace.apply().hit) {
                // get random 32 bit number and make bitwise AND with network mask
                s_tmp = s_tmp & src_mask;
                d_tmp = d_tmp & dst_mask;

                // apply random sub ip string to ip address
                hdr.inner_ipv4.src_addr = hdr.inner_ipv4.src_addr | s_tmp;
                hdr.inner_ipv4.dst_addr = hdr.inner_ipv4.dst_addr | d_tmp;
            }

            vlan_header_replace.apply(); // rewrite vlan header if configured
            mpls_rewrite_c.apply(hdr, eg_intr_md);
        }
    }
}
