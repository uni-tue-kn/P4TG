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
import { PortTxRxMap, StatisticsEntry } from "../common/Interfaces";

import styled from 'styled-components'
import { formatNanoSeconds, formatFrameCount } from '../common/Helper';

const Overline = styled.span`
  text-decoration: overline;
`

const StatViewHistogram = ({ stats, port_mapping, rx_port }: { stats: StatisticsEntry, port_mapping: PortTxRxMap, rx_port: number }) => {
    const [minValue, set_min_value] = useState(0);
    const [maxValue, set_max_value] = useState(0);
    const [numBins, set_num_bins] = useState(0);
    const [binWidth, set_bin_width] = useState(0);
    const [meanRtt, set_mean_rtt] = useState(0);
    const [stdRtt, set_std_rtt] = useState(0);
    const [missedBinCount, set_missed_bin_count] = useState(0);
    const [totalPacketCount, set_total_packet_count] = useState(0);
    const [percentileData, setPercentileData] = useState<Record<string, number>>({});

    const renderTooltip = (props: any, message: string) => (
        <Tooltip id="tooltip-disabled" {...props}>
            {message}
        </Tooltip>
    );

    useEffect(() => {
        // find the first RX channel that maps to this rx_port
        const matches =
            Object.values(port_mapping ?? {})
                .flatMap((perCh) => Object.values(perCh ?? {}))
                .filter((t: any) => t?.port === rx_port);

        if (matches.length === 0) return;

        const rxPortKey = String(rx_port);
        const rxChKey = String(matches[0].channel); // pick first matching channel

        const rttHistogram = stats.rtt_histogram?.[rxPortKey]?.[rxChKey];
        if (!rttHistogram) return;

        const { config, data } = rttHistogram;

        set_min_value(config.min);
        set_max_value(config.max);
        set_num_bins(config.num_bins);
        set_bin_width(calculateBinWidth(config.min, config.max, config.num_bins));

        set_mean_rtt(data.mean_rtt);
        set_std_rtt(data.std_dev_rtt);
        set_total_packet_count(data.total_pkt_count);
        set_missed_bin_count(data.missed_bin_count);

        setPercentileData(() => {
            const p: Record<string, number> = {};
            if (data.percentiles) {
                for (const [k, v] of Object.entries(data.percentiles)) {
                    p[k] = v as number;
                }
            }
            return p;
        });
    }, [stats.rtt_histogram]);

    const calculateBinWidth = (minValue: number, maxValue: number, numBins: number) => {
        return (maxValue - minValue) / numBins;
    }


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
                                <th><Overline>RTT</Overline></th>
                                <th>σ(RTT)</th>
                                <th>Outlier</th>
                                <th>Total #Packets</th>
                            </tr>
                        </OverlayTrigger>

                    </thead>
                    <tbody>
                        <tr>
                            <td>{formatNanoSeconds(meanRtt)}</td>
                            <td>{formatNanoSeconds(stdRtt)}</td>
                            <td>{formatFrameCount(missedBinCount)}</td>
                            <td>{formatFrameCount(totalPacketCount)}</td>
                        </tr>
                    </tbody>
                </Table>
            </Col>
            <Col xs={12} md={4}>
                <Table striped bordered hover size="sm" className="mt-3 mb-3">
                    <thead className="table-dark">
                        <OverlayTrigger placement="top" overlay={(props) => renderTooltip(props, "Percentiles")}>
                            <tr>
                                {Object.keys(percentileData).map((key) => (
                                    <th key={key}>{`p${key}`}</th>
                                ))}
                            </tr>
                        </OverlayTrigger>
                    </thead>
                    <tbody>
                        <tr>
                            {Object.keys(percentileData).map((key) => (
                                <td key={key}>{formatNanoSeconds(percentileData[key])}</td>
                            ))}
                        </tr>
                    </tbody>
                </Table>
            </Col>
        </Row>



    </>
}

export default StatViewHistogram