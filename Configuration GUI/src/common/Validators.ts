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

import { ASIC, DefaultStream, DefaultStreamSettings, MPLSHeader, P4TGInfos, PortInfo, PortTxRxMap, RxMappingMode, RxTarget, Stream, StreamSettings } from "./Interfaces";

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const copyDefault = <T,>(value: T): T => {
    if (Array.isArray(value)) {
        return [...value] as T;
    }
    if (isRecord(value)) {
        return { ...value } as T;
    }
    return value;
};

const matchesDefaultType = (value: unknown, defaultValue: unknown) =>
    defaultValue === null || typeof value === typeof defaultValue;

export const validateMAC = (mac: string) => {
    let regex = /^([0-9A-Fa-f]{2}[:-]){5}([0-9A-Fa-f]{2})$/;

    return regex.test(mac)
}

export const validateIP = (ip: string) => {
    let regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/gm;

    return regex.test(ip)
}

export const validateIPv6 = (ip: string) => {
    let regex = /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/gm;

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

        const expandedIP = [...expandedLeft, ...expandedMiddle, ...expandedRight];

        if (asic_version == ASIC.Tofino1) {
            // All higher bits must be zero
            return expandedIP.slice(0, 6).every(ip => parseInt(ip, 16) === 0);
        } else {
            return expandedIP.slice(0, 5).every(ip => parseInt(ip, 16) === 0) && parseInt(expandedIP[5], 16) <= 0xff
        }
    }

    return false
}

export const validateTrafficClass = (traffic_class: number) => {
    return !isNaN(traffic_class) && (0 <= traffic_class) && traffic_class <= (2 ** 8 - 1)
}

export const validateFlowLabel = (flow_label: number) => {
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

export const validateTEID = (value: number) => {
    return !isNaN(value) && (0 <= value) && value <= 0xffffffff
}

export const validateStreams = (s: Stream[]) => {
    const defaultStream = DefaultStream(1)
    if (!Array.isArray(s) || !s.every(isRecord)) {
        return false
    }

    // Ensure backward compatibility with older P4TG versions by inserting the 
    // default values for missing keys into the stream settings
    s.forEach(stream => {
        const streamRecord = stream as unknown as Record<string, unknown>;
        Object.entries(defaultStream).forEach(([key, defaultValue]) => {
            if (!Object.prototype.hasOwnProperty.call(streamRecord, key)) {
                streamRecord[key] = copyDefault(defaultValue);
            }
        });
    });

    return s.every(stream => {
        const streamRecord = stream as unknown as Record<string, unknown>;
        return Object.entries(defaultStream).every(([key, defaultValue]) =>
            Object.prototype.hasOwnProperty.call(streamRecord, key)
            && matchesDefaultType(streamRecord[key], defaultValue)
        );
    })
}

export const validatePorts = (
    port_tx_rx_mapping: PortTxRxMap,
    available_ports: PortInfo[],
    p4tg_infos: P4TGInfos
) => {
    // Allowed (port/channel) pairs on this device
    const allowed = new Set(
        available_ports
            .filter(p => p.loopback === "BF_LPBK_NONE" || p4tg_infos.loopback)
            .map(p => `${p.port}/${p.channel}`)
    );

    // Configured (port/channel) pairs: all TX and mapped RX targets
    const configured = new Set<string>();
    if (!isRecord(port_tx_rx_mapping)) {
        return false;
    }

    for (const [txPort, perCh] of Object.entries(port_tx_rx_mapping)) {
        if (!isRecord(perCh)) {
            return false;
        }
        for (const [txCh, target] of Object.entries(perCh)) {
            if (!isRecord(target) || typeof target.port !== "number" || typeof target.channel !== "number") {
                return false;
            }
            configured.add(`${txPort}/${txCh}`);
            const t = target as RxTarget;
            configured.add(`${t.port}/${t.channel}`);
        }
    }

    return configured.size === 0 || Array.from(configured).every(k => allowed.has(k));
};

export const validateStreamRxTargets = (
    mode: RxMappingMode,
    settings: StreamSettings[],
    availablePorts: PortInfo[],
    p4tgInfos: P4TGInfos,
) => {
    if (mode !== RxMappingMode.PerStream) return true;
    const allowed = new Set(
        availablePorts
            .filter((port) => port.loopback === "BF_LPBK_NONE" || p4tgInfos.loopback)
            .map((port) => `${port.port}/${port.channel}`),
    );
    return settings
        .filter((setting) => setting.active)
        .every((setting) => setting.rx_target
            && allowed.has(`${setting.rx_target.port}/${setting.rx_target.channel}`));
};


export const validateStreamSettings = (setting: StreamSettings[]) => {
    if (!Array.isArray(setting) || !setting.every(isRecord)) {
        return false
    }

    for (const streamSetting of setting) {
        const settingRecord = streamSetting as unknown as Record<string, unknown>;
        if (settingRecord.rx_target !== undefined) {
            if (!isRecord(settingRecord.rx_target)
                || typeof settingRecord.rx_target.port !== "number"
                || typeof settingRecord.rx_target.channel !== "number") {
                return false;
            }
        }
        const defaultStreamSetting = DefaultStreamSettings(
            typeof streamSetting.stream_id === "number" ? streamSetting.stream_id : 1,
            typeof streamSetting.port === "number" ? streamSetting.port : 5,
            typeof streamSetting.channel === "number" ? streamSetting.channel : 0,
        ) as unknown as Record<string, unknown>;

        for (const [key, defaultValue] of Object.entries(defaultStreamSetting)) {
            const currentValue = settingRecord[key];
            if (!Object.prototype.hasOwnProperty.call(settingRecord, key) || currentValue === null) {
                settingRecord[key] = copyDefault(defaultValue);
                continue;
            }

            if (isRecord(defaultValue)) {
                if (!isRecord(currentValue)) {
                    return false;
                }
                for (const [nestedKey, nestedDefault] of Object.entries(defaultValue)) {
                    const nestedValue = currentValue[nestedKey];
                    if (!Object.prototype.hasOwnProperty.call(currentValue, nestedKey) || nestedValue === null) {
                        currentValue[nestedKey] = copyDefault(nestedDefault);
                    } else if (!matchesDefaultType(nestedValue, nestedDefault)) {
                        return false;
                    }
                }
            } else if (!matchesDefaultType(currentValue, defaultValue)) {
                return false;
            }
        }
    }

    return true;
}
