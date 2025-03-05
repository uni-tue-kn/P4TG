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

control BIER_Replace(
    inout header_t hdr,
    in egress_intrinsic_metadata_t eg_intr_md) {

    action rewrite_bier(bierBitmask bs, bit<8> si) {
        hdr.bier.bs = bs;
        hdr.bier.si = si;
    }           

    table bier_header_replace {
        key = {
            eg_intr_md.egress_port: exact;
            hdr.path.app_id: exact;
        }
        actions = {
            rewrite_bier;
        }
        size = 64;
    }

    apply {
        bier_header_replace.apply();
    }
}
