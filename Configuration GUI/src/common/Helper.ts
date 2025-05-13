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

export const formatPackets = (packets: number | string, decimals: number = 2) => {
    if (typeof packets == "string") {
        return packets
    }

    if (packets === 0 || packets < 0) return '0';

    const k = 1000;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['', 'K', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y'];

    const i = Math.floor(Math.log(packets) / Math.log(k));

    let si = sizes[i]

    if (i < 0) {
        si = ""
    }

    return parseFloat((packets / Math.pow(k, i)).toFixed(dm)) + ' ' + si;
}