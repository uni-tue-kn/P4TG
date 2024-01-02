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

control MPLS_Rewrite(
    inout header_t hdr,
    in egress_intrinsic_metadata_t eg_intr_md) {


        action rewrite_mpls_1(bit<20> label1, bit<3> tc1, bit<8> ttl1){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[0].bos = 1;
        }
        action rewrite_mpls_2(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[1].bos = 1;
        }
        action rewrite_mpls_3(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[2].bos = 1;
        }
        action rewrite_mpls_4(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[3].bos = 1;
        }
        action rewrite_mpls_5(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[4].bos = 1;
        }
        action rewrite_mpls_6(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[5].bos = 1;
        }
        action rewrite_mpls_7(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[6].bos = 1;
        }
        action rewrite_mpls_8(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[7].bos = 1;
        }
        action rewrite_mpls_9(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8, bit<20> label9, bit<3> tc9, bit<8> ttl9){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[8].label = label9;
                hdr.mpls_stack[8].ttl = ttl9;
                hdr.mpls_stack[8].tc = tc9;
                hdr.mpls_stack[8].bos = 1;
        }
        action rewrite_mpls_10(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8, bit<20> label9, bit<3> tc9, bit<8> ttl9, bit<20> label10, bit<3> tc10, bit<8> ttl10){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[8].label = label9;
                hdr.mpls_stack[8].ttl = ttl9;
                hdr.mpls_stack[8].tc = tc9;
                hdr.mpls_stack[9].label = label10;
                hdr.mpls_stack[9].ttl = ttl10;
                hdr.mpls_stack[9].tc = tc10;
                hdr.mpls_stack[9].bos = 1;
        }
        action rewrite_mpls_11(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8, bit<20> label9, bit<3> tc9, bit<8> ttl9, bit<20> label10, bit<3> tc10, bit<8> ttl10, bit<20> label11, bit<3> tc11, bit<8> ttl11){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[8].label = label9;
                hdr.mpls_stack[8].ttl = ttl9;
                hdr.mpls_stack[8].tc = tc9;
                hdr.mpls_stack[9].label = label10;
                hdr.mpls_stack[9].ttl = ttl10;
                hdr.mpls_stack[9].tc = tc10;
                hdr.mpls_stack[10].label = label11;
                hdr.mpls_stack[10].ttl = ttl11;
                hdr.mpls_stack[10].tc = tc11;
                hdr.mpls_stack[10].bos = 1;
        }
        action rewrite_mpls_12(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8, bit<20> label9, bit<3> tc9, bit<8> ttl9, bit<20> label10, bit<3> tc10, bit<8> ttl10, bit<20> label11, bit<3> tc11, bit<8> ttl11, bit<20> label12, bit<3> tc12, bit<8> ttl12){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[8].label = label9;
                hdr.mpls_stack[8].ttl = ttl9;
                hdr.mpls_stack[8].tc = tc9;
                hdr.mpls_stack[9].label = label10;
                hdr.mpls_stack[9].ttl = ttl10;
                hdr.mpls_stack[9].tc = tc10;
                hdr.mpls_stack[10].label = label11;
                hdr.mpls_stack[10].ttl = ttl11;
                hdr.mpls_stack[10].tc = tc11;
                hdr.mpls_stack[11].label = label12;
                hdr.mpls_stack[11].ttl = ttl12;
                hdr.mpls_stack[11].tc = tc12;
                hdr.mpls_stack[11].bos = 1;
        }
        action rewrite_mpls_13(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8, bit<20> label9, bit<3> tc9, bit<8> ttl9, bit<20> label10, bit<3> tc10, bit<8> ttl10, bit<20> label11, bit<3> tc11, bit<8> ttl11, bit<20> label12, bit<3> tc12, bit<8> ttl12, bit<20> label13, bit<3> tc13, bit<8> ttl13){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[8].label = label9;
                hdr.mpls_stack[8].ttl = ttl9;
                hdr.mpls_stack[8].tc = tc9;
                hdr.mpls_stack[9].label = label10;
                hdr.mpls_stack[9].ttl = ttl10;
                hdr.mpls_stack[9].tc = tc10;
                hdr.mpls_stack[10].label = label11;
                hdr.mpls_stack[10].ttl = ttl11;
                hdr.mpls_stack[10].tc = tc11;
                hdr.mpls_stack[11].label = label12;
                hdr.mpls_stack[11].ttl = ttl12;
                hdr.mpls_stack[11].tc = tc12;
                hdr.mpls_stack[12].label = label13;
                hdr.mpls_stack[12].ttl = ttl13;
                hdr.mpls_stack[12].tc = tc13;
                hdr.mpls_stack[12].bos = 1;
        }
        action rewrite_mpls_14(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8, bit<20> label9, bit<3> tc9, bit<8> ttl9, bit<20> label10, bit<3> tc10, bit<8> ttl10, bit<20> label11, bit<3> tc11, bit<8> ttl11, bit<20> label12, bit<3> tc12, bit<8> ttl12, bit<20> label13, bit<3> tc13, bit<8> ttl13, bit<20> label14, bit<3> tc14, bit<8> ttl14){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[8].label = label9;
                hdr.mpls_stack[8].ttl = ttl9;
                hdr.mpls_stack[8].tc = tc9;
                hdr.mpls_stack[9].label = label10;
                hdr.mpls_stack[9].ttl = ttl10;
                hdr.mpls_stack[9].tc = tc10;
                hdr.mpls_stack[10].label = label11;
                hdr.mpls_stack[10].ttl = ttl11;
                hdr.mpls_stack[10].tc = tc11;
                hdr.mpls_stack[11].label = label12;
                hdr.mpls_stack[11].ttl = ttl12;
                hdr.mpls_stack[11].tc = tc12;
                hdr.mpls_stack[12].label = label13;
                hdr.mpls_stack[12].ttl = ttl13;
                hdr.mpls_stack[12].tc = tc13;
                hdr.mpls_stack[13].label = label14;
                hdr.mpls_stack[13].ttl = ttl14;
                hdr.mpls_stack[13].tc = tc14;
                hdr.mpls_stack[13].bos = 1;
        }
        action rewrite_mpls_15(bit<20> label1, bit<3> tc1, bit<8> ttl1, bit<20> label2, bit<3> tc2, bit<8> ttl2, bit<20> label3, bit<3> tc3, bit<8> ttl3, bit<20> label4, bit<3> tc4, bit<8> ttl4, bit<20> label5, bit<3> tc5, bit<8> ttl5, bit<20> label6, bit<3> tc6, bit<8> ttl6, bit<20> label7, bit<3> tc7, bit<8> ttl7, bit<20> label8, bit<3> tc8, bit<8> ttl8, bit<20> label9, bit<3> tc9, bit<8> ttl9, bit<20> label10, bit<3> tc10, bit<8> ttl10, bit<20> label11, bit<3> tc11, bit<8> ttl11, bit<20> label12, bit<3> tc12, bit<8> ttl12, bit<20> label13, bit<3> tc13, bit<8> ttl13, bit<20> label14, bit<3> tc14, bit<8> ttl14, bit<20> label15, bit<3> tc15, bit<8> ttl15){
                hdr.mpls_stack[0].label = label1;
                hdr.mpls_stack[0].ttl = ttl1;
                hdr.mpls_stack[0].tc = tc1;
                hdr.mpls_stack[1].label = label2;
                hdr.mpls_stack[1].ttl = ttl2;
                hdr.mpls_stack[1].tc = tc2;
                hdr.mpls_stack[2].label = label3;
                hdr.mpls_stack[2].ttl = ttl3;
                hdr.mpls_stack[2].tc = tc3;
                hdr.mpls_stack[3].label = label4;
                hdr.mpls_stack[3].ttl = ttl4;
                hdr.mpls_stack[3].tc = tc4;
                hdr.mpls_stack[4].label = label5;
                hdr.mpls_stack[4].ttl = ttl5;
                hdr.mpls_stack[4].tc = tc5;
                hdr.mpls_stack[5].label = label6;
                hdr.mpls_stack[5].ttl = ttl6;
                hdr.mpls_stack[5].tc = tc6;
                hdr.mpls_stack[6].label = label7;
                hdr.mpls_stack[6].ttl = ttl7;
                hdr.mpls_stack[6].tc = tc7;
                hdr.mpls_stack[7].label = label8;
                hdr.mpls_stack[7].ttl = ttl8;
                hdr.mpls_stack[7].tc = tc8;
                hdr.mpls_stack[8].label = label9;
                hdr.mpls_stack[8].ttl = ttl9;
                hdr.mpls_stack[8].tc = tc9;
                hdr.mpls_stack[9].label = label10;
                hdr.mpls_stack[9].ttl = ttl10;
                hdr.mpls_stack[9].tc = tc10;
                hdr.mpls_stack[10].label = label11;
                hdr.mpls_stack[10].ttl = ttl11;
                hdr.mpls_stack[10].tc = tc11;
                hdr.mpls_stack[11].label = label12;
                hdr.mpls_stack[11].ttl = ttl12;
                hdr.mpls_stack[11].tc = tc12;
                hdr.mpls_stack[12].label = label13;
                hdr.mpls_stack[12].ttl = ttl13;
                hdr.mpls_stack[12].tc = tc13;
                hdr.mpls_stack[13].label = label14;
                hdr.mpls_stack[13].ttl = ttl14;
                hdr.mpls_stack[13].tc = tc14;
                hdr.mpls_stack[14].label = label15;
                hdr.mpls_stack[14].ttl = ttl15;
                hdr.mpls_stack[14].tc = tc15;
                hdr.mpls_stack[14].bos = 1;
        }

        table mpls_header_replace {
            key = {
                eg_intr_md.egress_port: exact;
                hdr.path.app_id: exact;
            }
            actions = {
                rewrite_mpls_1;
                rewrite_mpls_2;
                rewrite_mpls_3;
                rewrite_mpls_4;
                rewrite_mpls_5;
                rewrite_mpls_6;
                rewrite_mpls_7;
                rewrite_mpls_8;
                rewrite_mpls_9;
                rewrite_mpls_10;
                rewrite_mpls_11;
                rewrite_mpls_12;
                rewrite_mpls_13;
                rewrite_mpls_14;
                rewrite_mpls_15;
            }
            size = 64;
        }

        apply {
            mpls_header_replace.apply();
        }
    }