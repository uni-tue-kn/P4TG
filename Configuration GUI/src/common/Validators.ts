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

import {ASIC, DefaultStream, DefaultStreamSettings, MPLSHeader, PortInfo, Stream, StreamSettings} from "./Interfaces";

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

export const validateIPv6RandomMask = (ip: string, asic_version: ASIC) => {
    // Verifies that the randomization mask is below ::ffff:ffff on Tofino 1 and ::ff:ffff:ffff on Tofino 2
    if (validateIPv6(ip)) {
        // Expand address
        const sections = ip.split("::");
        const left = sections[0]?.split(":") ?? [];
        const right = sections[1]?.split(":") ?? [];
        const totalLength = 8; // IPv6 has 8 sections in its full form
        const missing = totalLength - (left.length + right.length);
    
        const expandedLeft = left.map(s => s.padStart(4, "0"));
        const expandedRight = right.map(s => s.padStart(4, "0"));
        const expandedMiddle = Array(missing).fill("0000");
    
        const expandedIP =  [...expandedLeft, ...expandedMiddle, ...expandedRight];

        if (asic_version == ASIC.Tofino1) {
            // All higher bits must be zero
            return expandedIP.slice(0,6).every(ip => parseInt(ip, 16) === 0);            
        } else {
            return expandedIP.slice(0,5).every(ip => parseInt(ip, 16) === 0) && parseInt(expandedIP[5], 16) <= 0xff
        }
    }

    return false
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

    // Ensure backward compatibility with older P4TG versions by inserting the 
    // default values for missing keys into the stream settings
    const missingKeys: string[] = [];
    s.forEach(stream => {
        Object.keys(defaultStream).forEach(key => {
            if (!Object.prototype.hasOwnProperty.call(stream, key)) {
                missingKeys.push(key); // Track the missing key
                // @ts-ignore: Add the key with the default value
                stream[key] = defaultStream[key];
            }
        });
    });

    return s.every(s => Object.keys(defaultStream).every(key => Object.keys(s).includes(key)))
}

export const validatePorts = (port_tx_rx_mapping: { [name: number]: number}[], available_ports: PortInfo[]) => {
    // Verify if all configured ports are acutally available on this device.

    const available_dev_ports: number[] = available_ports.slice(0, 10).map(p => p.pid);
    //@ts-ignore
    const configured_ports: number[] = Object.entries(port_tx_rx_mapping).flatMap(([key, value]) => [Number(key), value]);

    return configured_ports.some(r=> available_dev_ports.includes(r))
}

export const validateStreamSettings = (setting: StreamSettings[]) => {
    const defaultStreamSetting = DefaultStreamSettings(1, 5)

    if (!setting) {
        return false
    }

    setting.forEach((streamSetting, _) => {
        // Verify and add missing fields in the main stream settings object
        Object.keys(defaultStreamSetting).forEach(key => {
            // @ts-ignore
            if (!Object.prototype.hasOwnProperty.call(streamSetting, key) || streamSetting[key] === null) {
                // @ts-ignore: Add missing key with default value
                streamSetting[key] = defaultStreamSetting[key];
            }
        });

        // Validate and add missing keys in specific nested properties (e.g., vlan, ethernet, ip, vxlan)
        Object.keys(defaultStreamSetting).every(key => {
            // @ts-ignore
            if (!streamSetting[key]) {
                // If the nested key is completely missing, add it
                // @ts-ignore: Add the entire nested key with defaults
                streamSetting[key] = defaultStreamSetting[key];
            } else {
                // If the nested key exists, validate and add individual missing keys
                // @ts-ignore
                Object.keys(defaultStreamSetting[key]).forEach(settingKey => {
                    // @ts-ignore
                    if (!Object.prototype.hasOwnkey.call(streamSetting[key], settingKey)) {
                        // @ts-ignore: Add the missing key with its default value
                        streamSetting[key][settingKey] = defaultStreamSetting[key][settingKey];
                    }
                });
            }
        });
    });
    return true;
}