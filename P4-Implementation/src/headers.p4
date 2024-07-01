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

#if __TARGET_TOFINO__ == 2
typedef bit<32> seq_t; // due to higher data rates we need larger seq number space
#else
typedef bit<32> seq_t;
#endif
const ether_type_t ETHERTYPE_IPV4 = 0x800;
const ether_type_t ETHERTYPE_MONITOR = 0xBB02;
const ether_type_t ETHERTYPE_QinQ = 0x88a8;
const ether_type_t ETHERTYPE_VLANQ = 0x8100;
const ether_type_t ETHERTYPE_MPLS = 0x8847;
const ether_type_t ETHERTYPE_ARP = 0x0806;

const bit<8> IP_PROTOCOL_UDP = 17;
const bit<8> IP_PROTOCOL_P4TG = 110;
const bit<16> UDP_VxLAN_PORT = 4789;
const bit<16> UDP_P4TG_PORT = 50083;

const bit<8> TG_MODE_ANALYZE = 4;



header ethernet_h {
    mac_addr_t dst_addr;
    mac_addr_t src_addr;
    bit<16> ether_type;
}

header arp_t {
    bit<16> hardwareaddr_t;
    bit<16> protoaddr_t;
    bit<8> hardwareaddr_s;
    bit<8> protoaddr_s;
    bit<16> op;
    mac_addr_t src_mac_addr;
    ipv4_addr_t src_ip_addr;
    mac_addr_t dst_mac_addr;
    ipv4_addr_t dst_ip_addr;
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

header ipv4_udp_lookahead_t {
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
    bit<16> src_port;
    bit<16> dst_port;
    bit<16> len;
    bit<16> checksum;
}

header vxlan_header_t {
    bit<8> vxlan_flags;
    bit<24> vxlan_reserved;
    bit<24> vxlan_vni;
    bit<8> vxlan_reserved2;
}

struct header_t {
    ethernet_h ethernet;
    ethernet_h inner_ethernet;
    mpls_h[15] mpls_stack;
    ipv4_t ipv4;
    ipv4_t inner_ipv4;
    pktgen_timer_header_t pkt_gen;
    udp_t udp;
    monitor_t monitor;
    path_monitor_t path;
    vlan_t vlan;
    q_in_q_t q_in_q;
    vxlan_header_t vxlan;
    arp_t arp;
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
    bit<1> vxlan;
    bit<1> arp_reply;
    bit<8> tg_mode;
}

struct egress_metadata_t {
    bit<1> monitor_type;
    PortId_t rx_port;
    bit<16> checksum_udp_tmp;
    bit<32> checksum_add_udp_ip_src;
    bit<32> checksum_add_udp_ip_dst;
    ipv4_addr_t ipv4_src;
    ipv4_addr_t ipv4_dst;
}

struct iat_rtt_monitor_t {
    bit<32> iat;
    bit<32> rtt;
    PortId_t port;
}


#endif /* _HEADERS_ */
