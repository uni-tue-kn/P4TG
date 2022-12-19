export interface Statistics {
    tx_rate_l1: { [name: string]: number},
    tx_rate_l2: { [name: string]: number},
    rx_rate_l1: { [name: string]: number},
    rx_rate_l2: { [name: string]: number},
    frame_size: { [name: string]: {tx: {low: number, high: number, packets: number}[], rx: {low: number, high: number, packets: number}[]}},
    iats: {
        [name: string]: {tx: {mean: number, std: number, n: number}, rx: {mean: number, std: number, n: number}}
    }
    frame_type_data: {[name: string]: {tx: {multicast: number, broadcast: number, unicast: number, total: number, "non-unicast": number}, rx: {multicast: number, broadcast: number, unicast: number, total: number, "non-unicast": number}}},
    rtts: { [name: string]: {mean: number, current: number, min: number, max: number, jitter: number, n: number}},
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

}

export const StatisticsObject : Statistics = {
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
}

export interface StreamSettings {
    port: number
    stream_id: number,
    eth_src: string,
    eth_dst: string,
    ip_src: string,
    ip_dst: string,
    ip_tos: number,
    ip_src_mask: string,
    ip_dst_mask: string,
    active: boolean
}

export interface Stream {
    stream_id: number,
    frame_size: number,
    traffic_rate: number,
    app_id: number
    burst: number
}

export const DefaultStream = (id: number) => {
    let stream : Stream = {
        stream_id: id,
        app_id: id,
        frame_size: 1024,
        traffic_rate: 1,
        burst: 1
    }

    return stream
}

export const DefaultStreamSettings = (id: number, port: number) => {
    let stream : StreamSettings = {
        port: port,
        stream_id: id,
        eth_src: "3B:D5:42:2A:F6:92",
        eth_dst: "81:E7:9D:E3:AD:47",
        ip_src: "192.168.178.10",
        ip_dst: "192.168.178.11",
        ip_tos: 0,
        ip_src_mask: "0.0.0.0",
        ip_dst_mask: "0.0.0.0",
        active: false
    }

    return stream
}