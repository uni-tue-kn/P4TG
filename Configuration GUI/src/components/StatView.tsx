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
 */

import React, { useEffect, useState } from 'react'
import { Col, OverlayTrigger, Row, Table, Tooltip } from "react-bootstrap";
import { GenerationMode, PortTxRxMap, StatisticsEntry, TimeStatisticsEntry } from "../common/Interfaces";
import { formatBits } from "./SendReceiveMonitor";

import styled from 'styled-components'
import Visuals from "./Visuals";
import { formatNanoSeconds, formatFrameCount } from '../common/Helper';

const Overline = styled.span`
  text-decoration: overline;
`

const StatView = ({ stats, time_stats, port_mapping, mode, visual, is_summary, rx_port }: { stats: StatisticsEntry, time_stats: TimeStatisticsEntry, port_mapping: PortTxRxMap, mode: GenerationMode, visual: boolean, is_summary: boolean, rx_port: number }) => {
    const [total_tx, set_total_tx] = useState(0);
    const [total_rx, set_total_rx] = useState(0);
    const [iat_tx, set_iat_tx] = useState({ "mean": 0, "std": 0, "n": 0, "mae": 0 });
    const [iat_rx, set_iat_rx] = useState({ "mean": 0, "std": 0, "n": 0, "mae": 0 });
    const [rtt, set_rtt] = useState({ "mean": 0, "max": 0, "min": 0, "jitter": 0, "n": 0, "current": 0 })
    const [lost_packets, set_lost_packets] = useState(0);
    const [out_of_order_packets, set_out_of_order_packets] = useState(0);

    const renderTooltip = (props: any, message: string) => (
        <Tooltip id="tooltip-disabled" {...props}>
            {message}
        </Tooltip>
    );

    const get_frame_types = (type: string): { tx: number; rx: number } => {
        const ret = { tx: 0, rx: 0 };
        const ftd = stats.frame_type_data ?? {};

        for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
            for (const [txCh, target] of Object.entries(perCh ?? {})) {
                // TX: sum for (txPort, txCh)
                const txVal = (ftd[txPort]?.[txCh]?.tx as any)?.[type];
                if (typeof txVal === "number") ret.tx += txVal;

                // RX: sum for mapped (rxPort, rxCh)
                const rxPort = String((target as any).port);
                const rxCh = String((target as any).channel);
                const rxVal = (ftd[rxPort]?.[rxCh]?.rx as any)?.[type];
                if (typeof rxVal === "number") ret.rx += rxVal;
            }
        }

        return ret;
    };


    const get_lost_packets = () => {
        let ret = 0;
        for (const perCh of Object.values(port_mapping ?? {})) {
            for (const t of Object.values(perCh ?? {})) {
                const rp = String((t as any).port), rc = String((t as any).channel);
                ret += stats.packet_loss?.[rp]?.[rc] ?? 0;
            }
        }
        return ret;
    };

    const get_out_of_order_packets = () => {
        let ret = 0;
        for (const perCh of Object.values(port_mapping ?? {})) {
            for (const t of Object.values(perCh ?? {})) {
                const rp = String((t as any).port), rc = String((t as any).channel);
                ret += stats.out_of_order?.[rp]?.[rc] ?? 0;
            }
        }
        return ret;
    };


    const get_frame_stats = (type: "tx" | "rx", low: number, high: number) => {
        let ret = 0;
        const fs = stats.frame_size ?? {};

        if (!port_mapping) return 0;

        if (type === "tx") {
            // Sum bins for all mapped TX (port, channel)
            for (const [txPort, perCh] of Object.entries(port_mapping)) {
                for (const txCh of Object.keys(perCh ?? {})) {
                    const bins = fs?.[txPort]?.[txCh]?.tx ?? [];
                    for (const f of bins) {
                        if (f?.low === low && f?.high === high) ret += f?.packets ?? 0;
                    }
                }
            }
        } else {
            // Sum bins for all mapped RX (port, channel) targets
            for (const perCh of Object.values(port_mapping)) {
                for (const target of Object.values(perCh ?? {})) {
                    const rxPort = String((target as any).port);
                    const rxCh = String((target as any).channel);
                    const bins = fs?.[rxPort]?.[rxCh]?.rx ?? [];
                    for (const f of bins) {
                        if (f?.low === low && f?.high === high) ret += f?.packets ?? 0;
                    }
                }
            }
        }

        return ret;
    };



    useEffect(() => {
        let ret_tx = 0
        let ret_rx = 0

        for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
            for (const [txCh, target] of Object.entries(perCh ?? {})) {
                // TX side: sum bins for (txPort, txCh)
                const txBins = stats.frame_size?.[txPort]?.[txCh]?.tx ?? [];
                ret_tx += txBins.reduce((s, f) => s + (f?.packets ?? 0), 0);

                // RX side: sum bins for (rxPort, rxCh)
                const rxPort = String((target as any).port);
                const rxCh = String((target as any).channel);
                const rxBins = stats.frame_size?.[rxPort]?.[rxCh]?.rx ?? [];
                ret_rx += rxBins.reduce((s, f) => s + (f?.packets ?? 0), 0);
            }
        }

        set_iat_tx(calculateWeightedIATs("tx", stats))
        set_iat_rx(calculateWeightedIATs("rx", stats))
        set_rtt(calculateWeightedRTTs(stats))
        set_total_tx(ret_tx)
        set_total_rx(ret_rx)
        set_lost_packets(get_lost_packets())
        set_out_of_order_packets(get_out_of_order_packets())
    }, [stats])

    const calculateWeightedRTTs = (stats: StatisticsEntry) => {
        let all_mean = 0
        let all_std = 0
        let all_current = 0
        let all_min = Infinity
        let all_max = 0
        let all_n = 0

        for (const perCh of Object.values(port_mapping ?? {})) {
            for (const target of Object.values(perCh ?? {})) {
                const rxPort = String((target as any).port);
                const rxCh = String((target as any).channel);
                const r = stats.rtts?.[rxPort]?.[rxCh];
                if (!r) continue;

                all_mean += (r.mean ?? 0) * (r.n ?? 0);
                all_std += (r.jitter ?? 0) * (r.n ?? 0);
                all_min = Math.min(all_min, r.min ?? Infinity);
                all_max = Math.max(all_max, r.max ?? -Infinity);
                all_current += (r.current ?? 0) * (r.n ?? 0);
                all_n += (r.n ?? 0);
            }
        }

        if (all_n === 0) {
            return { mean: 0, jitter: 0, min: 0, max: 0, current: 0, n: 0 }
        }

        return {
            mean: all_mean / all_n, jitter: all_std / all_n,
            min: all_min, max: all_max, current: all_current / all_n,
            n: all_n
        }
    }

    const calculateWeightedIATs = (type: string, stats: StatisticsEntry) => {
        let all_mean = 0
        let all_std = 0
        let all_n = 0
        let all_mae: number[] = [];


        if (type === "tx") {
            for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
                for (const [txCh, _target] of Object.entries(perCh ?? {})) {
                    const i = stats.iats?.[txPort]?.[txCh]?.tx;
                    if (!i) continue;

                    all_mean += (i.mean ?? 0) * (i.n ?? 0);
                    all_mae.push(i.mae ?? 0);
                    all_std += (i.std ?? 0) * (i.n ?? 0);
                    all_n += i.n ?? 0;
                }
            }
        } else if (type === "rx") {
            for (const perCh of Object.values(port_mapping ?? {})) {
                for (const target of Object.values(perCh ?? {})) {
                    const rxPort = String((target as any).port);
                    const rxCh = String((target as any).channel);
                    const i = stats.iats?.[rxPort]?.[rxCh]?.rx;
                    if (!i) continue;

                    all_mean += (i.mean ?? 0) * (i.n ?? 0);
                    all_mae.push(i.mae ?? 0);
                    all_std += (i.std ?? 0) * (i.n ?? 0);
                    all_n += i.n ?? 0;
                }
            }
        }


        if (all_n === 0) {
            return { mean: 0, std: 0, n: 0, mae: 0 }
        }

        //console.log({mean: all_mean / all_n, std: all_std / all_n, n: all_n})

        let sum_mae = all_mae.reduce((a, b) => a + b, 0)
        let n_mae = Math.max(1, all_mae.filter(a => a > 0).length)

        return { mean: all_mean / all_n, std: all_std / all_n, n: all_n, mae: sum_mae / n_mae }
    }

    // object: { [port]: { [channel]: number } }
    // pairs:  [ [port, channel], ... ]
    const addRatesByPairs = (
        object: { [port: string]: { [ch: string]: number } } | undefined,
        pairs: Array<[string, string]>
    ) =>
        pairs.reduce((sum, [p, c]) => sum + (object?.[p]?.[c] ?? 0), 0);

    // Build (port,channel) pairs from mapping
    const txPairs: Array<[string, string]> = Object.entries(port_mapping ?? {}).flatMap(
        ([txPort, perCh]) => Object.keys(perCh ?? {}).map((txCh) => [txPort, txCh] as [string, string])
    );

    // RX in summary must be grouped by RX endpoint, not by number of TX mappings.
    const rxPairSet = new Set<string>();
    const rxPairs: Array<[string, string]> = [];
    Object.values(port_mapping ?? {}).forEach((perCh) => {
        Object.values(perCh ?? {}).forEach((t: any) => {
            const p = String(t.port);
            const c = String(t.channel);
            const key = `${p}/${c}`;
            if (!rxPairSet.has(key)) {
                rxPairSet.add(key);
                rxPairs.push([p, c]);
            }
        });
    });

    // Sums
    const tx_rate_l1 = addRatesByPairs(stats.tx_rate_l1, txPairs);
    const tx_rate_l2 = addRatesByPairs(stats.tx_rate_l2, txPairs);
    const rx_rate_l1 = addRatesByPairs(stats.rx_rate_l1, rxPairs);
    const rx_rate_l2 = addRatesByPairs(stats.rx_rate_l2, rxPairs);

    return <>
        {visual ?
            <Visuals data={time_stats} stats={stats} port_mapping={port_mapping} is_summary={is_summary} rx_port={rx_port} />
            :
            null
        }
        <Row className={"mb-3"}>
            <Col className={"col-12 col-md-6 col-sm-12"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th className={"col-3"}>TX L1</th>
                            <th className={"col-3"}>RX L1</th>
                            <th className={"col-3"}>TX L2</th>
                            <th className={"col-3"}>RX L2</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{formatBits(tx_rate_l1)}</td>
                            <td>{formatBits(rx_rate_l1)}</td>
                            <td>{formatBits(tx_rate_l2)}</td>
                            <td>{formatBits(rx_rate_l2)}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
            <Col className={"col-12 col-sm-12 col-md-3"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th className={"col-4"}><Overline>TX IAT</Overline></th>
                            {stats.sample_mode ?
                                <><th className={"col-4"}>&#963;(TX IAT)</th>
                                    <th className={"col-4"}>#TX IAT</th>
                                </>
                                :
                                <th className="col-4">MAE(TX IAT)</th>
                            }

                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{formatNanoSeconds(iat_tx.mean)}</td>

                            {stats.sample_mode ?
                                <>
                                    <td>{formatNanoSeconds(iat_tx.std)}</td>
                                    <td>{iat_tx.n}</td>
                                </>
                                :
                                <td>{formatNanoSeconds(iat_tx.mae)}</td>
                            }

                        </tr>
                    </tbody>
                </Table>
            </Col>
            <Col className={"col-12 col-sm-12 col-md-3"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th className={"col-4"}><Overline>RX IAT</Overline></th>
                            {stats.sample_mode ?
                                <><th className={"col-4"}>&#963;(RX IAT)</th>
                                    <th className={"col-4"}>#RX IAT</th>
                                </>
                                :
                                <th className="col-4">MAE(RX IAT)</th>
                            }
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{formatNanoSeconds(iat_rx.mean)}</td>
                            {stats.sample_mode ?
                                <>
                                    <td>{formatNanoSeconds(iat_rx.std)}</td>
                                    <td>{iat_rx.n}</td>
                                </>
                                :
                                <td>{formatNanoSeconds(iat_rx.mae)}</td>
                            }

                        </tr>
                    </tbody>
                </Table>
            </Col>

        </Row>
        <Row>
            <Col className={"col-12 col-sm-12 col-md-4"}>
                <Table striped bordered hover size="sm" className={`mt-3 mb-3 ${mode == GenerationMode.ANALYZE ? "opacity-50" : ""}`}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Lost Frames</th>
                            <th>Frame Loss Ratio</th>
                            <th>Out of Order</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>
                                <OverlayTrigger
                                    placement="top"
                                    overlay={(props) => renderTooltip(props, `${lost_packets}`)}
                                >
                                    <span>{formatFrameCount(lost_packets)}</span>
                                </OverlayTrigger>
                            </td>
                            <td>{lost_packets > 0 ?
                                (lost_packets * 100 / (lost_packets + total_rx)).toFixed(2) + " %" : "0.00 %"}
                            </td>
                            <td>
                                <OverlayTrigger
                                    placement="top"
                                    overlay={(props) => renderTooltip(props, `${out_of_order_packets}`)}
                                >
                                    <span>{formatFrameCount(out_of_order_packets)}</span>
                                </OverlayTrigger>
                            </td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
            <Col className={"col-12 col-md-8"}>
                <Table striped bordered hover size="sm" className={`mt-3 mb-3 ${mode == GenerationMode.ANALYZE ? "opacity-50" : ""}`}>
                    <thead className={"table-dark"}>
                        <OverlayTrigger placement="top" overlay={(props) => renderTooltip(props, "Sampled values")}>
                            <tr>
                                <th className={"col-2"}>Current RTT</th>
                                <th className={"col-2"}><Overline>RTT</Overline></th>
                                <th className={"col-2"}>Minimum RTT</th>
                                <th className={"col-2"}>Maximum RTT</th>
                                <th className={"col-2"}>Jitter</th>
                                <th className={"col-2"}>#Rtts</th>
                            </tr>
                        </OverlayTrigger>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{formatNanoSeconds(rtt.current)}</td>
                            <td>{formatNanoSeconds(rtt.mean)}</td>
                            <td>{formatNanoSeconds(rtt.min)}</td>
                            <td>{formatNanoSeconds(rtt.max)}</td>
                            <td>{formatNanoSeconds(rtt.jitter)}</td>
                            <td>{rtt.n}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
        </Row>
        <Row>
            <Col className={"col-12 col-md-6"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th className={"col-4"}>Frame Type</th>
                            <th className={"col-4"}>#TX Count</th>
                            <th className={"col-4"}>#RX Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        {["Multicast", "Broadcast", "Unicast", "VxLAN", "GTPU", "Non-Unicast", " ", "Total"].map((v, i) => {
                            let key = v.toLowerCase()
                            let data = get_frame_types(key)

                            if (key == "total") {
                                data.tx = ["multicast", "broadcast", "unicast", "vxlan", "gtpu"].reduce((acc, curr) => {
                                    acc += get_frame_types(curr).tx

                                    return acc
                                }, 0)

                                data.rx = ["multicast", "broadcast", "unicast", "vxlan", "gtpu"].reduce((acc, curr) => {
                                    acc += get_frame_types(curr).rx

                                    return acc
                                }, 0)
                            }

                            if (key == "non-unicast") {
                                data.tx = ["multicast", "broadcast"].reduce((acc, curr) => {
                                    acc += get_frame_types(curr).tx

                                    return acc
                                }, 0)

                                data.rx = ["multicast", "broadcast"].reduce((acc, curr) => {
                                    acc += get_frame_types(curr).rx

                                    return acc
                                }, 0)
                            }
                            return <tr>
                                <td>{v != " " ? v : "\u00A0"}</td> {/* Quick hack for empty row */}
                                <td>{v != " " ? formatFrameCount(data.tx) : null}</td>
                                <td>{v != " " ? formatFrameCount(data.rx) : null}</td>
                            </tr>
                        })
                        }
                    </tbody>
                </Table>
            </Col>
            <Col className={"col-12 col-md-6"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th className={"col-4"}>Ethernet Type</th>
                            <th className={"col-4"}>#TX Count</th>
                            <th className={"col-4"}>#RX Count</th>
                        </tr>
                    </thead>
                    <tbody>
                        {["VLAN", "QinQ", "IPv4", "IPv6", "MPLS", "ARP", "Unknown"].map((v, i) => {
                            let key = v.toLowerCase()
                            let data = get_frame_types(key)

                            return <tr>
                                <td>{v}</td>
                                <td>{formatFrameCount(data.tx)}</td>
                                <td>{formatFrameCount(data.rx)}</td>
                            </tr>
                        })
                        }
                    </tbody>
                </Table>
            </Col>
        </Row>

        <Row>
            <Col className={"col-12 col-md-6"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Frame Size</th>
                            <th>#TX Count</th>
                            <th>%</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[[0, 63], [64, 64], [65, 127], [128, 255], [256, 511], [512, 1023], [1024, 1518], [1519, 21519]].map((v, i) => {
                            let stats = get_frame_stats("tx", v[0], v[1])
                            return <tr key={i}>
                                {v[0] !== v[1] ?
                                    v[1] > 2000 ?
                                        <td className={"col-4"}> &gt; {v[0] - 1}</td>
                                        :
                                        <td className={"col-4"}>{v[0]} - {v[1]}</td>
                                    :
                                    <td className={"col-4"}>{v[0]}</td>
                                }
                                <td>{formatFrameCount(stats)}</td>
                                <td className={"col-4"}>{stats > 0 ? (100 * stats / total_tx).toFixed(2) : 0}%</td>
                            </tr>
                        })
                        }
                        <tr>
                            <td>Total</td>
                            <td>{formatFrameCount(total_tx)}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
            <Col className={"col-12 col-md-6"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Frame Size</th>
                            <th>#RX Count</th>
                            <th>%</th>
                        </tr>
                    </thead>
                    <tbody>
                        {[[0, 63], [64, 64], [65, 127], [128, 255], [256, 511], [512, 1023], [1024, 1518], [1519, 21519]].map((v, i) => {
                            let stats = get_frame_stats("rx", v[0], v[1])
                            return <tr key={i}>
                                {v[0] !== v[1] ?
                                    v[1] > 2000 ?
                                        <td className={"col-4"}> &gt; {v[0] - 1}</td>
                                        :
                                        <td className={"col-4"}>{v[0]} - {v[1]}</td>
                                    :
                                    <td className={"col-4"}>{v[0]}</td>
                                }
                                <td>{formatFrameCount(stats)}</td>
                                <td className={"col-4"}>{stats > 0 ? (100 * stats / total_rx).toFixed(2) : 0}%</td>
                            </tr>
                        })
                        }
                        <tr>
                            <td>Total</td>
                            <td>{formatFrameCount(total_rx)}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
        </Row>
    </>
}

export default StatView
