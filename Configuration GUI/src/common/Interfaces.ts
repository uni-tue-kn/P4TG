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


export interface MPLSHeader {
    label: number,
    tc: number,
    ttl: number
}

export type RttHistogramConfig = {
    min: number;
    max: number;
    num_bins: number;
};

export type RttHistogramBinEntry = {
    count: bigint,
    probability: number,
}

export type RttHistogramData = {
    data_bins: Record<string, RttHistogramBinEntry>;
    percentiles: Record<string, number>;
    mean_rtt: number;
    std_dev_rtt: number;
    missed_bin_count: number;
    total_pkt_count: number;
};

export type RttHistogram = {
    config: RttHistogramConfig;
    data: RttHistogramData;
};

export interface Statistics {
    sample_mode: boolean,
    tx_rate_l1: { [name: string]: number },
    tx_rate_l2: { [name: string]: number },
    rx_rate_l1: { [name: string]: number },
    rx_rate_l2: { [name: string]: number },
    frame_size: { [name: string]: { tx: { low: number, high: number, packets: number }[], rx: { low: number, high: number, packets: number }[] } },
    iats: {
        [name: string]: { tx: { mean: number, std: number, n: number, mae: number }, rx: { mean: number, std: number, n: number, mae: number } }
    }
    frame_type_data: { [name: string]: { tx: { multicast: number, broadcast: number, unicast: number, total: number, "non-unicast": number }, rx: { multicast: number, broadcast: number, unicast: number, total: number, "non-unicast": number } } },
    rtts: { [name: string]: { mean: number, current: number, min: number, max: number, jitter: number, n: number } },
    packet_loss: { [name: string]: number },
    app_tx_l2: {
        [name: string]: {
            [name: string]: number
        }
    },
    app_rx_l2: {
        [name: string]: {
            [name: string]: number
        }
    },
    out_of_order: { [name: string]: number },
    elapsed_time: number,
    rtt_histogram: { [port: string]: RttHistogram },
    previous_statistics?: Record<number, Statistics>,
    name?: string,
}

export const StatisticsObject: Statistics = {
    sample_mode: false,
    frame_size: {},
    frame_type_data: {},
    rx_rate_l1: {},
    rx_rate_l2: {},
    tx_rate_l1: {},
    tx_rate_l2: {},
    iats: {},
    rtts: {},
    packet_loss: {},
    app_tx_l2: {},
    app_rx_l2: {},
    out_of_order: {},
    elapsed_time: 0,
    rtt_histogram: {},
}

export interface TimeStatistics {
    tx_rate_l1: {
        [name: number]: {
            [name: number]: number
        }
    },
    rx_rate_l1: {
        [name: number]: {
            [name: number]: number
        }
    },
    previous_statistics?: Record<number, TimeStatistics>,
    name?: string,
}

export const TimeStatisticsObject: TimeStatistics = {
    tx_rate_l1: {},
    rx_rate_l1: {}
}

export interface StreamSettings {
    mpls_stack: MPLSHeader[],
    port: number,
    stream_id: number,
    vlan: {
        vlan_id: number,
        pcp: number,
        dei: number,
        inner_vlan_id: number,
        inner_pcp: number,
        inner_dei: number,
    }
    ethernet: {
        eth_src: string,
        eth_dst: string,
    },
    ip: IPv4Header
    ipv6: IPv6Header
    srv6_base_header: IPv6Header
    sid_list: string[]
    active: boolean
    vxlan: {
        eth_src: string,
        eth_dst: string,
        ip_src: string,
        ip_dst: string,
        ip_tos: number,
        udp_source: number,
        vni: number
    }
}

export interface IPv4Header {
    ip_src: string,
    ip_dst: string,
    ip_tos: number,
    ip_src_mask: string,
    ip_dst_mask: string,
}

export interface IPv6Header {
    ipv6_src: string,
    ipv6_dst: string,
    ipv6_traffic_class: number,
    ipv6_src_mask: string,
    ipv6_dst_mask: string,
    ipv6_flow_label: number
}

export enum Encapsulation {
    None,
    Q,
    QinQ,
    MPLS,
    SRv6
}

export enum GenerationMode {
    NONE = 0,
    CBR = 1,
    MPPS = 2,
    POISSON = 3,
    ANALYZE = 4,
}
export interface Stream {
    stream_id: number,
    frame_size: number,
    encapsulation: Encapsulation,
    vxlan: boolean,
    ip_version: number,
    number_of_lse: number,
    number_of_srv6_sids: number,
    srv6_ip_tunneling: boolean,
    traffic_rate: number,
    app_id: number,
    burst: number,
    batches: boolean
}

export const DefaultMPLSHeader = () => {
    let lse: MPLSHeader = {
        label: 20,
        tc: 0,
        ttl: 64
    }
    return lse
}

export const DefaultStream = (id: number) => {
    let stream: Stream = {
        stream_id: id,
        app_id: id,
        frame_size: 1024,
        encapsulation: Encapsulation.None,
        number_of_lse: 0,
        number_of_srv6_sids: 0,
        srv6_ip_tunneling: true,
        traffic_rate: 1,
        burst: 1,
        batches: true,
        vxlan: false,
        ip_version: 4
    }

    return stream
}

export const DefaultStreamSettings = (id: number, port: number) => {
    let stream: StreamSettings = {
        port: port,
        stream_id: id,
        vlan: {
            vlan_id: 1,
            pcp: 0,
            dei: 0,
            inner_vlan_id: 1,
            inner_pcp: 0,
            inner_dei: 0
        },
        mpls_stack: [],
        srv6_base_header: {
            ipv6_src: "ff80::",
            ipv6_dst: "ff80::",
            ipv6_traffic_class: 0,
            ipv6_src_mask: "::",
            ipv6_dst_mask: "::",
            ipv6_flow_label: 0
        },
        sid_list: [],
        ethernet: {
            eth_src: "32:D5:42:2A:F6:92",
            eth_dst: "81:E7:9D:E3:AD:47"
        },
        ip: {
            ip_src: "192.168.178.10",
            ip_dst: "192.168.178.11",
            ip_tos: 0,
            ip_src_mask: "0.0.0.0",
            ip_dst_mask: "0.0.0.0"
        },
        ipv6: {
            ipv6_src: "ff80::",
            ipv6_dst: "ff80::",
            ipv6_traffic_class: 0,
            ipv6_src_mask: "::",
            ipv6_dst_mask: "::",
            ipv6_flow_label: 0
        },
        active: false,
        vxlan: {
            eth_src: "32:D5:42:2A:F6:92",
            eth_dst: "81:E7:9D:E3:AD:47",
            ip_src: "192.168.178.10",
            ip_dst: "192.168.178.11",
            ip_tos: 0,
            udp_source: 49152,
            vni: 1
        }
    }

    return stream
}

export interface P4TGConfig {
    tg_ports: {
        port: number,
        mac: string,
        arp_reply: boolean
    }[]
}

export enum SPEED {
    BF_SPEED_1G = "BF_SPEED_1G",
    BF_SPEED_10G = "BF_SPEED_10G",
    BF_SPEED_25G = "BF_SPEED_25G",
    BF_SPEED_40G = "BF_SPEED_40G",
    BF_SPEED_50G = "BF_SPEED_50G",
    BF_SPEED_100G = "BF_SPEED_100G",
    BF_SPEED_400G = "BF_SPEED_400G"
}

export enum FEC {
    BF_FEC_TYP_NONE = "BF_FEC_TYP_NONE",
    BF_FEC_TYP_FC = "BF_FEC_TYP_FC",
    BF_FEC_TYP_REED_SOLOMON = "BF_FEC_TYP_REED_SOLOMON"
}

export enum ASIC {
    Tofino1 = "Tofino1",
    Tofino2 = "Tofino2"
}

export interface P4TGInfos {
    status: String,
    version: String,
    asic: ASIC,
    loopback: boolean
}

export interface TrafficGenData {
    mode: GenerationMode,
    streams: Stream[],
    stream_settings: StreamSettings[],
    port_tx_rx_mapping: { [name: number]: number },
    duration: number,
    histogram_config: { [name: string]: RttHistogramConfig },
    name?: string,
}

export interface PortInfo {
    pid: number,
    port: number,
    channel: number,
    loopback: string,
    status: boolean
}