import { Tabs, Tab } from "react-bootstrap";
import {
    Encapsulation,
    PortTxRxMap,
    RxMappingMode,
    StatisticsEntry,
    Stream,
    StreamSettings,
    TimeStatisticsEntry,
} from "../common/Interfaces";
import StatView from "./StatView";
import StreamView from "./StreamView";
import { expectedRoutes, rxAppIsUnambiguous, sequenceMetricsReliable, uniquePortPairs } from "../common/ExpectedRoutes";

const SummaryView = ({
    statistics,
    time_statistics,
    port_tx_rx_mapping,
    stream_settings,
    streams,
    rx_mapping_mode,
    visual,
    mode,
}: {
    statistics: StatisticsEntry;
    time_statistics: TimeStatisticsEntry;
    port_tx_rx_mapping: PortTxRxMap;
    stream_settings: StreamSettings[];
    streams: Stream[];
    rx_mapping_mode: RxMappingMode;
    visual: boolean;
    mode: number;
}) => {
    const routes = expectedRoutes(rx_mapping_mode, port_tx_rx_mapping, streams, stream_settings);
    const sequenceReliable = sequenceMetricsReliable(routes);
    const activePorts = routes.length > 0
        ? uniquePortPairs(routes).map((route) => ({
            tx: route.txPort,
            tx_ch: route.txChannel,
            rx: route.rxPort,
            rx_ch: route.rxChannel,
        }))
        : Object.entries(port_tx_rx_mapping ?? {}).flatMap(([txPort, perChannel]) =>
            Object.entries(perChannel ?? {}).map(([txChannel, target]) => ({
                tx: Number(txPort),
                tx_ch: Number(txChannel),
                rx: target.port,
                rx_ch: target.channel,
            }))
        );
    const rfc2544Ports = [
        ...(statistics.rfc2544?.selected_mappings ?? []),
        ...(statistics.rfc2544?.throughput ?? []).map((entry) => entry.mapping),
        ...(statistics.rfc2544?.latency ?? []).map((entry) => entry.mapping),
        ...(statistics.rfc2544?.reset ?? []).map((entry) => entry.mapping),
        ...(statistics.rfc2544?.frame_loss ?? []).map((entry) => entry.mapping),
        ...(statistics.rfc2544?.system_recovery ?? []).map((entry) => entry.mapping),
    ].map((mapping) => ({
        tx: mapping.tx_port,
        tx_ch: mapping.tx_channel,
        rx: mapping.rx_port,
        rx_ch: mapping.rx_channel,
    }));
    const mappingTabKeys = new Set<string>();
    const mappingTabs = [...activePorts, ...rfc2544Ports].filter((mapping) => {
        const key = `${mapping.tx}/${mapping.tx_ch}/${mapping.rx}/${mapping.rx_ch}`;
        if (mappingTabKeys.has(key)) {
            return false;
        }
        mappingTabKeys.add(key);
        return true;
    }).sort((left, right) =>
        left.tx - right.tx ||
        left.tx_ch - right.tx_ch ||
        left.rx - right.rx ||
        left.rx_ch - right.rx_ch
    );

    const getStreamIDsForRoute = (tx: number, txCh: number, rx: number, rxCh: number): number[] =>
        Array.from(new Set(routes
            .filter((route) => route.txPort === tx && route.txChannel === txCh
                && route.rxPort === rx && route.rxChannel === rxCh)
            .map((route) => route.appId)));


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
    const appL2FrameSizes = statistics.app_l2_frame_sizes ?? {};
    const histogramAggregateIsAmbiguous = (
        histogram: StatisticsEntry["rtt_histogram"],
        txPort: number,
        txChannel: number,
        rxPort: number,
        rxChannel: number,
        includeTx: boolean,
    ) => routes.some((route) => {
        const groups = histogram?.[String(route.rxPort)]?.[String(route.rxChannel)]?.config.stream_groups;
        const usesLegacyAggregate = !groups
            || (groups.aggregate.length === 0 && groups.separate.length === 0);
        const contributesToAggregate = usesLegacyAggregate || groups.aggregate.includes(route.appId);
        if (!contributesToAggregate) return false;

        const sharesRxPath = route.rxPort === rxPort && route.rxChannel === rxChannel;
        const sharesTxPath = includeTx && route.txPort === txPort && route.txChannel === txChannel;
        if (!sharesRxPath && !sharesTxPath) return false;

        return route.txPort !== txPort
            || route.txChannel !== txChannel
            || route.rxPort !== rxPort
            || route.rxChannel !== rxChannel;
    });

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
                        expected_routes={rx_mapping_mode === RxMappingMode.PerStream ? routes : []}
                        sequence_metrics_reliable={sequenceReliable}
                    />
                </Tab>

                {mappingTabs.map((v) => {
                    // Build a single-pair nested mapping for this tab
                    const singleMapping: PortTxRxMap = {
                        [String(v.tx)]: {
                            [String(v.tx_ch)]: { port: v.rx, channel: v.rx_ch },
                        },
                    };

                    // Include the RX side so two mappings sharing a TX port/channel get distinct keys
                    const tabKey = `${v.tx}/${v.tx_ch}-${v.rx}/${v.rx_ch}`;
                    const tabTitle = `${v.tx}/${v.tx_ch} → ${v.rx}/${v.rx_ch}`;
                    const routeAppIds = getStreamIDsForRoute(v.tx, v.tx_ch, v.rx, v.rx_ch);
                    const routeDefinitions = routes.filter((route) => route.txPort === v.tx
                        && route.txChannel === v.tx_ch
                        && route.rxPort === v.rx
                        && route.rxChannel === v.rx_ch);
                    const rxRateUnambiguous = routeDefinitions.every((route) => rxAppIsUnambiguous(routes, route));
                    const histogramAggregateAmbiguity = {
                        rtt: histogramAggregateIsAmbiguous(
                            statistics.rtt_histogram,
                            v.tx, v.tx_ch, v.rx, v.rx_ch,
                            false,
                        ),
                        iat: histogramAggregateIsAmbiguous(
                            statistics.iat_histogram,
                            v.tx, v.tx_ch, v.rx, v.rx_ch,
                            true,
                        ),
                    };

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
                                        sequence_metrics_reliable={sequenceReliable}
                                        route_app_ids={routeAppIds}
                                        app_l2_frame_sizes={appL2FrameSizes}
                                        rx_rate_unambiguous={rxRateUnambiguous}
                                        histogram_aggregate_ambiguity={histogramAggregateAmbiguity}
                                    />
                                </Tab>

                                {(() => {
                                    const stream_ids = routeAppIds;
                                    return stream_ids.map((stream) => {
                                        const stream_frame_size = getStreamFrameSize(stream);
                                        const skey = `${tabKey}/stream/${stream}`;
                                        return (
                                            <Tab key={skey} eventKey={String(stream)} title={`Stream ${stream}`}>
                                                <StreamView
                                                    stats={statistics}
                                                    time_stats={time_statistics}
                                                    visual={visual}
                                                    stream_id={stream}
                                                    frame_size={stream_frame_size}
                                                    app_l2_frame_size={appL2FrameSizes[stream] ?? 0}
                                                    tx_port={v.tx}
                                                    tx_channel={v.tx_ch}
                                                    rx_port={v.rx}
                                                    rx_channel={v.rx_ch}
                                                    rx_aggregated={!routeDefinitions
                                                        .filter((route) => route.appId === stream)
                                                        .every((route) => rxAppIsUnambiguous(routes, route))}
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
