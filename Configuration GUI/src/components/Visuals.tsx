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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Filler,
    Legend, ArcElement,
    BarElement,
    ChartData,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation';

import { Bar, Doughnut, Line } from 'react-chartjs-2'
import { secondsToTime } from "./SendReceiveMonitor";
import { Histogram, PortTxRxMap, StatisticsEntry, TimeStatisticsEntry } from "../common/Interfaces";
import React, { useState } from "react";
import { Col, Form, Row, OverlayTrigger, Tooltip } from 'react-bootstrap';
import StatViewHistogram from './StatViewHistogram';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    ArcElement,
    LineElement,
    BarElement,
    Title,
    Filler,
    Legend,
    annotationPlugin
)

const rate_options = {
    responsive: true,
    aspectRatio: 6,
    scales: {
        y: {
            title: {
                display: true,
                text: 'Gbit/s'
            },
            suggestedMin: 0,
            beginAtZero: true
        },
        x: {
            title: {
                display: true,
                text: 'Time'
            },
            ticks: {
                source: 'auto',
                autoSkip: true,
            },
        },
    },
    plugins: {
        legend: {
            position: 'top' as const,
        },
        title: {
            display: false,
            text: '',
        },
    },

}

const loss_options = {
    responsive: true,
    aspectRatio: 6,
    scales: {
        y: {
            title: {
                display: true,
                text: '#Packets'
            },
            suggestedMin: 0,
            beginAtZero: true
        },
        x: {
            title: {
                display: true,
                text: 'Time'
            },
            ticks: {
                source: 'auto',
                autoSkip: true,
            },
        },
    },
    plugins: {
        legend: {
            position: 'top' as const,
        },
        title: {
            display: false,
            text: '',
        },
    },
}

const frame_options = {
    responsive: true,
    animation: false,
    aspectRatio: 2,
    plugins: {
        legend: {
            position: 'top' as const,
        },
        title: {
            display: false,
            text: 'Frame type',
        },
    },

}

const rtt_options = {
    responsive: true,
    aspectRatio: 6,
    scales: {
        y: {
            title: {
                display: true,
                text: 'μs'
            },
            suggestedMin: 0,
            beginAtZero: true
        },
        x: {
            title: {
                display: true,
                text: 'Time'
            },
            ticks: {
                source: 'auto',
                autoSkip: true,
            },
        },
    },
    plugins: {
        legend: {
            position: 'top' as const,
        },
        title: {
            display: false,
            text: '',
        },
    },
}

function getTimeUnit(value: number): [value: number, unit: string] {
    const units = ['ns', 'μs', 'ms', 's'];
    let unitIndex = 0;

    // Scale the value and determine the correct unit
    while (value >= 1000 && unitIndex < units.length - 1) {
        value /= 1000;
        unitIndex++;
    }
    const unit = units[unitIndex];

    return [value, unit];
}

const generateLineData = (
    data_key: string,
    use_key: boolean,
    data: TimeStatisticsEntry,
    port_mapping: { [port: string]: { [channel: string]: { port: number; channel: number } } }
): [string[], number[]] => {
    // data[data_key]: { [port]: { [channel]: { [time]: number } } }
    const source = (data as any)[data_key] as
        | { [port: string]: { [ch: string]: { [time: string]: number } } }
        | undefined;

    const series: Array<{ [time: string]: number }> = [];
    if (source) {
        if (use_key) {
            // TX: iterate mapping keys (tx port/channel)
            for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
                for (const txCh of Object.keys(perCh ?? {})) {
                    const s = source[txPort]?.[txCh];
                    if (s) series.push(s);
                }
            }
        } else {
            // RX: iterate mapping values (rx target port/channel)
            for (const perCh of Object.values(port_mapping ?? {})) {
                for (const target of Object.values(perCh ?? {})) {
                    const rxPort = String((target as any).port);
                    const rxCh = String((target as any).channel);
                    const s = source[rxPort]?.[rxCh];
                    if (s) series.push(s);
                }
            }
        }
    }

    // Merge by time (sum across series)
    const merged: { [t: string]: number } = {};
    for (const s of series) {
        for (const [t, v] of Object.entries(s)) {
            merged[t] = (merged[t] ?? 0) + (v ?? 0);
        }
    }

    // Sort by numeric time for consistent axes
    const times = Object.keys(merged)
        .map((t) => Number(t))
        .sort((a, b) => a - b);

    const labels = times.map((t) => secondsToTime(t));
    const values = times.map((t) => merged[String(t)]);

    return [labels, values];
};


const renderTooltip = (props: any) => (
    <Tooltip id="tooltip-disabled" {...props}>
        Histogram is only available in the port view.
    </Tooltip>
);

const generateHistogram = (
    histogram_data: { [port: string]: { [channel: string]: Histogram } },
    port_mapping: PortTxRxMap
): [string[], number[]] => {
    //const histogram_data = data.rtt_histogram; // { [port]: { [ch]: RttHistogram } }
    let combined_bins: { [binIndex: string]: number } = {};
    let min = Infinity;
    let max = -Infinity;
    let num_bins = 0;

    if (histogram_data) {
        // collect RX (port,channel) pairs from mapping
        for (const perCh of Object.values(port_mapping ?? {})) {
            for (const target of Object.values(perCh ?? {})) {
                const rxPort = String((target as any).port);
                const rxCh = String((target as any).channel);

                const hist = histogram_data?.[rxPort]?.[rxCh];
                const config = hist?.config;
                const hdata = hist?.data;

                if (config && hdata) {
                    min = Math.min(min, config.min);
                    max = Math.max(max, config.max);
                    num_bins = config.num_bins;

                    for (let i = 0; i < config.num_bins; i++) {
                        const binKey = String(i);
                        const value = hdata.data_bins?.[binKey]?.probability ?? 0;
                        combined_bins[binKey] = (combined_bins[binKey] ?? 0) + value;
                    }
                }
            }
        }
    }


    if (min === Infinity || max === -Infinity || num_bins === 0) {
        return [[], []]; // no valid data
    }

    const binWidth = (max - min) / num_bins;
    const labels: string[] = [];
    const values: number[] = [];

    for (let i = 0; i < num_bins; i++) {
        const start = min + i * binWidth;
        const [start_val, start_unit] = getTimeUnit(start);
        const end = min + (i + 1) * binWidth;
        const [end_val, end_unit] = getTimeUnit(end);

        const label =
            end_unit === start_unit
                ? `${start_val.toFixed(2)} – ${end_val.toFixed(2)} ${start_unit}`
                : `${start_val.toFixed(2)} ${start_unit} – ${end_val.toFixed(2)} ${end_unit}`;

        labels.push(label);
        values.push(combined_bins[String(i)] ?? 0);
    }

    return [labels, values];
};

const getPercentileAnnotations = (
    histogram_data: { [port: string]: { [channel: string]: Histogram } },
    port_mapping: PortTxRxMap
): Record<string, any> => {
    const annotations: Record<string, any> = {};
    const histogram = histogram_data; // { [port]: { [channel]: RttHistogram } }

    const percentileColors: string[] = ['#3c82e7', '#e74c3c', '#e7a23c', '#a23ce7'];

    if (!histogram) return annotations;

    // Iterate RX endpoints from mapping (values of TX->channel->RxTarget)
    for (const perCh of Object.values(port_mapping ?? {})) {
        for (const target of Object.values(perCh ?? {})) {
            const rxPort = String((target as any).port);
            const rxCh = String((target as any).channel);

            const hist = histogram?.[rxPort]?.[rxCh];
            const config = hist?.config;
            const hdata = hist?.data;
            if (!config || !hdata) continue;

            const percentiles = hdata.percentiles ?? {};
            const maxYValue =
                Math.max(0, ...Object.values(hdata.data_bins ?? {}).map((e: any) => e?.probability ?? 0));

            let percentileIndex = 0;
            for (const [key, value] of Object.entries(percentiles)) {
                if (value == null) { percentileIndex++; continue; }

                const binWidth = (config.max - config.min) / config.num_bins;
                const binIndex = Math.floor((Number(value) - config.min) / binWidth);

                // Stagger labels if multiple fall on the same x
                const offsetFactor = 0.065;
                const yOffset = maxYValue * 0.95 * (1 - offsetFactor * percentileIndex);
                const color = percentileColors[percentileIndex % percentileColors.length] || 'gray';

                const lineKey = `p${key}_${rxPort}_${rxCh}`;
                const labelKey = `label_p${key}_${rxPort}_${rxCh}`;

                annotations[lineKey] = {
                    type: 'line',
                    scaleID: 'x',
                    value: binIndex,
                    borderColor: color,
                    borderWidth: 2,
                    borderDash: [6, 6],
                };
                annotations[labelKey] = {
                    type: 'label',
                    xScaleID: 'x',
                    yScaleID: 'y',
                    xValue: binIndex - 0.15,
                    yValue: yOffset,
                    content: [`p${key}`],
                    backgroundColor: `${color}80`,
                    font: { size: 18, family: 'sans-serif', color: '#fff' },
                    padding: 4,
                    borderRadius: 7,
                    position: 'center',
                    xAdjust: 0,
                    yAdjust: -10,
                };

                percentileIndex++;
            }
        }
    }

    return annotations;
};

const get_frame_types = (
    stats: StatisticsEntry,
    port_mapping: PortTxRxMap,
    type: string
): { tx: number; rx: number } => {
    const ret = { tx: 0, rx: 0 };
    const ftd = stats.frame_type_data; // { [port]: { [ch]: { tx: {...}, rx: {...} } } }

    if (!ftd) return ret;

    for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
        for (const [txCh, target] of Object.entries(perCh ?? {})) {
            // TX side: use (txPort, txCh)
            const txVal = (ftd[txPort]?.[txCh]?.tx as any)?.[type];
            if (typeof txVal === "number") ret.tx += txVal;

            // RX side: use mapped (rxPort, rxCh)
            const rxPort = String((target as any).port);
            const rxCh = String((target as any).channel);
            const rxVal = (ftd[rxPort]?.[rxCh]?.rx as any)?.[type];
            if (typeof rxVal === "number") ret.rx += rxVal;
        }
    }

    return ret;
};


const get_frame_stats = (
    stats: StatisticsEntry,
    port_mapping: PortTxRxMap,
    type: "tx" | "rx",
    low: number,
    high: number
) => {
    let ret = 0;
    const fs = stats.frame_size ?? {};

    if (!port_mapping) return 0;

    if (type === "tx") {
        // sum for all mapped TX (port, channel)
        for (const [txPort, perCh] of Object.entries(port_mapping)) {
            for (const txCh of Object.keys(perCh ?? {})) {
                const bins = fs?.[txPort]?.[txCh]?.tx ?? [];
                for (const f of bins) {
                    if (f?.low === low && f?.high === high) ret += f?.packets ?? 0;
                }
            }
        }
    } else if (type === "rx") {
        // sum for all mapped RX (port, channel) targets
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


const get_rtt = (
    data: TimeStatisticsEntry,
    port_mapping: PortTxRxMap
): [string[], number[]] => {
    // data.rtt: { [port]: { [channel]: { [time]: number } } }
    const src = (data as any).rtt as
        | { [port: string]: { [ch: string]: { [t: string]: number } } }
        | undefined;

    const series: Array<{ [t: string]: number }> = [];
    if (src) {
        // use RX targets from mapping
        for (const perCh of Object.values(port_mapping ?? {})) {
            for (const target of Object.values(perCh ?? {})) {
                const rxPort = String((target as any).port);
                const rxCh = String((target as any).channel);
                const s = src[rxPort]?.[rxCh];
                if (s) series.push(s);
            }
        }
    }

    // merge by time: sum and count
    const [sum, cnt] = series.reduce(
        ([accSum, accCnt], cur) => {
            for (const [t, v] of Object.entries(cur)) {
                accSum[t] = (accSum[t] ?? 0) + (v ?? 0);
                accCnt[t] = (accCnt[t] ?? 0) + 1;
            }
            return [accSum, accCnt];
        },
        [{} as Record<string, number>, {} as Record<string, number>]
    );

    // sort by time for consistent axes
    const times = Object.keys(sum)
        .map(Number)
        .sort((a, b) => a - b);

    const labels = times.map((t) => secondsToTime(t));
    const values = times.map((t) => {
        const key = String(t);
        const c = cnt[key] || 1;
        return sum[key] / c;
    });

    return [labels, values];
};

const Visuals = ({ data, stats, port_mapping, is_summary, rx_port }: { data: TimeStatisticsEntry, stats: StatisticsEntry, port_mapping: PortTxRxMap, is_summary: boolean, rx_port: number }) => {
    const [labels_tx, line_data_tx] = generateLineData("tx_rate_l1", true, data, port_mapping)
    const [labels_rx, line_data_rx] = generateLineData("rx_rate_l1", false, data, port_mapping)
    const [labels_loss, line_data_loss] = generateLineData("packet_loss", false, data, port_mapping)
    const [labels_out_of_order, line_data_out_of_order] = generateLineData("out_of_order", false, data, port_mapping)
    const [labels_rtt, line_data_rtt] = get_rtt(data, port_mapping)
    const [labels_rtt_hist, hist_data_rtt] = generateHistogram(stats.rtt_histogram, port_mapping);
    const [labels_iat_hist, hist_data_iat] = generateHistogram(stats.iat_histogram, port_mapping);
    const percentileRTTAnnotations = getPercentileAnnotations(stats.rtt_histogram, port_mapping);
    const percentileIATAnnotations = getPercentileAnnotations(stats.iat_histogram, port_mapping);

    const [visual_select, set_visual_select] = useState("rate")

    const rate_data = {
        labels: labels_tx,
        datasets: [
            {
                fill: true,
                label: 'TX rate',
                data: line_data_tx.map(val => val * 10 ** -9),
                borderColor: 'rgb(53, 162, 235)',
                backgroundColor: 'rgba(53, 162, 235, 0.5)',
            },
            {
                fill: true,
                label: 'RX rate',
                data: line_data_rx.map(val => val * 10 ** -9),
                borderColor: 'rgb(183,85,40)',
                backgroundColor: 'rgb(250,122,64, 0.5)',
            },
        ],
    }

    const loss_data = {
        labels: labels_loss,
        datasets: [
            {
                fill: true,
                label: 'Packet loss',
                data: line_data_loss,
                borderColor: 'rgb(53, 162, 235)',
                backgroundColor: 'rgba(53, 162, 235, 0.5)',
            },
            {
                fill: true,
                label: 'Out of order',
                data: line_data_out_of_order,
                borderColor: 'rgb(183,85,40)',
                backgroundColor: 'rgb(250,122,64, 0.5)',
            },
        ],
    }

    const rtt_data = {
        labels: labels_rtt,
        datasets: [
            {
                fill: true,
                label: 'RTT',
                data: line_data_rtt.map(val => val * 10 ** -3),
                borderColor: 'rgb(53, 162, 235)',
                backgroundColor: 'rgba(53, 162, 235, 0.5)',
            },
        ]
    }

    let frame_type_label = ["Multicast", "Broadcast", "Unicast", "VxLAN"]

    const frame_type_data = {
        labels: frame_type_label,
        datasets: [
            {
                label: 'TX frame types',
                data: [get_frame_types(stats, port_mapping, "multicast").tx,
                get_frame_types(stats, port_mapping, "broadcast").tx,
                get_frame_types(stats, port_mapping, "unicast").tx,
                get_frame_types(stats, port_mapping, "vxlan").tx],
                backgroundColor: [
                    'rgb(255, 99, 132)',
                    'rgb(54, 162, 235)',
                    'rgb(255, 205, 86)',
                    'rgb(125,62,37)'
                ],
                hoverOffset: 4
            },
            {
                label: 'RX frame types',
                data: [get_frame_types(stats, port_mapping, "multicast").rx,
                get_frame_types(stats, port_mapping, "broadcast").rx,
                get_frame_types(stats, port_mapping, "unicast").rx,
                get_frame_types(stats, port_mapping, "vxlan").rx],
                backgroundColor: [
                    'rgb(255, 99, 132)',
                    'rgb(54, 162, 235)',
                    'rgb(255, 205, 86)',
                    'rgb(125,62,37)',
                ],
                hoverOffset: 4
            },
        ],
    }

    let ethernet_type_label = ["VLAN", "QinQ", "IPv4", "IPv6", "MPLS", "ARP", "Unknown"]

    const ethernet_type_data = {
        labels: ethernet_type_label,
        datasets: [
            {
                label: 'TX ethernet types',
                data: [
                    get_frame_types(stats, port_mapping, "vlan").tx,
                    get_frame_types(stats, port_mapping, "qinq").tx,
                    get_frame_types(stats, port_mapping, "ipv4").tx,
                    get_frame_types(stats, port_mapping, "ipv6").tx,
                    get_frame_types(stats, port_mapping, "mpls").tx,
                    get_frame_types(stats, port_mapping, "arp").tx,
                    get_frame_types(stats, port_mapping, "unknown").tx],
                backgroundColor: [
                    'rgb(255, 99, 132)',
                    'rgb(54, 162, 235)',
                    'rgb(255, 205, 86)',
                    'rgb(18,194,0)',
                    'rgb(178,0,255)',
                    'rgb(131,63,14)',
                    'rgb(255,104,42)'
                ],
                hoverOffset: 4
            },
            {
                label: 'RX ethernet types',
                data: [
                    get_frame_types(stats, port_mapping, "vlan").rx,
                    get_frame_types(stats, port_mapping, "qinq").rx,
                    get_frame_types(stats, port_mapping, "ipv4").rx,
                    get_frame_types(stats, port_mapping, "ipv6").rx,
                    get_frame_types(stats, port_mapping, "mpls").rx,
                    get_frame_types(stats, port_mapping, "arp").rx,
                    get_frame_types(stats, port_mapping, "unknown").rx],
                backgroundColor: [
                    'rgb(255, 99, 132)',
                    'rgb(54, 162, 235)',
                    'rgb(255, 205, 86)',
                    'rgb(18,194,0)',
                    'rgb(178,0,255)',
                    'rgb(131,63,14)',
                    'rgb(255,104,42)'
                ],
                hoverOffset: 4
            },
        ],
    }

    const frame_size_label = ["0-63", "64", "65-127", "128-255", "256-511", "512-1023", "1024-1518", "1519-21519"]

    const frame_size_data = {
        labels: frame_size_label,
        datasets: [
            {
                label: 'TX frame sizes',
                data: [[0, 63], [64, 64], [65, 127], [128, 255], [256, 511], [512, 1023], [1024, 1518], [1519, 21519]].map((v, i) => {
                    return get_frame_stats(stats, port_mapping, "tx", v[0], v[1])
                }),
                backgroundColor: [
                    'rgb(255, 99, 132)',
                    'rgb(54, 162, 235)',
                    'rgb(255, 205, 86)',
                    'rgb(18,194,0)',
                    'rgb(178,0,255)',
                    'rgb(255,104,42)',
                    'rgb(0,0,0)',
                    'rgb(164,0,0)'
                ],
                hoverOffset: 4
            },
            {
                label: 'RX frame sizes',
                data: [[0, 63], [64, 64], [65, 127], [128, 255], [256, 511], [512, 1023], [1024, 1518], [1519, 21519]].map((v, i) => {
                    return get_frame_stats(stats, port_mapping, "rx", v[0], v[1])
                }),
                backgroundColor: [
                    'rgb(255, 99, 132)',
                    'rgb(54, 162, 235)',
                    'rgb(255, 205, 86)',
                    'rgb(18,194,0)',
                    'rgb(178,0,255)',
                    'rgb(255,104,42)',
                    'rgb(0,0,0)',
                    'rgb(164,0,0)'
                ],
                hoverOffset: 4
            },
        ],
    }

    const rtt_hist_data: ChartData<"bar"> = {
        labels: labels_rtt_hist,
        datasets: [
            {
                label: 'RTT distribution',
                data: hist_data_rtt,
                backgroundColor: 'rgba(53, 162, 235, 0.5)'
            },
        ]
    }

    const rtt_histogram_options = {
        responsive: true,
        aspectRatio: 4,
        scales: {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Probability (%)'
                }
            },
            x: {
                title: {
                    display: true,
                    text: 'RTT Range'
                }
            }
        },
        plugins: {
            legend: {
                display: true,
            },
            annotation: {
                annotations: percentileRTTAnnotations
            }
        },
    };

    const iat_hist_data: ChartData<"bar"> = {
        labels: labels_iat_hist,
        datasets: [
            {
                label: 'IAT distribution',
                data: hist_data_iat,
                backgroundColor: 'rgba(53, 162, 235, 0.5)'
            },
        ]
    }

    const iat_histogram_options = {
        responsive: true,
        aspectRatio: 4,
        scales: {
            y: {
                beginAtZero: true,
                title: {
                    display: true,
                    text: 'Probability (%)'
                }
            },
            x: {
                title: {
                    display: true,
                    text: 'IAT Range'
                }
            }
        },
        plugins: {
            legend: {
                display: true,
            },
            annotation: {
                annotations: percentileIATAnnotations
            }
        },
    };

    // Conditional rendering
    const rttHistogramCheck = (
        <Form.Check
            inline
            label="RTT Histogram"
            type="radio"
            name={"visuals"}
            checked={visual_select === "rtt_histogram"}
            disabled={is_summary}
            id={`rtt_histogram`}
        />
    );
    const iatHistogramCheck = (
        <Form.Check
            inline
            label="IAT Histogram"
            type="radio"
            name={"visuals"}
            checked={visual_select === "iat_histogram"}
            disabled={is_summary}
            id={`iat_histogram`}
        />
    );

    // @ts-ignore
    return <>
        {visual_select == "rate" ?
            <Line options={rate_options} data={rate_data} />
            :
            null
        }

        {visual_select == "loss" ?
            <Line options={loss_options} data={loss_data} />
            :
            null
        }

        {visual_select == "frame" ?
            <Row>
                <Col className={"col-4"}>
                    <Doughnut data={frame_type_data} options={frame_options} title={"Frame types"} />
                </Col>
                <Col className={"col-4"}>
                    <Doughnut data={ethernet_type_data} options={frame_options} />
                </Col>
                <Col className={"col-4"}>
                    <Doughnut data={frame_size_data} options={frame_options} />
                </Col>
            </Row>
            :
            null
        }

        {visual_select == "rtt" ?
            <Line options={rtt_options} data={rtt_data} />
            :
            null
        }

        {visual_select == "rtt_histogram" ?
            <>
                <StatViewHistogram stats={stats.rtt_histogram} port_mapping={port_mapping} rx_port={rx_port} type={"RTT"} />
                <Bar options={rtt_histogram_options} data={rtt_hist_data} />
            </>
            :
            null
        }

        {visual_select == "iat_histogram" ?
            <>
                <StatViewHistogram stats={stats.iat_histogram} port_mapping={port_mapping} rx_port={rx_port} type={"IAT"} />
                <Bar options={iat_histogram_options} data={iat_hist_data} />
            </>
            :
            null
        }

        <Row className={"text-center mb-3 mt-3"}>
            <Form onChange={(event: any) => set_visual_select(event.target.id)}>
                <Form.Check
                    inline
                    label="Traffic rates"
                    type="radio"
                    name={"visuals"}
                    checked={visual_select == "rate"}
                    id={`rate`}
                />
                <Form.Check
                    inline
                    label="Packet loss/Out of order"
                    type="radio"
                    name={"visuals"}
                    checked={visual_select == "loss"}
                    id={`loss`}
                />
                <Form.Check
                    inline
                    label="RTT"
                    type="radio"
                    name={"visuals"}
                    checked={visual_select == "rtt"}
                    id={`rtt`}
                />
                {is_summary ?
                    <OverlayTrigger placement="top" overlay={renderTooltip}>
                        <span className="d-inline-block">
                            {rttHistogramCheck}
                        </span>
                    </OverlayTrigger>
                    :
                    rttHistogramCheck
                }
                {is_summary ?
                    <OverlayTrigger placement="top" overlay={renderTooltip}>
                        <span className="d-inline-block">
                            {iatHistogramCheck}
                        </span>
                    </OverlayTrigger>
                    :
                    iatHistogramCheck
                }
                <Form.Check
                    inline
                    label="Frames"
                    type="radio"
                    name={"visuals"}
                    checked={visual_select == "frame"}
                    id={`frame`}
                />
            </Form>
        </Row>
    </>
}

export default Visuals