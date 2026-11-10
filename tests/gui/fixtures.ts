import {
    ASIC,
    DefaultStream,
    DefaultStreamSettings,
    FEC,
    GenerationMode,
    P4TGInfos,
    PortInfo,
    RxMappingMode,
    SPEED,
    TrafficGenData,
} from "../../Configuration GUI/src/common/Interfaces";

export const infos = (asic = ASIC.Tofino2): P4TGInfos => ({
    status: "online",
    version: "test",
    asic,
    loopback: false,
    digests_alive: true,
    connected_clients: 1,
});

export const ports: PortInfo[] = [1, 2].map((port, index) => ({
    pid: index,
    port,
    channel: 0,
    loopback: "BF_LPBK_NONE",
    status: true,
    speed: SPEED.BF_SPEED_100G,
    enable: true,
    fec: FEC.BF_FEC_TYP_NONE,
}));

export const config = (overrides: Partial<TrafficGenData> = {}): TrafficGenData => ({
    mode: GenerationMode.CBR,
    rx_mapping_mode: RxMappingMode.PerTxPort,
    duration: 2,
    repetitions: 1,
    drain_duration_secs: 0,
    streams: [DefaultStream(1)],
    stream_settings: [
        { ...DefaultStreamSettings(1, 1, 0), active: true },
        { ...DefaultStreamSettings(1, 2, 0), active: false },
    ],
    port_tx_rx_mapping: { "1": { "0": { port: 2, channel: 0 } } },
    rtt_histogram_config: {},
    iat_histogram_config: {},
    ...overrides,
});
