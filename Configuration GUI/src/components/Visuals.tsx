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
import { uniqueRxPairs } from "../common/Helper";
import { Histogram, PortTxRxMap, StatisticsEntry, TimeStatisticsEntry } from "../common/Interfaces";
import React, { useState } from "react";
import { Button, Col, Form, Row, OverlayTrigger, Tooltip } from 'react-bootstrap';
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
    data: TimeStatisticsEntry,
    pairs: Array<[string, string]>,
): [string[], number[]] => {
    // data[data_key]: { [port]: { [channel]: { [time]: number } } }
    const source = (data as any)[data_key] as
        | { [port: string]: { [ch: string]: { [time: string]: number } } }
        | undefined;

    const series: Array<{ [time: string]: number }> = [];
    if (source) {
        for (const [port, channel] of pairs) {
            const s = source[port]?.[channel];
            if (s) series.push(s);
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

const generateAppLineData = (
    dataKey: "app_tx_l2" | "app_rx_l2",
    data: TimeStatisticsEntry,
    pairs: Array<[string, string]>,
    appIds: number[],
    l2FrameSizes: Record<number, number>,
): [string[], number[]] => {
    const source = data[dataKey];
    const merged: Record<string, number> = {};

    for (const [port, channel] of pairs) {
        for (const appId of appIds) {
            const series = source?.[Number(port)]?.[Number(channel)]?.[appId];
            const l2FrameSize = l2FrameSizes[appId];
            const l1Factor = l2FrameSize > 0 ? (l2FrameSize + 20) / l2FrameSize : 1;
            for (const [time, rateL2] of Object.entries(series ?? {})) {
                merged[time] = (merged[time] ?? 0) + rateL2 * l1Factor;
            }
        }
    }

    const times = Object.keys(merged).map(Number).sort((left, right) => left - right);
    return [
        times.map((time) => secondsToTime(time)),
        times.map((time) => merged[String(time)]),
    ];
};


const renderTooltip = (props: any) => (
    <Tooltip id="tooltip-disabled" {...props}>
        Histogram is only available in the port view.
    </Tooltip>
);

const generateHistogram = (
    histogram_data: { [port: string]: { [channel: string]: Histogram } },
    port_mapping: PortTxRxMap,
    includeTx: boolean,
    selection: string = "total",
): [string[], number[], number[]] => {
    //const histogram_data = data.rtt_histogram; // { [port]: { [ch]: RttHistogram } }
    let combined_bins_tx: { [binIndex: string]: number } = {};
    let combined_bins_rx: { [binIndex: string]: number } = {};
    let min = Infinity;
    let max = -Infinity;
    let num_bins = 0;
    let has_tx_data = false;
    let has_rx_data = false;

    if (histogram_data) {
        // collect RX (port,channel) pairs from mapping
        const rxSeen = new Set<string>();
        for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
            for (const [txCh, target] of Object.entries(perCh ?? {})) {
                const rxPort = String((target as any).port);
                const rxCh = String((target as any).channel);

                // Accumulate a shared RX endpoint only once when multiple
                // TX ports map to the same RX
                const rxKey = `${rxPort}/${rxCh}`;
                const firstRxVisit = !rxSeen.has(rxKey);
                rxSeen.add(rxKey);

                const histTx = histogram_data?.[txPort]?.[txCh];
                const histRx = histogram_data?.[rxPort]?.[rxCh];
                const config = histRx?.config ?? histTx?.config;
                const selectedTx = selectHistogramPath(histTx, selection);
                const selectedRx = selectHistogramPath(histRx, selection);
                const txData = includeTx ? selectedTx?.tx : undefined;
                const rxData = firstRxVisit ? selectedRx?.rx : undefined;

                if (config) {
                    min = Math.min(min, config.min);
                    max = Math.max(max, config.max);
                    num_bins = config.num_bins;
                }

                for (let i = 0; i < (config?.num_bins ?? 0); i++) {
                    const binKey = String(i);

                    if (txData) {
                        const value = txData.data_bins?.[binKey]?.probability ?? 0;
                        combined_bins_tx[binKey] = (combined_bins_tx[binKey] ?? 0) + value;
                        has_tx_data = true;
                    }

                    if (rxData) {
                        const value = rxData.data_bins?.[binKey]?.probability ?? 0;
                        combined_bins_rx[binKey] = (combined_bins_rx[binKey] ?? 0) + value;
                        has_rx_data = true;
                    }
                }
            }
        }
    }


    if (min === Infinity || max === -Infinity || num_bins === 0 || (!has_tx_data && !has_rx_data)) {
        return [[], [], []]; // no valid data
    }

    const binWidth = (max - min) / num_bins;
    const labels: string[] = [];
    const values_tx: number[] = [];
    const values_rx: number[] = [];

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
        values_tx.push(combined_bins_tx[String(i)] ?? 0);
        values_rx.push(combined_bins_rx[String(i)] ?? 0);
    }

    return [labels, values_tx, values_rx];
};

const getPercentileAnnotations = (
    histogram: { [port: string]: { [channel: string]: Histogram } },
    port_mapping: PortTxRxMap,
    includeTx: boolean,
    selection: string = "total",
): Record<string, any> => {
    const annotations: Record<string, any> = {};

    const percentileColors: Record<"tx" | "rx", string[]> = {
        tx: ['#3c82e7', '#2ecc71', '#16a085', '#1f618d'],
        rx: ['#e74c3c', '#d35400', '#e67e22', '#af601a'],
    };

    if (!histogram) return annotations;

    // Iterate RX endpoints from mapping (values of TX->channel->RxTarget)
    for (const [txPort, perCh] of Object.entries(port_mapping ?? {})) {
        for (const [txCh, target] of Object.entries(perCh ?? {})) {
            const rxPort = String((target as any).port);
            const rxCh = String((target as any).channel);

            const histTx = histogram?.[txPort]?.[txCh];
            const histRx = histogram?.[rxPort]?.[rxCh];

            (["tx", "rx"] as const).forEach((direction) => {
                if (direction === "tx" && !includeTx) return;

                const selectedTx = selectHistogramPath(histTx, selection);
                const selectedRx = selectHistogramPath(histRx, selection);
                const hdata = direction === "tx" ? selectedTx?.tx : selectedRx?.rx;
                const config = direction === "tx" ? histTx?.config : histRx?.config;
                if (!hdata || !config) return;

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
                    const colors = percentileColors[direction];
                    const color = colors[percentileIndex % colors.length] || 'gray';
                    const dirPrefix = direction.toUpperCase();

                    const lineKey = `${direction}_p${key}_${rxPort}_${rxCh}`;
                    const labelKey = `label_${direction}_p${key}_${rxPort}_${rxCh}`;

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
                        content: [`${dirPrefix} p${key}`],
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
            });
        }
    }

    return annotations;
};

const selectHistogramPath = (histogram: Histogram | undefined, selection: string) => {
    if (!histogram) return undefined;
    if (selection === "aggregate") return histogram.breakdown?.aggregate;
    if (selection.startsWith("stream:")) {
        return histogram.breakdown?.per_stream?.[selection.slice("stream:".length)];
    }
    return histogram.data;
};

const histogramResultOptions = (
    histogram: { [port: string]: { [channel: string]: Histogram } },
    portMapping: PortTxRxMap,
) => {
    let hasAggregate = false;
    const streams = new Set<number>();
    const results: Histogram[] = [];
    for (const [txPort, channels] of Object.entries(portMapping ?? {})) {
        for (const [txChannel, target] of Object.entries(channels ?? {})) {
            const txResult = histogram?.[txPort]?.[txChannel];
            const rxResult = histogram?.[String(target.port)]?.[String(target.channel)];
            if (txResult) results.push(txResult);
            if (rxResult) results.push(rxResult);
        }
    }
    for (const result of results) {
            hasAggregate ||= result.breakdown?.aggregate !== undefined;
            Object.keys(result.breakdown?.per_stream ?? {}).forEach(appId => streams.add(Number(appId)));
    }
    return {
        hasAggregate,
        streams: Array.from(streams).sort((a, b) => a - b),
    };
};

const get_frame_types = (
    stats: StatisticsEntry,
    txPairs: Array<[string, string]>,
    rxPairs: Array<[string, string]>,
    type: string
): { tx: number; rx: number } => {
    const ret = { tx: 0, rx: 0 };
    const ftd = stats.frame_type_data; // { [port]: { [ch]: { tx: {...}, rx: {...} } } }

    if (!ftd) return ret;

    for (const [txPort, txCh] of txPairs) {
        const txVal = (ftd[txPort]?.[txCh]?.tx as any)?.[type];
        if (typeof txVal === "number") ret.tx += txVal;
    }

    for (const [rxPort, rxCh] of rxPairs) {
        const rxVal = (ftd[rxPort]?.[rxCh]?.rx as any)?.[type];
        if (typeof rxVal === "number") ret.rx += rxVal;
    }

    return ret;
};


const get_frame_stats = (
    stats: StatisticsEntry,
    txPairs: Array<[string, string]>,
    rxPairs: Array<[string, string]>,
    type: "tx" | "rx",
    low: number,
    high: number
) => {
    let ret = 0;
    const fs = stats.frame_size ?? {};

    if (type === "tx") {
        for (const [txPort, txCh] of txPairs) {
            const bins = fs?.[txPort]?.[txCh]?.tx ?? [];
            for (const f of bins) {
                if (f?.low === low && f?.high === high) ret += f?.packets ?? 0;
            }
        }
    } else if (type === "rx") {
        for (const [rxPort, rxCh] of rxPairs) {
            const bins = fs?.[rxPort]?.[rxCh]?.rx ?? [];
            for (const f of bins) {
                if (f?.low === low && f?.high === high) ret += f?.packets ?? 0;
            }
        }
    }

    return ret;
};


const get_rtt = (
    data: TimeStatisticsEntry,
    rxPairs: Array<[string, string]>,
): [string[], number[]] => {
    // data.rtt: { [port]: { [channel]: { [time]: number } } }
    const src = (data as any).rtt as
        | { [port: string]: { [ch: string]: { [t: string]: number } } }
        | undefined;

    const series: Array<{ [t: string]: number }> = [];
    if (src) {
        for (const [rxPort, rxCh] of rxPairs) {
            const s = src[rxPort]?.[rxCh];
            if (s) series.push(s);
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

const Visuals = ({ data, stats, port_mapping, is_summary, rx_port, sequence_metrics_reliable = true, tx_pairs, rx_pairs, route_app_ids = [], app_l2_frame_sizes = {}, rate_only = false, rx_rate_unambiguous = true }: {
    data: TimeStatisticsEntry,
    stats: StatisticsEntry,
    port_mapping: PortTxRxMap,
    is_summary: boolean,
    rx_port: number,
    sequence_metrics_reliable?: boolean,
    tx_pairs?: Array<[string, string]>,
    rx_pairs?: Array<[string, string]>,
    route_app_ids?: number[],
    app_l2_frame_sizes?: Record<number, number>,
    rate_only?: boolean,
    rx_rate_unambiguous?: boolean,
}) => {
    const txPairs = tx_pairs ?? Object.entries(port_mapping ?? {}).flatMap(
        ([port, perChannel]) => Object.keys(perChannel ?? {}).map((channel) => [port, channel] as [string, string])
    );
    const rxPairs = rx_pairs ?? uniqueRxPairs(port_mapping);
    const filterAppRates = route_app_ids.length > 0 && data.app_tx_l2 !== undefined && data.app_rx_l2 !== undefined;
    const [labels_tx, line_data_tx] = filterAppRates
        ? generateAppLineData("app_tx_l2", data, txPairs, route_app_ids, app_l2_frame_sizes)
        : generateLineData("tx_rate_l1", data, txPairs)
    const [labels_rx, line_data_rx] = filterAppRates
        ? generateAppLineData("app_rx_l2", data, rxPairs, route_app_ids, app_l2_frame_sizes)
        : generateLineData("rx_rate_l1", data, rxPairs)
    const [labels_loss, line_data_loss] = generateLineData("packet_loss", data, rxPairs)
    const [labels_out_of_order, line_data_out_of_order] = generateLineData("out_of_order", data, rxPairs)
    const [labels_rtt, line_data_rtt] = get_rtt(data, rxPairs)
    const [visual_select, set_visual_select] = useState("rate")
    const [showPercentiles, set_show_percentiles] = useState(true)
    const [rttHistogramSelection, setRttHistogramSelection] = useState("total");
    const [iatHistogramSelection, setIatHistogramSelection] = useState("total");
    const rttResultOptions = histogramResultOptions(stats.rtt_histogram, port_mapping);
    const iatResultOptions = histogramResultOptions(stats.iat_histogram, port_mapping);
    const effectiveRttSelection = (rttHistogramSelection === "aggregate" && !rttResultOptions.hasAggregate)
        || (rttHistogramSelection.startsWith("stream:")
        && !rttResultOptions.streams.includes(Number(rttHistogramSelection.slice(7))))
        ? "total" : rttHistogramSelection;
    const effectiveIatSelection = (iatHistogramSelection === "aggregate" && !iatResultOptions.hasAggregate)
        || (iatHistogramSelection.startsWith("stream:")
        && !iatResultOptions.streams.includes(Number(iatHistogramSelection.slice(7))))
        ? "total" : iatHistogramSelection;
    const [labels_rtt_hist, hist_data_rtt_tx, hist_data_rtt_rx] = generateHistogram(stats.rtt_histogram, port_mapping, false, effectiveRttSelection);
    const [labels_iat_hist, hist_data_iat_tx, hist_data_iat_rx] = generateHistogram(stats.iat_histogram, port_mapping, true, effectiveIatSelection);
    const percentileRTTAnnotations = getPercentileAnnotations(stats.rtt_histogram, port_mapping, false, effectiveRttSelection);
    const percentileIATAnnotations = getPercentileAnnotations(stats.iat_histogram, port_mapping, true, effectiveIatSelection);

    const rateDatasets = [
        {
            fill: true,
            label: 'TX rate',
            data: line_data_tx.map(val => val * 10 ** -9),
            borderColor: 'rgb(53, 162, 235)',
            backgroundColor: 'rgba(53, 162, 235, 0.5)',
        },
        ...(rx_rate_unambiguous ? [{
            fill: true,
            label: 'RX rate',
            data: line_data_rx.map(val => val * 10 ** -9),
            borderColor: 'rgb(183,85,40)',
            backgroundColor: 'rgb(250,122,64, 0.5)',
        }] : []),
    ];
    const rate_data = {
        labels: labels_tx,
        datasets: rateDatasets,
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
                data: [get_frame_types(stats, txPairs, rxPairs, "multicast").tx,
                get_frame_types(stats, txPairs, rxPairs, "broadcast").tx,
                get_frame_types(stats, txPairs, rxPairs, "unicast").tx,
                get_frame_types(stats, txPairs, rxPairs, "vxlan").tx],
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
                data: [get_frame_types(stats, txPairs, rxPairs, "multicast").rx,
                get_frame_types(stats, txPairs, rxPairs, "broadcast").rx,
                get_frame_types(stats, txPairs, rxPairs, "unicast").rx,
                get_frame_types(stats, txPairs, rxPairs, "vxlan").rx],
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
                    get_frame_types(stats, txPairs, rxPairs, "vlan").tx,
                    get_frame_types(stats, txPairs, rxPairs, "qinq").tx,
                    get_frame_types(stats, txPairs, rxPairs, "ipv4").tx,
                    get_frame_types(stats, txPairs, rxPairs, "ipv6").tx,
                    get_frame_types(stats, txPairs, rxPairs, "mpls").tx,
                    get_frame_types(stats, txPairs, rxPairs, "arp").tx,
                    get_frame_types(stats, txPairs, rxPairs, "unknown").tx],
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
                    get_frame_types(stats, txPairs, rxPairs, "vlan").rx,
                    get_frame_types(stats, txPairs, rxPairs, "qinq").rx,
                    get_frame_types(stats, txPairs, rxPairs, "ipv4").rx,
                    get_frame_types(stats, txPairs, rxPairs, "ipv6").rx,
                    get_frame_types(stats, txPairs, rxPairs, "mpls").rx,
                    get_frame_types(stats, txPairs, rxPairs, "arp").rx,
                    get_frame_types(stats, txPairs, rxPairs, "unknown").rx],
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
                    return get_frame_stats(stats, txPairs, rxPairs, "tx", v[0], v[1])
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
                    return get_frame_stats(stats, txPairs, rxPairs, "rx", v[0], v[1])
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

    const rtt_hist_datasets: ChartData<"bar">["datasets"] = [];
    if (hist_data_rtt_rx.length > 0) {
        rtt_hist_datasets.push({
            label: 'RTT RX distribution',
            data: hist_data_rtt_rx,
            backgroundColor: 'rgba(231, 76, 60, 0.6)'
        });
    }

    const rtt_hist_data: ChartData<"bar"> = {
        labels: labels_rtt_hist,
        datasets: rtt_hist_datasets
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
                annotations: showPercentiles ? percentileRTTAnnotations : {}
            }
        },
    };

    const iat_hist_data: ChartData<"bar"> = {
        labels: labels_iat_hist,
        datasets: [
            {
                label: 'IAT TX distribution',
                data: hist_data_iat_tx,
                backgroundColor: 'rgba(53, 162, 235, 0.6)'
            },
            {
                label: 'IAT RX distribution',
                data: hist_data_iat_rx,
                backgroundColor: 'rgba(231, 76, 60, 0.6)'
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
                annotations: showPercentiles ? percentileIATAnnotations : {}
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

        {visual_select == "loss" && sequence_metrics_reliable ?
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
                <Row className="mb-2">
                    <Col className="d-flex justify-content-end gap-2">
                        <Form.Select
                            size="sm"
                            style={{ width: "auto" }}
                            aria-label="RTT histogram result"
                            value={effectiveRttSelection}
                            onChange={event => setRttHistogramSelection(event.target.value)}
                        >
                            <option value="total">All selected</option>
                            {rttResultOptions.hasAggregate ? <option value="aggregate">Aggregated streams</option> : null}
                            {rttResultOptions.streams.map(appId =>
                                <option key={`rtt-stream-${appId}`} value={`stream:${appId}`}>Stream {appId}</option>
                            )}
                        </Form.Select>
                        <Button
                            size="sm"
                            variant={showPercentiles ? "outline-secondary" : "secondary"}
                            onClick={() => set_show_percentiles((prev) => !prev)}
                        >
                            {showPercentiles ? "Hide percentiles" : "Show percentiles"}
                        </Button>
                    </Col>
                </Row>
                <StatViewHistogram stats={stats.rtt_histogram} port_mapping={port_mapping} rx_port={rx_port} type={"RTT"} includeTx={false} selection={effectiveRttSelection} />
                <Bar options={rtt_histogram_options} data={rtt_hist_data} />
            </>
            :
            null
        }

        {visual_select == "iat_histogram" ?
            <>
                <Row className="mb-2">
                    <Col className="d-flex justify-content-end gap-2">
                        <Form.Select
                            size="sm"
                            style={{ width: "auto" }}
                            aria-label="IAT histogram result"
                            value={effectiveIatSelection}
                            onChange={event => setIatHistogramSelection(event.target.value)}
                        >
                            <option value="total">All selected</option>
                            {iatResultOptions.hasAggregate ? <option value="aggregate">Aggregated streams</option> : null}
                            {iatResultOptions.streams.map(appId =>
                                <option key={`iat-stream-${appId}`} value={`stream:${appId}`}>Stream {appId}</option>
                            )}
                        </Form.Select>
                        <Button
                            size="sm"
                            variant={showPercentiles ? "outline-secondary" : "secondary"}
                            onClick={() => set_show_percentiles((prev) => !prev)}
                        >
                            {showPercentiles ? "Hide percentiles" : "Show percentiles"}
                        </Button>
                    </Col>
                </Row>
                <StatViewHistogram stats={stats.iat_histogram} port_mapping={port_mapping} rx_port={rx_port} type={"IAT"} selection={effectiveIatSelection} />
                <Bar options={iat_histogram_options} data={iat_hist_data} />
            </>
            :
            null
        }

        {!rate_only ? <Row className={"text-center mb-3 mt-3"}>
            <Form onChange={(event: any) => set_visual_select(event.target.id)}>
                <Form.Check
                    inline
                    label="Traffic rates"
                    type="radio"
                    name={"visuals"}
                    checked={visual_select == "rate"}
                    id={`rate`}
                />
                {sequence_metrics_reliable ? <Form.Check
                    inline
                    label="Packet loss/Out of order"
                    type="radio"
                    name={"visuals"}
                    checked={visual_select == "loss"}
                    id={`loss`}
                /> : null}
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
        </Row> : null}
    </>
}

export default Visuals
