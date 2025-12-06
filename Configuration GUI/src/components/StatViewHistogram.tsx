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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import React, { useEffect, useState } from 'react'
import { Col, OverlayTrigger, Row, Table, Tooltip } from "react-bootstrap";
import { Histogram, PortTxRxMap } from "../common/Interfaces";

import styled from 'styled-components'
import { formatNanoSeconds, formatFrameCount } from '../common/Helper';

const Overline = styled.span`
  text-decoration: overline;
`

const StatViewHistogram = ({ stats, port_mapping, rx_port, type, includeTx = true }: { stats: { [port: string]: { [channel: string]: Histogram } }, port_mapping: PortTxRxMap, rx_port: number, type: string, includeTx?: boolean }) => {
    const [minValue, set_min_value] = useState(0);
    const [maxValue, set_max_value] = useState(0);
    const [numBins, set_num_bins] = useState(0);
    const [binWidth, set_bin_width] = useState(0);
    const [mean, set_mean] = useState<{ tx: number; rx: number }>({ tx: 0, rx: 0 });
    const [std, set_std] = useState<{ tx: number; rx: number }>({ tx: 0, rx: 0 });
    const [missedBinCount, set_missed_bin_count] = useState<{ tx: number; rx: number }>({ tx: 0, rx: 0 });
    const [totalPacketCount, set_total_packet_count] = useState<{ tx: number; rx: number }>({ tx: 0, rx: 0 });
    const [percentileData, setPercentileData] = useState<{ tx: Record<string, number>; rx: Record<string, number> }>({ tx: {}, rx: {} });
    const [hasTxData, set_has_tx_data] = useState(false);
    const [hasRxData, set_has_rx_data] = useState(false);
    const [txLabel, set_tx_label] = useState("TX");
    const [rxLabel, set_rx_label] = useState("RX");

    const renderTooltip = (props: any, message: string) => (
        <Tooltip id="tooltip-disabled" {...props}>
            {message}
        </Tooltip>
    );

    useEffect(() => {
        let txPortKey: string | undefined;
        let txChKey: string | undefined;
        let rxChKey: string | undefined;
        const rxPortKey = String(rx_port);

        // find the TX->RX mapping entry for this rx_port
        outer: for (const [port, perCh] of Object.entries(port_mapping ?? {})) {
            for (const [ch, target] of Object.entries(perCh ?? {})) {
                if ((target as any)?.port === rx_port) {
                    txPortKey = String(port);
                    txChKey = String(ch);
                    rxChKey = String((target as any).channel);
                    break outer;
                }
            }
        }

        if (rxChKey == null) return;

        const histTx = includeTx ? stats?.[txPortKey!]?.[txChKey!] : undefined;
        const histRx = stats?.[rxPortKey]?.[rxChKey];

        const config = histRx?.config ?? histTx?.config;
        if (!config) return;

        const txData = includeTx ? histTx?.data?.tx : undefined;
        const rxData = histRx?.data?.rx;

        set_tx_label(txPortKey && txChKey ? `TX ${txPortKey}/${txChKey}` : "TX");
        set_rx_label(`RX ${rxPortKey}/${rxChKey}`);

        set_min_value(config.min);
        set_max_value(config.max);
        set_num_bins(config.num_bins);
        set_bin_width(calculateBinWidth(config.min, config.max, config.num_bins));

        set_has_tx_data(includeTx && !!txData);
        set_has_rx_data(!!rxData);

        set_mean({ tx: txData?.mean ?? 0, rx: rxData?.mean ?? 0 });
        set_std({ tx: txData?.std_dev ?? 0, rx: rxData?.std_dev ?? 0 });
        set_total_packet_count({ tx: txData?.total_pkt_count ?? 0, rx: rxData?.total_pkt_count ?? 0 });
        set_missed_bin_count({ tx: txData?.missed_bin_count ?? 0, rx: rxData?.missed_bin_count ?? 0 });

        setPercentileData({
            tx: txData?.percentiles ? { ...txData.percentiles } : {},
            rx: rxData?.percentiles ? { ...rxData.percentiles } : {},
        });
    }, [stats, port_mapping, rx_port, includeTx]);

    const calculateBinWidth = (minValue: number, maxValue: number, numBins: number) => {
        return (maxValue - minValue) / numBins;
    }

    const percentileKeys = Array.from(
        new Set([
            ...Object.keys(percentileData.tx ?? {}),
            ...Object.keys(percentileData.rx ?? {}),
        ])
    ).sort((a, b) => Number(a) - Number(b));

    const formatDirectionalNs = (value: number, available: boolean) => available ? formatNanoSeconds(value) : "-";
    const formatDirectionalCount = (value: number, available: boolean) => available ? formatFrameCount(value) : "-";


    return <>
        <Row className="mb-3">
            <Col xs={12} md={4}>
                <Table striped bordered hover size="sm" className="mt-3 mb-3">
                    <thead className="table-dark">
                        <OverlayTrigger placement="top" overlay={(props) => renderTooltip(props, "Histogram config")}>
                            <tr>
                                <th>Bin Range</th>
                                <th>#Bins</th>
                                <th>Bin Width</th>
                            </tr>
                        </OverlayTrigger>
                    </thead>
                    <tbody>
                        <tr>
                            <td>[{formatNanoSeconds(minValue, 2)}, {formatNanoSeconds(maxValue, 2)}]</td>
                            <td>{numBins}</td>
                            <td>{formatNanoSeconds(binWidth, 2)}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
            <Col xs={12} md={4}>
                <Table striped bordered hover size="sm" className="mt-3 mb-3">
                    <thead className="table-dark">
                        <OverlayTrigger placement="top" overlay={(props) => renderTooltip(props, "Values calculated from histogram data")}>
                            <tr>
                                <th>Dir</th>
                                <th><Overline>{type}</Overline></th>
                                <th>σ({type})</th>
                                <th>Outlier</th>
                                <th>Total #Packets</th>
                            </tr>
                        </OverlayTrigger>

                    </thead>
                    <tbody>
                        {includeTx &&
                            <tr>
                                <td>{txLabel}</td>
                                <td>{formatDirectionalNs(mean.tx, hasTxData)}</td>
                                <td>{formatDirectionalNs(std.tx, hasTxData)}</td>
                                <td>{formatDirectionalCount(missedBinCount.tx, hasTxData)}</td>
                                <td>{formatDirectionalCount(totalPacketCount.tx, hasTxData)}</td>
                            </tr>
                        }
                        <tr>
                            <td>{rxLabel}</td>
                            <td>{formatDirectionalNs(mean.rx, hasRxData)}</td>
                            <td>{formatDirectionalNs(std.rx, hasRxData)}</td>
                            <td>{formatDirectionalCount(missedBinCount.rx, hasRxData)}</td>
                            <td>{formatDirectionalCount(totalPacketCount.rx, hasRxData)}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
            <Col xs={12} md={4}>
                <Table striped bordered hover size="sm" className="mt-3 mb-3">
                    <thead className="table-dark">
                        <OverlayTrigger placement="top" overlay={(props) => renderTooltip(props, "Percentiles")}>
                            <tr>
                                <th>Dir</th>
                                {percentileKeys.map((key) => (
                                    <th key={key}>{`p${key}`}</th>
                                ))}
                            </tr>
                        </OverlayTrigger>
                    </thead>
                    <tbody>
                        {includeTx &&
                            <tr>
                                <td>{txLabel}</td>
                                {percentileKeys.map((key) => (
                                    <td key={`tx-${key}`}>{percentileData.tx[key] !== undefined ? formatNanoSeconds(percentileData.tx[key]) : "-"}</td>
                                ))}
                            </tr>
                        }
                        <tr>
                            <td>{rxLabel}</td>
                            {percentileKeys.map((key) => (
                                <td key={`rx-${key}`}>{percentileData.rx[key] !== undefined ? formatNanoSeconds(percentileData.rx[key]) : "-"}</td>
                            ))}
                        </tr>
                    </tbody>
                </Table>
            </Col>
        </Row>



    </>
}

export default StatViewHistogram