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
import { Statistics } from "../common/Interfaces";

import styled from 'styled-components'
import { formatNanoSeconds, formatFrameCount } from '../common/Helper';

const Overline = styled.span`
  text-decoration: overline;
`

const StatViewHistogram = ({ stats, port_mapping, rx_port }: { stats: Statistics, port_mapping: { [name: number]: number }, rx_port: number }) => {
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
        if (Object.values(port_mapping).includes(rx_port)) {
            const rttHistogram = stats.rtt_histogram[rx_port];
            if (!rttHistogram) return;

            set_min_value(rttHistogram.config.min);
            set_max_value(rttHistogram.config.max);
            set_num_bins(rttHistogram.config.num_bins);
            set_mean_rtt(rttHistogram.data.mean_rtt);
            set_std_rtt(rttHistogram.data.std_dev_rtt);
            set_bin_width(calculateBinWidth(rttHistogram.config.min, rttHistogram.config.max, rttHistogram.config.num_bins));
            set_total_packet_count(rttHistogram.data.total_pkt_count);
            set_missed_bin_count(rttHistogram.data.missed_bin_count);
            if (rttHistogram.data.percentiles) {
                const p_data = rttHistogram.data.percentiles;
                Object.entries(p_data).forEach(([key, value]) => {
                    setPercentileData(prev => ({
                        ...prev,
                        [key]: value
                    }));
                }
                );
            }
        }

    }, [stats.rtt_histogram])


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