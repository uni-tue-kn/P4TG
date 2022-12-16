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

const ether_type_t TYPE_ARP = 0x0806;

const bit<8> IP_PROTOCOL_UDP = 17;
const bit<8> IP_PROTOCOL_P4TG = 110;

header ethernet_h {
    mac_addr_t dst_addr;
    mac_addr_t src_addr;
    bit<16> ether_type;
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


struct header_t {
    ethernet_h ethernet;
    ipv4_t ipv4;
    pkg_gen_t pkt_gen;
    udp_t udp;
    monitor_t monitor;
    path_monitor_t path;
    arp_t arp;
}


struct ingress_metadata_t {
    bool checksum_err;
    bit<32> rtt;
    bit<32> lost_packets;
    bit<16> rand_value;
    bit<19> iat_rand_value;
    bit<32> iat;
    bit<32> src_mask;
    bit<32> dst_mask;
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
