import { Tabs, Tab } from "react-bootstrap";
import { Encapsulation, Statistics, Stream, StreamSettings, TimeStatistics } from "../common/Interfaces";
import StatView from "./StatView";
import StreamView from "./StreamView";


const SummaryView = ({ statistics, time_statistics, port_tx_rx_mapping, stream_settings, streams, visual, mode }: { statistics: Statistics, time_statistics: TimeStatistics, port_tx_rx_mapping: { [name: number]: number }, stream_settings: StreamSettings[], streams: Stream[], visual: boolean, mode: number }) => {

    const activePorts = (port_tx_rx_mapping: { [name: number]: number }): { "tx": number, "rx": number }[] => {
        let active_ports: { tx: number, rx: number }[] = []
        let exists: number[] = []

        Object.keys(port_tx_rx_mapping).forEach((tx_port: string) => {
            let port = parseInt(tx_port)
            exists.push(port)
            active_ports.push({ tx: port, rx: port_tx_rx_mapping[port] })
        })

        return active_ports
    }

    const getStreamIDsByPort = (pid: number): number[] => {
        let ret: number[] = []

        stream_settings.forEach(v => {
            if (v.port === pid && v.active) {
                streams.forEach(s => {
                    if (s.stream_id === v.stream_id) {
                        ret.push(s.app_id)
                        return
                    }
                })
            }
        })

        return ret
    }

    const getStreamFrameSize = (stream_id: number): number => {
        let ret = 0

        streams.forEach(v => {
            if (v.app_id === stream_id) {
                ret = v.frame_size
                if (v.encapsulation === Encapsulation.Q) {
                    ret += 4
                } else if (v.encapsulation === Encapsulation.QinQ) {
                    ret += 8
                }
                else if (v.encapsulation === Encapsulation.MPLS) {
                    ret += v.number_of_lse * 4 // 4 bytes per LSE
                }

                if (v.vxlan) {
                    ret += 50 // 50 bytes overhead
                }

                return
            }
        })

        return ret
    }


    return <>
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
            {activePorts(port_tx_rx_mapping).map((v, i) => {
                const mapping: { [name: number]: number } = { [v.tx]: v.rx };
                return (
                    <Tab eventKey={i.toString()} key={i} title={`${v.tx} → ${v.rx}`}>
                        <Tabs defaultActiveKey={"Overview"} className={"mt-3"}>
                            <Tab eventKey={"Overview"} title={"Overview"}>
                                <StatView
                                    stats={statistics}
                                    time_stats={time_statistics}
                                    port_mapping={mapping}
                                    mode={mode}
                                    visual={visual}
                                    is_summary={false}
                                    rx_port={v.rx}
                                />
                            </Tab>
                            {Object.keys(mapping)
                                .map(Number)
                                .map((portNum) => {
                                    const stream_ids = getStreamIDsByPort(portNum);
                                    return stream_ids.map((stream: number, i) => {
                                        const stream_frame_size = getStreamFrameSize(stream);
                                        return (
                                            <Tab key={i} eventKey={stream.toString()} title={"Stream " + stream}>
                                                <StreamView
                                                    stats={statistics}
                                                    port_mapping={mapping}
                                                    stream_id={stream}
                                                    frame_size={stream_frame_size}
                                                />
                                            </Tab>
                                        );
                                    });
                                })}
                        </Tabs>
                    </Tab>
                );
            })}
        </Tabs>
    </>
}

export default SummaryView