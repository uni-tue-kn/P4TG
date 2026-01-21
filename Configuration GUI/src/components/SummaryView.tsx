import { Tabs, Tab } from "react-bootstrap";
import {
    Encapsulation,
    PortTxRxMap,
    RxTarget,
    StatisticsEntry,
    Stream,
    StreamSettings,
    TimeStatisticsEntry,
} from "../common/Interfaces";
import StatView from "./StatView";
import StreamView from "./StreamView";

const SummaryView = ({
    statistics,
    time_statistics,
    port_tx_rx_mapping,
    stream_settings,
    streams,
    visual,
    mode,
}: {
    statistics: StatisticsEntry;
    time_statistics: TimeStatisticsEntry;
    port_tx_rx_mapping: PortTxRxMap;
    stream_settings: StreamSettings[];
    streams: Stream[];
    visual: boolean;
    mode: number;
}) => {
    // Expand TX→channel→RxTarget into a flat list with channel info
    const activePorts = (
        mapping: PortTxRxMap
    ): Array<{ tx: number; tx_ch: number; rx: number; rx_ch: number }> =>
        Object.entries(mapping ?? {}).flatMap(([txPort, perCh]) =>
            Object.entries(perCh ?? {}).map(([txCh, target]) => ({
                tx: Number(txPort),
                tx_ch: Number(txCh),
                rx: (target as RxTarget).port,
                rx_ch: (target as RxTarget).channel,
            }))
        );

    const getStreamIDsByPortAndChannel = (pid: number, ch: number): number[] => {
        const ids = new Set<number>();

        for (const sset of stream_settings) {
            if (sset.port === pid && sset.channel === ch && sset.active) {
                const match = streams.find((s) => s.stream_id === sset.stream_id);
                if (match) ids.add(match.app_id);
            }
        }

        return Array.from(ids);
    };


    const getStreamFrameSize = (stream_id: number): number => {
        let ret = 0;
        streams.forEach((v) => {
            if (v.app_id === stream_id) {
                ret = v.frame_size;
                if (v.encapsulation === Encapsulation.Q) {
                    ret += 4;
                } else if (v.encapsulation === Encapsulation.QinQ) {
                    ret += 8;
                } else if (v.encapsulation === Encapsulation.MPLS) {
                    ret += v.number_of_lse * 4; // 4 bytes per LSE
                }
                if (v.vxlan) {
                    ret += 50; // VXLAN overhead
                }
                if (v.gtpu) {
                    ret += 36; // GTP-U overhead
                }
            }
        });
        return ret;
    };

    return (
        <>
            <Tabs defaultActiveKey="Summary" className="mt-3">
                <Tab eventKey="Summary" title="Summary">
                    <StatView
                        stats={statistics}
                        time_stats={time_statistics}
                        port_mapping={port_tx_rx_mapping}
                        visual={visual}
                        mode={mode}
                        is_summary={true}
                        rx_port={0}
                    />
                </Tab>

                {activePorts(port_tx_rx_mapping).map((v) => {
                    // Build a single-pair nested mapping for this tab
                    const singleMapping: PortTxRxMap = {
                        [String(v.tx)]: {
                            [String(v.tx_ch)]: { port: v.rx, channel: v.rx_ch },
                        },
                    };

                    const tabKey = `${v.tx}/${v.tx_ch}`;
                    const tabTitle = `${v.tx}/${v.tx_ch} → ${v.rx}/${v.rx_ch}`;

                    return (
                        <Tab eventKey={tabKey} key={tabKey} title={tabTitle}>
                            <Tabs defaultActiveKey={"Overview"} className={"mt-3"}>
                                <Tab eventKey={"Overview"} title={"Overview"}>
                                    <StatView
                                        stats={statistics}
                                        time_stats={time_statistics}
                                        port_mapping={singleMapping}
                                        mode={mode}
                                        visual={visual}
                                        is_summary={false}
                                        rx_port={v.rx}
                                    />
                                </Tab>

                                {(() => {
                                    // Use the TX front-panel port to list streams
                                    const portNum = v.tx;
                                    const portChannel = v.tx_ch;
                                    const stream_ids = getStreamIDsByPortAndChannel(portNum, portChannel);
                                    return stream_ids.map((stream) => {
                                        const stream_frame_size = getStreamFrameSize(stream);
                                        const skey = `${tabKey}/stream/${stream}`;
                                        return (
                                            <Tab key={skey} eventKey={String(stream)} title={`Stream ${stream}`}>
                                                <StreamView
                                                    stats={statistics}
                                                    port_mapping={singleMapping}
                                                    stream_id={stream}
                                                    frame_size={stream_frame_size}
                                                />
                                            </Tab>
                                        );
                                    });
                                })()}
                            </Tabs>
                        </Tab>
                    );
                })}
            </Tabs>
        </>
    );
};

export default SummaryView;
