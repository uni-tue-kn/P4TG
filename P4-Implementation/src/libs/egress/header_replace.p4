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
 
#include "./mpls_replace.p4"
#if __TARGET_TOFINO__ == 2
    #include "./srv6_replace.p4"
#endif

/*
Replaces IP src / dst addresses based on random 32 bit number
*/
control Header_Replace(
    inout header_t hdr,
    inout egress_metadata_t eg_md,
    in egress_intrinsic_metadata_t eg_intr_md) {

    // IP replace
    Random<bit<32>>() src_rand;
    Random<bit<32>>() dst_rand;
    #if __TARGET_TOFINO__ == 2
    Random<bit<16>>() src_rand_v6_2;
    Random<bit<16>>() dst_rand_v6_2;
    #endif

    MPLS_Replace() mpls_replace_c;
    #if __TARGET_TOFINO__ == 2
        SRv6_Replace() srv6_replace_c;
    #endif

    bit<32> src_mask = 0;
    bit<32> dst_mask = 0;
    bit<48> src_mask_v6 = 0;
    bit<48> dst_mask_v6 = 0;

    action rewrite(mac_addr_t src_mac, mac_addr_t dst_mac, bit<32> s_ip, bit<32> d_ip, bit<32> s_mask, bit<32> d_mask, bit<8> tos) {
            src_mask = s_mask;
            dst_mask = d_mask;
            hdr.ethernet.dst_addr = dst_mac;
            hdr.ethernet.src_addr = src_mac;

            hdr.inner_ipv4.dst_addr = d_ip;
            hdr.inner_ipv4.src_addr = s_ip;
            hdr.inner_ipv4.diffserv = tos;
            eg_md.ip_version = 4;
    }

    action rewrite_ipv6(mac_addr_t src_mac, mac_addr_t dst_mac, bit<128> s_ip, bit<128> d_ip, bit<48> s_mask, bit<48> d_mask, bit<8> traffic_class, bit<20> flow_label) {
            src_mask_v6 = s_mask;
            dst_mask_v6 = d_mask;
            hdr.ethernet.dst_addr = dst_mac;
            hdr.ethernet.src_addr = src_mac;

            hdr.ipv6.dst_addr = d_ip;
            hdr.ipv6.src_addr = s_ip;
            hdr.ipv6.traffic_class = traffic_class;
            hdr.ipv6.flowLabel = flow_label;

            eg_md.ip_version = 6;
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

            eg_md.ip_version = 4;
    }

    table header_replace {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.path.app_id: exact;
        }
        actions = {
            rewrite;
            rewrite_ipv6;
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

        // we only rewrite IP header for P4TG packets
        // identified by valid path header and UDP port
        if(hdr.path.isValid() && hdr.path.dst_port == 50083) {
            if(header_replace.apply().hit) {
                if (eg_md.ip_version == 4){
                    // get random 32 bit number and make bitwise AND with network mask
                    bit<32> s_tmp = src_rand.get();
                    bit<32> d_tmp = dst_rand.get();

                    s_tmp = s_tmp & src_mask;
                    d_tmp = d_tmp & dst_mask;
                    // apply random sub ip string to ip address
                    hdr.inner_ipv4.src_addr = hdr.inner_ipv4.src_addr | s_tmp;
                    hdr.inner_ipv4.dst_addr = hdr.inner_ipv4.dst_addr | d_tmp;
                } else {
                    // least-significant 48 (tofino2) or 32 (tofino1) bits can be randomized for IPv6
                    bit<32> s_tmp_v6_first = src_rand.get();
                    bit<32> d_tmp_v6_first = dst_rand.get();

                    s_tmp_v6_first = s_tmp_v6_first & src_mask_v6[31:0];
                    hdr.ipv6.src_addr[31:0] = hdr.ipv6.src_addr[31:0] | s_tmp_v6_first;

                    d_tmp_v6_first = d_tmp_v6_first & dst_mask_v6[31:0];
                    hdr.ipv6.dst_addr[31:0] = hdr.ipv6.dst_addr[31:0] | d_tmp_v6_first;

                #if __TARGET_TOFINO__ == 2
                    bit<16> d_tmp_v6_second = dst_rand_v6_2.get();
                    bit<16> s_tmp_v6_second = src_rand_v6_2.get();

                    s_tmp_v6_second = s_tmp_v6_second & src_mask_v6[47:32];
                    hdr.ipv6.src_addr[47:32] = hdr.ipv6.src_addr[47:32] | s_tmp_v6_second;

                    d_tmp_v6_second = d_tmp_v6_second & dst_mask_v6[47:32];
                    hdr.ipv6.dst_addr[47:32] = hdr.ipv6.dst_addr[47:32] | d_tmp_v6_second;
                #endif
                }
            }

            vlan_header_replace.apply(); // rewrite vlan header if configured
            mpls_replace_c.apply(hdr, eg_intr_md);
        #if __TARGET_TOFINO__ == 2
            srv6_replace_c.apply(hdr, eg_intr_md);
        #endif                
        }
    }
}