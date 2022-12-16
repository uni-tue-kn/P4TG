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
 
/*
Replaces IP src / dst addresses based on random 32 bit number
*/
control Header_Replace(
    inout header_t hdr,
    in egress_intrinsic_metadata_t eg_intr_md) {

    // IP replace
    Random<bit<32>>() src_rand;
    Random<bit<32>>() dst_rand;

    bit<32> src_mask = 0;
    bit<32> dst_mask = 0;


    action rewrite(mac_addr_t src_mac, mac_addr_t dst_mac, bit<32> s_ip, bit<32> d_ip, bit<32> s_mask, bit<32> d_mask, bit<8> tos) {
            src_mask = s_mask;
            dst_mask = d_mask;
            hdr.ethernet.dst_addr = dst_mac;
            hdr.ethernet.src_addr = src_mac;

            hdr.ipv4.dst_addr = d_ip;
            hdr.ipv4.src_addr = s_ip;
            hdr.ipv4.diffserv = tos;

    }

    table header_replace {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.path.app_id: exact;
        }
        actions = {
            rewrite;
        }
        size = 64;
    }

    apply {
        // we only rewrite IP header for P4TG packets
        // identified by valid path header and UDP port
        if(hdr.path.isValid() && hdr.path.dst_port == 50083) {
            if(header_replace.apply().hit) {
                // get random 32 bit number and make bitwise AND with network mask
                bit<32> s_tmp = src_rand.get() & src_mask;
                bit<32> d_tmp = dst_rand.get() & dst_mask;

                // apply random sub ip string to ip address
                hdr.ipv4.src_addr = hdr.ipv4.src_addr | s_tmp;
                hdr.ipv4.dst_addr = hdr.ipv4.dst_addr | d_tmp;
            }
        }
    }
}
