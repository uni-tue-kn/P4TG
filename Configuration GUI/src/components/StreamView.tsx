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
import { Col, Row, Table } from "react-bootstrap";
import { StatisticsEntry, TimeStatisticsEntry } from "../common/Interfaces";
import { formatBits } from "./SendReceiveMonitor";
import Visuals from "./Visuals";

const StreamView = ({ stats, time_stats, visual, stream_id, frame_size, app_l2_frame_size, tx_port, tx_channel, rx_port, rx_channel, rx_aggregated }: {
    stats: StatisticsEntry,
    time_stats: TimeStatisticsEntry,
    visual: boolean,
    stream_id: number,
    frame_size: number,
    app_l2_frame_size: number,
    tx_port: number,
    tx_channel: number,
    rx_port: number,
    rx_channel: number,
    rx_aggregated: boolean,
}) => {
    const [tx_rate_l2, set_tx_rate_l2] = useState(0);
    const [rx_rate_l2, set_rx_rate_l2] = useState(0);

    useEffect(() => {
        let tx = 0;
        let rx = 0;
        const appKey = String(stream_id);

        tx = stats.app_tx_l2?.[String(tx_port)]?.[String(tx_channel)]?.[appKey] ?? 0;
        rx = stats.app_rx_l2?.[String(rx_port)]?.[String(rx_channel)]?.[appKey] ?? 0;

        set_tx_rate_l2(tx);
        set_rx_rate_l2(rx);
    }, [stats, stream_id, tx_port, tx_channel, rx_port, rx_channel]);

    return <>
        {visual ? <Visuals
            data={time_stats}
            stats={stats}
            port_mapping={{ [String(tx_port)]: { [String(tx_channel)]: { port: rx_port, channel: rx_channel } } }}
            is_summary={false}
            rx_port={rx_port}
            tx_pairs={[[String(tx_port), String(tx_channel)]]}
            rx_pairs={[[String(rx_port), String(rx_channel)]]}
            route_app_ids={[stream_id]}
            app_l2_frame_sizes={{ [stream_id]: app_l2_frame_size }}
            rx_rate_unambiguous={!rx_aggregated}
            rate_only
        /> : null}
        <Row className={"mb-3"}>
            <Col>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <thead className={"table-dark"}>
                        <tr>
                            <th className={"col-2"}>TX L1</th>
                            <th className={"col-2"}>RX L1</th>
                            <th className={"col-2"}>TX L2</th>
                            <th className={"col-2"}>RX L2</th>
                            <th className={"col-2"}>Frame Size</th>
                            <th className={"col-2"}>Loss rate</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>{app_l2_frame_size > 0
                                ? formatBits(tx_rate_l2 * (app_l2_frame_size + 20) / app_l2_frame_size)
                                : "Unavailable"}</td>
                            <td>{!rx_aggregated && app_l2_frame_size > 0
                                ? formatBits(rx_rate_l2 * (app_l2_frame_size + 20) / app_l2_frame_size)
                                : "Unavailable"}</td>
                            <td>{formatBits(tx_rate_l2)}</td>
                            <td>{rx_aggregated ? "Unavailable" : formatBits(rx_rate_l2)}</td>
                            <td>{frame_size} B</td>
                            <td>{rx_aggregated ? "Unavailable (aggregated RX)" : `${tx_rate_l2 > 0 && (1 - rx_rate_l2 / tx_rate_l2) > 0 ? (100 * (1 - rx_rate_l2 / tx_rate_l2)).toFixed(2) : "0.00"}%`}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
        </Row>
    </>
}

export default StreamView
