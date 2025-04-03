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

#include <core.p4>
#if __TARGET_TOFINO__ == 2
#include <t2na.p4>
#else
#include <tna.p4>
#endif

#include "src/headers.p4"
#include "src/libs/Add_64_64.p4"
#include "src/libs/P4TG_Ingress.p4"
#include "src/ingress.p4"
#include "src/egress.p4"
#include "src/parser.p4"

Pipeline(SwitchIngressParser(),
         ingress(),
         SwitchIngressDeparser(),
         SwitchEgressParser(),
         egress(),
         SwitchEgressDeparser()) pipe;

Switch(pipe) main;
