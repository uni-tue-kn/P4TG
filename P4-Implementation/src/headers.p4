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

#ifndef _HEADERS_
#define _HEADERS_

typedef bit<48> mac_addr_t;
typedef bit<32> ipv4_addr_t;
typedef bit<16> ether_type_t;
typedef bit<32> reg_index_t;
typedef bit<32> seq_t;
const ether_type_t ETHERTYPE_IPV4 = 0x800;
const ether_type_t ETHERTYPE_MONITOR = 0xBB02;
const ether_type_t ETHERTYPE_QinQ = 0x88a8;
const ether_type_t ETHERTYPE_VLANQ = 0x8100;
const ether_type_t ETHERTYPE_MPLS = 0x8847;

const bit<8> IP_PROTOCOL_UDP = 17;
const bit<8> IP_PROTOCOL_P4TG = 110;



header ethernet_h {
    mac_addr_t dst_addr;
    mac_addr_t src_addr;
    bit<16> ether_type;
}

header mpls_h {
    bit<20> label;
    bit<3> tc; // traffic class
    bit<1> bos; // bottom of stack
    bit<8> ttl;
}

header vlan_t {
        bit<3> pcp;
        bit<1> dei;
        bit<12> vid;
        bit<16> ether_type;
}

header q_in_q_t {
    bit<3> outer_pcp;
    bit<1> outer_dei;
    bit<12> outer_vid;
    bit<16> outer_ether_type;
    bit<3> inner_pcp;
    bit<1> inner_dei;
    bit<12> inner_vid;
    bit<16> inner_ether_type;
}

header ipv4_t {
    bit<4> version;
    bit<4> ihl;
    bit<8> diffserv;
    bit<16> total_len;
    bit<16> identification;
    bit<3> flags;
    bit<13> frag_offset;
    bit<8> ttl;
    bit<8> protocol;
    bit<16> hdr_checksum;
    ipv4_addr_t src_addr;
    ipv4_addr_t dst_addr;
}

header path_monitor_t {
    bit<16> src_port;
    bit<16> dst_port;
    bit<16> len;
    bit<16> checksum;
    seq_t seq;
    bit<48> tx_tstmp;
    bit<8> app_id;
}

header pkg_gen_t {
    bit<3> pad;
    bit<2> pipe;
    bit<3> app_id;
    bit<8> pad1;
    bit<16> batch_id;
    bit<16> pkt_id;
}

header monitor_t {
    bit<48> tstmp;
    bit<64> byte_counter_l1;
    bit<64> byte_counter_l2;
    bit<64> packet_loss;
    bit<48> app_counter;
    bit<40> out_of_order;
    bit<9> port;
    bit<15> index;
}

header udp_t {
    bit<16> src_port;
    bit<16> dst_port;
    bit<16> len;
    bit<16> checksum;
}


struct header_t {
    ethernet_h ethernet;
    mpls_h[15] mpls_stack;
    ipv4_t ipv4;
    pkg_gen_t pkt_gen;
    udp_t udp;
    monitor_t monitor;
    path_monitor_t path;
    vlan_t vlan;
    q_in_q_t q_in_q;

}


struct ingress_metadata_t {
    bool checksum_err;
    bit<32> rtt;
    bit<32> lost_packets;
    bit<16> rand_value;
    bit<19> iat_rand_value;
    bit<32> iat;
    bit<32> iat_diff_for_mae;
    bit<1> iat_mae_reset;
    bit<32> src_mask;
    bit<32> dst_mask;
    bit<32> mean_iat_diff;
    PortId_t ig_port;
}

struct egress_metadata_t {
    bit<1> monitor_type;
    PortId_t rx_port;
    bit<16> checksum_udp_tmp;
}

struct iat_rtt_monitor_t {
    bit<32> iat;
    bit<32> rtt;
    PortId_t port;
}


#endif /* _HEADERS_ */
