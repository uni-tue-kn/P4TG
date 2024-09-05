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

export const fec_mapping: { [name: string]: string } = {
    "BF_FEC_TYP_NONE": "None",
    "BF_FEC_TYP_FC": "Firecode",
    "BF_FEC_TYP_REED_SOLOMON": "Reed Solomon"
}
export const auto_neg_mapping: { [name: string]: string } = {
    "PM_AN_DEFAULT": "Auto",
    "PM_AN_FORCE_DISABLE": "Off",
    "PM_AN_FORCE_ENABLE": "On"
}

export const speed_mapping: { [name: string]: string } = {
    "BF_SPEED_10G": "10G",
    "BF_SPEED_25G": "25G",
    "BF_SPEED_40G": "40G",
    "BF_SPEED_100G": "100G",
    "BF_SPEED_400G": "400G"
}

export const loopback_mapping: { [name: string]: string } = {
    "BF_LPBK_NONE": "Off",
    "BF_LPBK_MAC_NEAR": "On"
}