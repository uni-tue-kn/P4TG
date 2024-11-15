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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import {DefaultStream, DefaultStreamSettings, MPLSHeader, Stream, StreamSettings} from "./Interfaces";

export const validateMAC = (mac: string) => {
    let regex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

    return regex.test(mac)
}

export const validateIP = (ip: string) => {
    let regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/gm;

    return regex.test(ip)
}

export const validateIPv6 = (ip: string) => {
    let regex =  /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/gm;

    return regex.test(ip)
}

export const validateIPv6RandomMask = (ip: string) => {
    // TODO
    //let regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/gm;

    //return regex.test(ip)
    return true
}

export const validateTrafficClass= (traffic_class: number) => {
    return !isNaN(traffic_class) && (0 <= traffic_class) && traffic_class <= (2 ** 8 - 1)
}

export const validateFlowLabel= (flow_label: number) => {
    return !isNaN(flow_label) && (0 <= flow_label) && flow_label <= (2 ** 20 - 1)
}

export const validateMPLS = (mpls_stack: MPLSHeader[]) => {
    let result = true;
    mpls_stack.forEach((lse: MPLSHeader) => {
        result = result && lse.label >= 0 && lse.label < 1048575 && lse.tc >= 0 && lse.tc < 8 && lse.ttl >= 0 && lse.ttl < 256;
    });
    return result;
}

export const validateSIDList = (sid_list: string[]) => {
    let result = true;
    sid_list.forEach((sid: string) => {
        result = result && validateIPv6(sid);
    });
    return result;
}

export const validateToS = (tos: number) => {
    return !isNaN(tos) && (0 <= tos) && tos <= (2 ** 7 - 1)
}

export const validateUdpPort = (port: number) => {
    return !isNaN(port) && (0 <= port) && port <= (2 ** 16 - 1)
}

export const validateVNI = (vni: number) => {
    return !isNaN(vni) && (0 <= vni) && vni <= (2 ** 24 - 1)
}

export const validateStreams = (s: Stream[]) => {
    const defaultStream = DefaultStream(1)
    if (!s) {
        return false
    }
    return s.every(s => Object.keys(defaultStream).every(key => Object.keys(s).includes(key)))
}

export const validateStreamSettings = (s: StreamSettings[]) => {
    const defaultStreamSetting = DefaultStreamSettings(1, 5)

    if (!s) {
        return false
    }

    return s.every(s => Object.keys(defaultStreamSetting).every(key => {
        return Object.keys(s).includes(key) && s.mpls_stack != undefined && Object.keys(defaultStreamSetting.vlan).every(key => {
            return Object.keys(s.vlan).includes(key)
        }) && Object.keys(defaultStreamSetting.ethernet).every(key => { // ethernet
            return Object.keys(s.ethernet).includes(key)
        }) && Object.keys(defaultStreamSetting.ip).every(key => { // ip
            return Object.keys(s.ip).includes(key)
        }) && Object.keys(defaultStreamSetting.vxlan).every(key => {
            return Object.keys(s.vxlan).includes(key) // VxLAN
        })
    }))
}