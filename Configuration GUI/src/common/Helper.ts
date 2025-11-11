import { Encapsulation, GenerationUnit, PortInfo, Stream, StreamSettings } from "./Interfaces";

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

const calculateOverhead = (stream: Stream): number => {
    // normalize encapsulation to a lowercase string for robust comparison
    const enc = stream?.encapsulation;
    let encapsulation_overhead = 0;

    if (enc === Encapsulation.None) {
        encapsulation_overhead = 0;
    } else if (enc === Encapsulation.Q) {
        encapsulation_overhead = 4; // VLAN adds 4 bytes
    } else if (enc === Encapsulation.QinQ) {
        encapsulation_overhead = 8; // QinQ adds 8 bytes
    } else if (enc === Encapsulation.MPLS) {
        const lseCount = Number(stream.number_of_lse) || 0;
        encapsulation_overhead = lseCount * 4; // each MPLS label has 4 bytes
    } else if (enc === Encapsulation.SRv6) {
        const sidCount = Number(stream.number_of_srv6_sids) || 0;
        encapsulation_overhead = 40 + 8 + sidCount * 16; // IPv6 base (40) + SRH (8) + each SID (16)
    }

    if (stream.vxlan) {
        encapsulation_overhead += 50;
    }

    return encapsulation_overhead;
}

export const calculateStreamRate = (stream: Stream) => {
    /// Checks if the stream unit is Mpps and then calculates the rate in Gbps
    if (stream.unit === GenerationUnit.Mpps) {
        const encapsulation_overhead = calculateOverhead(stream);
        return (stream.frame_size + encapsulation_overhead) as number * 8 * stream.traffic_rate / 1000;
    } else {
        return stream.traffic_rate;
    }
}

export const getTotalRatePerPort = (streams: Stream[], stream_settings: StreamSettings[], port: PortInfo) => {
    let total_rate = 0;
    stream_settings.forEach((setting: StreamSettings) => {
        if (setting.active && setting.port == port.port && setting.channel == port.channel) {
            let stream = streams.find((s) => s.stream_id === setting.stream_id)
            if (stream !== undefined) {
                total_rate += calculateStreamRate(stream);
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
        if (activeIds.has(s.stream_id)) total_rate += calculateStreamRate(s);;
    }

    return total_rate;
};

export async function isUpdateAvailable(localVersion: String): Promise<boolean> {
    const url = "https://raw.githubusercontent.com/uni-tue-kn/P4TG/refs/heads/main/VERSION.md";

    // Helper to parse x.y.z -> [major, minor, patch]
    const toParts = (v: String): number[] | null => {
        const match = /^\s*v?(\d+)\.(\d+)\.(\d+)\s*$/.exec(v.trim());
        return match ? match.slice(1).map(Number) : null;
    };

    const local = toParts(localVersion);
    if (!local) return false; // malformed local version → treat as "no update"

    let remoteText: string;
    try {
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return false;
        remoteText = await response.text();
    } catch {
        return false; // network / no internet / fetch not available
    }

    const remote = toParts(remoteText.split(/\r?\n/)[0] || "");
    if (!remote) return false; // malformed remote version

    // Compare versions
    for (let i = 0; i < 3; i++) {
        if (local[i] < remote[i]) return true;
        if (local[i] > remote[i]) return false;
    }

    return false; // identical version → no update
}