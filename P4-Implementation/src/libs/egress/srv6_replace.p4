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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

control SRv6_Replace(
    inout header_t hdr,
    in egress_intrinsic_metadata_t eg_intr_md) {


    action rewrite_1_sids(bit<128> s_ip, bit<128> d_ip, bit<8> traffic_class, bit<20> flow_label, ipv6_addr_t sid1) {
        hdr.sr_ipv6.dst_addr = d_ip;
        hdr.sr_ipv6.src_addr = s_ip;
        hdr.sr_ipv6.traffic_class = traffic_class;
        hdr.sr_ipv6.flowLabel = flow_label;

        hdr.sid1.sid = sid1;
    }

    action rewrite_2_sids(bit<128> s_ip, bit<128> d_ip, bit<8> traffic_class, bit<20> flow_label, ipv6_addr_t sid1, ipv6_addr_t sid2) {
        hdr.sr_ipv6.dst_addr = d_ip;
        hdr.sr_ipv6.src_addr = s_ip;
        hdr.sr_ipv6.traffic_class = traffic_class;
        hdr.sr_ipv6.flowLabel = flow_label;

        hdr.sid1.sid = sid1;
        hdr.sid2.sid = sid2;
    }

    action rewrite_3_sids(bit<128> s_ip, bit<128> d_ip, bit<8> traffic_class, bit<20> flow_label, ipv6_addr_t sid1, ipv6_addr_t sid2, ipv6_addr_t sid3) {
        hdr.sr_ipv6.dst_addr = d_ip;
        hdr.sr_ipv6.src_addr = s_ip;
        hdr.sr_ipv6.traffic_class = traffic_class;
        hdr.sr_ipv6.flowLabel = flow_label;

        hdr.sid1.sid = sid1;
        hdr.sid2.sid = sid2;
        hdr.sid3.sid = sid3;
    }           

    table srv6_replace {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.path.app_id: exact;
        }
        actions = {
            rewrite_1_sids;
            rewrite_2_sids;
            rewrite_3_sids;
        }
        size = 64;
    }

    apply {
        srv6_replace.apply();
    }
}
