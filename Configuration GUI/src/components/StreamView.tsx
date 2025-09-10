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
import { PortTxRxMap, StatisticsEntry } from "../common/Interfaces";
import { formatBits } from "./SendReceiveMonitor";

const StreamView = ({ stats, port_mapping, stream_id, frame_size }: {
    stats: StatisticsEntry,
    port_mapping: PortTxRxMap,
    stream_id: number,
    frame_size: number
}) => {
    const [tx_rate_l2, set_tx_rate_l2] = useState(0);
    const [rx_rate_l2, set_rx_rate_l2] = useState(0);

    useEffect(() => {
        let tx = 0;
        let rx = 0;
        const appKey = String(stream_id);

        for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
            for (const [txCh, target] of Object.entries(perCh ?? {})) {
                // TX side
                tx += stats.app_tx_l2?.[txPort]?.[txCh]?.[appKey] ?? 0;

                // RX side (mapped target)
                const rxPort = String((target as any).port);
                const rxCh = String((target as any).channel);
                rx += stats.app_rx_l2?.[rxPort]?.[rxCh]?.[appKey] ?? 0;
            }
        }

        set_tx_rate_l2(tx);
        set_rx_rate_l2(rx);
    }, [stats]);

    return <>
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
                            <td>{formatBits(tx_rate_l2 * (frame_size + 20) / frame_size)}</td>
                            <td>{formatBits(rx_rate_l2 * (frame_size + 20) / frame_size)}</td>
                            <td>{formatBits(tx_rate_l2)}</td>
                            <td>{formatBits(rx_rate_l2)}</td>
                            <td>{frame_size} B</td>
                            <td>{tx_rate_l2 > 0 && (1 - rx_rate_l2 / tx_rate_l2) > 0 ? (100 * (1 - rx_rate_l2 / tx_rate_l2)).toFixed(2) : "0.00"}%</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
        </Row>
    </>
}

export default StreamView