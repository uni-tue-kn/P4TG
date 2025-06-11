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

import React, {useEffect, useState} from 'react'
import {Col, OverlayTrigger, Row, Table, Tooltip} from "react-bootstrap";
import {GenerationMode, Statistics, TimeStatistics} from "../common/Interfaces";
import {formatBits} from "./SendReceiveMonitor";

import styled from 'styled-components'
import Visuals from "./Visuals";
import { formatNanoSeconds, formatFrameCount } from '../common/Helper';

const Overline = styled.span`
  text-decoration: overline;
`

const StatView = ({ stats, time_stats, port_mapping, mode, visual, is_summary, rx_port }: { stats: Statistics, time_stats: TimeStatistics, port_mapping: { [name: number]: number }, mode: GenerationMode, visual: boolean, is_summary: boolean, rx_port: number }) => {
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

    const get_frame_types = (type: string): { tx: number, rx: number } => {
        let ret = { "tx": 0, "rx": 0 }

        // if (!["multicast", "broadcast", "unicast", "total", "non-unicast", "vlan", "ipv4", "ipv6", "qinq", "unknown"].includes(type)) {
        //     return ret
        // }

        if (stats.frame_type_data == undefined) {
            return ret
        }

        Object.keys(stats.frame_type_data).forEach((v: string) => {
            if (Object.keys(port_mapping).includes(v)) {
                // @ts-ignore
                if(!(type in stats.frame_type_data[v].tx)) {
                    ret.tx += 0
                }
                else {
                    // @ts-ignore
                    ret.tx += stats.frame_type_data[v].tx[type]
                }

            }

            if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
                // @ts-ignore
                if(!(type in stats.frame_type_data[v].rx)) {
                    ret.rx += 0
                }
                else {
                    // @ts-ignore
                    ret.rx += stats.frame_type_data[v].rx[type]
                }
            }
        })

        return ret
    }

    const get_lost_packets = () => {
        let ret = 0

        Object.keys(stats.packet_loss).forEach(v => {
            if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
                ret += stats.packet_loss[v]
            }
        })

        return ret
    }

    const get_out_of_order_packets = () => {
        let ret = 0

        Object.keys(stats.out_of_order).forEach(v => {
            if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
                ret += stats.out_of_order[v]
            }
        })

        return ret
    }

    const get_frame_stats = (type: string, low: number, high: number) => {
        let ret = 0

        if (stats.frame_size == undefined || port_mapping == undefined) {
            return ret
        }

        Object.keys(stats.frame_size).forEach(v => {
            if ((type == "tx" && Object.keys(port_mapping).includes(v))
                || type == "rx" && Object.values(port_mapping).map(Number).includes(parseInt(v))) {
                // @ts-ignore
                stats.frame_size[v][type].forEach(f => {
                    if (f.low == low && f.high == high) {
                        ret += f.packets
                    }
                })
            }
        })

        return ret
    }


    useEffect(() => {
        let ret_tx = 0
        let ret_rx = 0


        Object.keys(stats.frame_size).forEach(v => {
            if (Object.keys(port_mapping).includes(v)) {
                stats.frame_size[v]["tx"].forEach(f => {
                    ret_tx += f.packets
                })
            }


            if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
                stats.frame_size[v]["rx"].forEach(f => {
                    ret_rx += f.packets
                })
            }
        })

        set_iat_tx(calculateWeightedIATs("tx", stats))
        set_iat_rx(calculateWeightedIATs("rx", stats))
        set_rtt(calculateWeightedRTTs(stats))
        set_total_tx(ret_tx)
        set_total_rx(ret_rx)
        set_lost_packets(get_lost_packets())
        set_out_of_order_packets(get_out_of_order_packets())
    }, [stats])

    const calculateWeightedRTTs = (stats: Statistics) => {
        let all_mean = 0
        let all_std = 0
        let all_current = 0
        let all_min = Infinity
        let all_max = 0
        let all_n = 0

        Object.keys(stats.rtts).forEach(v => {

            // only count ports that are used for traffic gen
            // @ts-ignore
            if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
                all_mean += stats.rtts[v].mean * stats.rtts[v].n
                all_std += stats.rtts[v].jitter * stats.rtts[v].n
                all_min = Math.min(all_min, stats.rtts[v].min)
                all_max = Math.max(all_max, stats.rtts[v].max)
                all_current += stats.rtts[v].current * stats.rtts[v].n
                all_n += stats.rtts[v].n
            }
        })


        if (all_n === 0) {
            return { mean: 0, jitter: 0, min: 0, max: 0, current: 0, n: 0 }
        }

        return {
            mean: all_mean / all_n, jitter: all_std / all_n,
            min: all_min, max: all_max, current: all_current / all_n,
            n: all_n
        }
    }

    const calculateWeightedIATs = (type: string, stats: Statistics) => {
        let all_mean = 0
        let all_std = 0
        let all_n = 0
        let all_mae: number[] = [];


        Object.keys(stats.iats).forEach(v => {
            if ((type === "tx" || type === "rx") && Object.keys(stats.iats[v]).includes(type)) {

                if ((type === "tx" && Object.keys(port_mapping).includes(v)) ||
                    // @ts-ignore
                    (type === "rx" && Object.values(port_mapping).map(Number).includes(parseInt(v)))) {
                    all_mean += stats.iats[v][type].mean * stats.iats[v][type].n
                    all_mae.push(stats.iats[v][type].mae)
                    all_std += stats.iats[v][type].std * stats.iats[v][type].n
                    all_n += stats.iats[v][type].n
                }
            }
        })



        if (all_n === 0) {
            return { mean: 0, std: 0, n: 0, mae: 0 }
        }

        //console.log({mean: all_mean / all_n, std: all_std / all_n, n: all_n})

        let sum_mae = all_mae.reduce((a, b) => a + b, 0)
        let n_mae = Math.max(1, all_mae.filter(a => a > 0).length)

        return { mean: all_mean / all_n, std: all_std / all_n, n: all_n, mae: sum_mae / n_mae }
    }

    const addRates = (object: { [name: string]: number }, keys: string[] | number[]) => {
        let ret = 0

        if (object == undefined) {
            return 0
        }

        keys.forEach(v => {
            if (Object.keys(object).includes(v.toString())) {
                ret += object[v]
            }
        })

        return ret
    }

    const tx_rate_l1 = addRates(stats.tx_rate_l1, Object.keys(port_mapping))
    const tx_rate_l2 = addRates(stats.tx_rate_l2, Object.keys(port_mapping))
    const rx_rate_l1 = addRates(stats.rx_rate_l1, Object.values(port_mapping).map(Number))
    const rx_rate_l2 = addRates(stats.rx_rate_l2, Object.values(port_mapping).map(Number))


    return <>
    { visual ?
        <Visuals data={time_stats} stats={stats} port_mapping={port_mapping} is_summary={is_summary} rx_port={rx_port}/>
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
                            <td>{formatFrameCount(lost_packets)}</td>
                            <td>{lost_packets > 0 ?
                                (lost_packets * 100 / (lost_packets + total_rx)).toFixed(2) + " %" : "0.00 %"}
                            </td>
                            <td>{formatFrameCount(out_of_order_packets)}</td>
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
                        {["Multicast", "Broadcast", "Unicast", "VxLAN", "Non-Unicast", " ", "Total"].map((v, i) => {
                            let key = v.toLowerCase()
                            let data = get_frame_types(key)

                            if(key == "total") {
                                data.tx = ["multicast", "broadcast", "unicast", "vxlan"].reduce((acc, curr) => {
                                    acc += get_frame_types(curr).tx

                                    return acc
                                }, 0)

                                data.rx = ["multicast", "broadcast", "unicast", "vxlan"].reduce((acc, curr) => {
                                    acc += get_frame_types(curr).rx

                                    return acc
                                }, 0)
                            }

                            if(key == "non-unicast") {
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
                                <td>{v != " " ? v : "\u00A0" }</td> {/* Quick hack for empty row */}
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