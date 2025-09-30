import { PortInfo, Stream, StreamSettings } from "./Interfaces";

export const formatNanoSeconds = (ns: number | string, decimals: number = 2) => {
    if (typeof ns == "string") {
        return ns
    }

    if (ns === 0 || ns < 0) return '0 ns';

    const k = 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['ns', 'us', 'ms', 's', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(ns) / Math.log(k));

    let si = sizes[i]

    if (i < 0) {
        si = "ps"
    }

    return parseFloat((ns / Math.pow(k, i)).toFixed(dm)) + ' ' + si;
}

export const formatFrameCount = (packets: number, decimals: number = 2) => {
    if (packets === 0) return '0';

    const k = 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['', 'K', 'M', 'B', 'T'];

    const i = Math.floor(Math.log(packets) / Math.log(k));

    return parseFloat((packets / Math.pow(k, i)).toFixed(dm)).toFixed(dm) + ' ' + sizes[i];
}

export const getTotalRatePerPort = (streams: Stream[], stream_settings: StreamSettings[], port: PortInfo) => {
    let total_rate = 0;
    stream_settings.forEach((setting: StreamSettings) => {
        if (setting.active && setting.port == port.port && setting.channel == port.channel) {
            let stream = streams.find((s) => s.stream_id === setting.stream_id)
            if (stream !== undefined) {
                total_rate += stream?.traffic_rate;
            }
        }
    })
    return total_rate
}

export const getTotalActiveStreamRate = (streams: Stream[], stream_settings: StreamSettings[]) => {
    const activeIds = new Set(
        stream_settings.filter(st => st.active).map(st => st.stream_id)
    );

    let total_rate = 0;
    for (const s of streams) {
        if (activeIds.has(s.stream_id)) total_rate += s.traffic_rate;
    }

    return total_rate;
};