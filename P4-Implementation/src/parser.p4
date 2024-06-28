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
parser TofinoIngressParser(
        packet_in pkt,
        out ingress_intrinsic_metadata_t ig_intr_md) {

    state start {
        pkt.extract(ig_intr_md);
        #if __TARGET_TOFINO__ == 2
                pkt.advance(192);
        #else
                pkt.advance(64);
        #endif
        transition accept;
    }
}

parser TofinoEgressParser(
        packet_in pkt,
        out egress_intrinsic_metadata_t eg_intr_md) {

    state start {
        pkt.extract(eg_intr_md);
        transition accept;
    }
}


// ---------------------------------------------------------------------------
// Ingress parser
// ---------------------------------------------------------------------------
parser SwitchIngressParser(
        packet_in pkt,
        out header_t hdr,
        out ingress_metadata_t ig_md,
        out ingress_intrinsic_metadata_t ig_intr_md) {

    TofinoIngressParser() tofino_parser;

    state start {
        ig_md.iat = 0;
        ig_md.rtt = 0;
        ig_md.vxlan = 0;
        ig_md.tg_mode = 0;
        tofino_parser.apply(pkt, ig_intr_md);

        transition select(ig_intr_md.ingress_port) {
            #if __TARGET_TOFINO__ == 2
            6: parse_pkt_gen;
            134: parse_pkt_gen;
            262: parse_pkt_gen;
            390: parse_pkt_gen;
            #else
            68: parse_pkt_gen;
            196: parse_pkt_gen;
            #endif
            default: parse_ethernet;
        }
    }

    state parse_pkt_gen {
        pkt.extract(hdr.pkt_gen);
        transition parse_ethernet_2;
    }

    state parse_ethernet_2 {
        pkt.extract(hdr.ethernet);
        transition select(hdr.ethernet.ether_type) {
            ETHERTYPE_MONITOR: parse_monitor;
            default: accept;
        }
    }

    state parse_ethernet {
        pkt.extract(hdr.ethernet);
        transition select(hdr.ethernet.ether_type) {
            ETHERTYPE_MONITOR: parse_monitor;
            ETHERTYPE_ARP: parse_arp;
            ETHERTYPE_VLANQ: parse_vlan;
            ETHERTYPE_QinQ: parse_q_in_q;
            ETHERTYPE_IPV4: parse_ipv4;
            ETHERTYPE_MPLS: parse_mpls;
            default: accept;
        }
    }

    state parse_arp {
        pkt.extract(hdr.arp);
        transition accept;
    }

    state parse_vlan {
        pkt.extract(hdr.vlan);
        transition select (hdr.vlan.ether_type) {
            ETHERTYPE_IPV4: parse_path;
            default: accept;
        }
    }

    state parse_q_in_q{
        pkt.extract(hdr.q_in_q);
        transition parse_path;
    }

    state parse_ipv4 {
        ipv4_udp_lookahead_t ip_udp = pkt.lookahead<ipv4_udp_lookahead_t>();

        // check if we have a VxLAN packet
        transition select(ip_udp.protocol, ip_udp.dst_port) {
            (IP_PROTOCOL_UDP, UDP_P4TG_PORT): parse_path;
            (IP_PROTOCOL_UDP, UDP_VxLAN_PORT): parse_vxlan;
            default: parse_only_ipv4;
        }
    }

    state parse_only_ipv4 {
        pkt.extract(hdr.inner_ipv4);
        transition accept;
    }

    state parse_vxlan {
        pkt.extract(hdr.ipv4);
        pkt.extract(hdr.udp);
        pkt.extract(hdr.vxlan);
        ig_md.vxlan = 1;
        transition parse_inner_ethernet;
    }

    state parse_inner_ethernet {
        pkt.extract(hdr.inner_ethernet);
        transition select(hdr.inner_ethernet.ether_type) {
                ETHERTYPE_VLANQ: parse_vlan;
                ETHERTYPE_QinQ: parse_q_in_q;
                ETHERTYPE_IPV4: parse_path;
                ETHERTYPE_MPLS: parse_mpls;
                default: accept;
        }
    }


    state parse_monitor {
        pkt.extract(hdr.monitor);
        transition accept;
    }

    state parse_udp {
        pkt.extract(hdr.udp);
        transition select(hdr.udp.dst_port) {
            50083: parse_path;
            default: accept;
        }
    }

    state parse_path {
        pkt.extract(hdr.inner_ipv4);
        pkt.extract(hdr.path);
        transition accept;
    }

    state parse_mpls {
        pkt.extract(hdr.mpls_stack.next);
        transition select (hdr.mpls_stack.last.bos){
            0x0: parse_mpls;
            0x1: parse_path;
        }
    }

}

// ---------------------------------------------------------------------------
// Ingress Deparser
// ---------------------------------------------------------------------------
control SwitchIngressDeparser(
        packet_out pkt,
        inout header_t hdr,
        in ingress_metadata_t ig_md,
        in ingress_intrinsic_metadata_for_deparser_t ig_dprsr_md) {
    Digest<monitor_t>() digest;
    Digest<iat_rtt_monitor_t>() digest_2;

    apply {
        if (ig_dprsr_md.digest_type == 1) {
           digest.pack(hdr.monitor);
       }
       else if (ig_dprsr_md.digest_type == 2) {
          digest_2.pack({ig_md.iat, ig_md.rtt, ig_md.ig_port});
       }

        pkt.emit(hdr.ethernet);
        pkt.emit(hdr.arp);
        pkt.emit(hdr.ipv4);
        pkt.emit(hdr.udp);
        pkt.emit(hdr.vxlan);
        pkt.emit(hdr.inner_ethernet);
        pkt.emit(hdr.mpls_stack);
        pkt.emit(hdr.vlan);
        pkt.emit(hdr.q_in_q);
        pkt.emit(hdr.inner_ipv4);
        pkt.emit(hdr.path);
        pkt.emit(hdr.monitor);
    }

}

// ---------------------------------------------------------------------------
// Egress parser
// ---------------------------------------------------------------------------
parser SwitchEgressParser(
        packet_in pkt,
        out header_t hdr,
        out egress_metadata_t eg_md,
        out egress_intrinsic_metadata_t eg_intr_md) {

    TofinoEgressParser() tofino_parser;

    Checksum() udp_checksum;

    state start {
        tofino_parser.apply(pkt, eg_intr_md);
        pkt.extract(hdr.ethernet);

        transition select(hdr.ethernet.ether_type) {
            ETHERTYPE_MONITOR: parse_monitor;
            ETHERTYPE_VLANQ: parse_vlan;
            ETHERTYPE_QinQ: parse_q_in_q;
            ETHERTYPE_IPV4: parse_ipv4;
            ETHERTYPE_MPLS: parse_mpls;
            default: accept;
        }
    }

     state parse_vlan {
        pkt.extract(hdr.vlan);
        transition parse_path;
    }

    state parse_q_in_q {
        pkt.extract(hdr.q_in_q);
        transition parse_path;
    }

    state parse_mpls {
        pkt.extract(hdr.mpls_stack.next);
        transition select (hdr.mpls_stack.last.bos){
            0x0: parse_mpls;
            0x1: parse_path;
        }
    }

    state parse_ipv4 {
        ipv4_udp_lookahead_t ip_udp = pkt.lookahead<ipv4_udp_lookahead_t>();

        // check if we have a VxLAN packet
        transition select(ip_udp.protocol, ip_udp.dst_port) {
            (IP_PROTOCOL_UDP, UDP_P4TG_PORT): parse_path;
            (IP_PROTOCOL_UDP, UDP_VxLAN_PORT): parse_vxlan;
            default: parse_only_ipv4;
        }
    }

    state parse_only_ipv4 {
        pkt.extract(hdr.inner_ipv4);
        transition accept;
    }

    state parse_vxlan {
        pkt.extract(hdr.ipv4);
        pkt.extract(hdr.udp);
        pkt.extract(hdr.vxlan);
        transition parse_inner_ethernet;
    }

    state parse_inner_ethernet {
        pkt.extract(hdr.inner_ethernet);
        transition select(hdr.inner_ethernet.ether_type) {
               ETHERTYPE_VLANQ: parse_vlan;
               ETHERTYPE_QinQ: parse_q_in_q;
               ETHERTYPE_IPV4: parse_path;
               ETHERTYPE_MPLS: parse_mpls;
               default: accept;
           }
    }

    state parse_monitor {
        pkt.extract(hdr.monitor);
        transition accept;
    }

    state parse_path {
        pkt.extract(hdr.inner_ipv4);

        // subtract old checksum components
        udp_checksum.subtract({hdr.inner_ipv4.src_addr});
        udp_checksum.subtract({hdr.inner_ipv4.dst_addr});

        pkt.extract(hdr.path);

        // subtract old checksum components
        udp_checksum.subtract({hdr.path.checksum});
        udp_checksum.subtract({hdr.path.tx_tstmp});
        udp_checksum.subtract({hdr.path.seq});
        udp_checksum.subtract_all_and_deposit(eg_md.checksum_udp_tmp);

        transition accept;
    }
}

// ---------------------------------------------------------------------------
// Egress Deparser
// ---------------------------------------------------------------------------
control SwitchEgressDeparser(
        packet_out pkt,
        inout header_t hdr,
        in egress_metadata_t eg_md,
        in egress_intrinsic_metadata_for_deparser_t eg_dprsr_md) {

    Checksum() ipv4_checksum;

    Checksum() udp_checksum;

    apply {

        hdr.ipv4.hdr_checksum = ipv4_checksum.update(
            {hdr.ipv4.version,
             hdr.ipv4.ihl,
             hdr.ipv4.diffserv,
             hdr.ipv4.total_len,
             hdr.ipv4.identification,
             hdr.ipv4.flags,
             hdr.ipv4.frag_offset,
             hdr.ipv4.ttl,
             hdr.ipv4.protocol,
             hdr.ipv4.src_addr,
             hdr.ipv4.dst_addr});

        hdr.inner_ipv4.hdr_checksum = ipv4_checksum.update(
                    {hdr.inner_ipv4.version,
                     hdr.inner_ipv4.ihl,
                     hdr.inner_ipv4.diffserv,
                     hdr.inner_ipv4.total_len,
                     hdr.inner_ipv4.identification,
                     hdr.inner_ipv4.flags,
                     hdr.inner_ipv4.frag_offset,
                     hdr.inner_ipv4.ttl,
                     hdr.inner_ipv4.protocol,
                     hdr.inner_ipv4.src_addr,
                     hdr.inner_ipv4.dst_addr});

        // compute new udp checksum
        hdr.path.checksum = udp_checksum.update(data = {
                eg_md.ipv4_src,
                eg_md.ipv4_dst,
                hdr.path.tx_tstmp,
                hdr.path.seq,
                eg_md.checksum_udp_tmp
            }, zeros_as_ones = true);

        pkt.emit(hdr.ethernet);
        pkt.emit(hdr.ipv4);
        pkt.emit(hdr.udp);
        pkt.emit(hdr.vxlan);
        pkt.emit(hdr.inner_ethernet);
        pkt.emit(hdr.mpls_stack);
        pkt.emit(hdr.vlan);
        pkt.emit(hdr.q_in_q);
        pkt.emit(hdr.inner_ipv4);
        pkt.emit(hdr.path);
        pkt.emit(hdr.monitor);

    }
}
