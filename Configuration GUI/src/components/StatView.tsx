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

import React, { useEffect, useState } from 'react'
import { ButtonGroup, Col, OverlayTrigger, Row, Tab, Table, Tabs, ToggleButton, Tooltip } from "react-bootstrap";
import { Line } from 'react-chartjs-2';
import { GenerationMode, PortTxRxMap, Rfc2544PortMapping, StatisticsEntry, TimeStatisticsEntry } from "../common/Interfaces";
import { formatBits } from "./SendReceiveMonitor";

import styled from 'styled-components'
import Visuals from "./Visuals";
import { formatNanoSeconds, formatFrameCount } from '../common/Helper';
import InfoBox from './InfoBox';

const Overline = styled.span`
  text-decoration: overline;
`

const Rfc2544Caption = styled.caption`
  color: var(--color-text) !important;
`

const RFC2544_FRAME_LOSS_STEPS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10];
const RFC2544_FRAME_LOSS_GRAPH_STEPS = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
const RFC2544_CHART_COLORS = [
    "rgb(53, 162, 235)",
    "rgb(231, 76, 60)",
    "rgb(46, 204, 113)",
    "rgb(155, 89, 182)",
    "rgb(241, 196, 15)",
    "rgb(230, 126, 34)",
    "rgb(26, 188, 156)",
];

const StatView = ({ stats, time_stats, port_mapping, mode, visual, is_summary, rx_port }: { stats: StatisticsEntry, time_stats: TimeStatisticsEntry, port_mapping: PortTxRxMap, mode: GenerationMode, visual: boolean, is_summary: boolean, rx_port: number }) => {
    const [total_tx, set_total_tx] = useState(0);
    const [total_rx, set_total_rx] = useState(0);
    const [iat_tx, set_iat_tx] = useState({ "mean": 0, "std": 0, "n": 0, "mae": 0 });
    const [iat_rx, set_iat_rx] = useState({ "mean": 0, "std": 0, "n": 0, "mae": 0 });
    const [rtt, set_rtt] = useState({ "mean": 0, "max": 0, "min": 0, "jitter": 0, "n": 0, "current": 0 })
    const [lost_packets, set_lost_packets] = useState(0);
    const [out_of_order_packets, set_out_of_order_packets] = useState(0);
    const [rfc2544RateUnit, setRfc2544RateUnit] = useState<"mpps" | "gbit">("mpps");

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
    const rfc2544 = stats.rfc2544;
    const formatGbps = (gbps: number) => formatBits(gbps * 1_000_000_000);
    const rfc2544FrameSizes = rfc2544?.selected_frame_sizes ?? [];
    const rfc2544PortMappings = Object.entries(port_mapping ?? {}).flatMap(([txPort, perChannel]) =>
        Object.entries(perChannel ?? {}).map(([txChannel, target]) => ({
            tx_port: Number(txPort),
            tx_channel: Number(txChannel),
            rx_port: target.port,
            rx_channel: target.channel,
        }))
    );
    const mappingKey = (mapping: Rfc2544PortMapping) =>
        `${mapping.tx_port}/${mapping.tx_channel}/${mapping.rx_port}/${mapping.rx_channel}`;
    const currentMappingKeys = new Set(rfc2544PortMappings.map(mappingKey));
    const resultMappings = rfc2544 ? [
        ...rfc2544.throughput.map((entry) => entry.mapping),
        ...rfc2544.latency.map((entry) => entry.mapping),
        ...rfc2544.reset.map((entry) => entry.mapping),
        ...rfc2544.frame_loss.map((entry) => entry.mapping),
        ...rfc2544.system_recovery.map((entry) => entry.mapping),
    ] : [];
    const baseRfc2544Mappings = rfc2544?.selected_mappings?.length
        ? rfc2544.selected_mappings
        : [...resultMappings, ...rfc2544PortMappings];
    const selectedMappings = is_summary
        ? baseRfc2544Mappings
        : baseRfc2544Mappings.filter((mapping) => currentMappingKeys.has(mappingKey(mapping)));
    const uniqueMappingKeys = new Set<string>();
    const rfc2544Mappings = selectedMappings.filter((mapping) => {
        const key = mappingKey(mapping);
        if (uniqueMappingKeys.has(key)) {
            return false;
        }
        uniqueMappingKeys.add(key);
        return true;
    }).sort((left, right) =>
        left.tx_port - right.tx_port ||
        left.tx_channel - right.tx_channel ||
        left.rx_port - right.rx_port ||
        left.rx_channel - right.rx_channel
    );
    const rfc2544SystemRecovery = rfc2544?.system_recovery ?? [];
    const rfc2544ThroughputSelected = rfc2544 ? (rfc2544.throughput_selected ?? rfc2544.throughput.length > 0) : false;
    const rfc2544LatencySelected = rfc2544 ? (rfc2544.latency_selected ?? rfc2544.latency.length > 0) : false;
    const rfc2544ResetSelected = rfc2544 ? (rfc2544.reset_selected ?? rfc2544.reset.length > 0) : false;
    const rfc2544FrameLossSelected = rfc2544 ? (rfc2544.frame_loss_selected ?? rfc2544.frame_loss.length > 0) : false;
    const rfc2544SystemRecoverySelected = rfc2544 ? (rfc2544.system_recovery_selected ?? rfc2544SystemRecovery.length > 0) : false;
    const formatOptionalGbps = (gbps: number | undefined) => gbps !== undefined ? formatGbps(gbps) : "-";
    const formatThroughputAggregation = (aggregation: string | undefined) => {
        switch (aggregation) {
            case "clustered":
                return "Clustered";
            case "median":
                return "Median";
            case "minimum":
                return "Minimum";
            default:
                return "-";
        }
    };
    const mappingLabel = (mapping: Rfc2544PortMapping) =>
        `${mapping.tx_port}/${mapping.tx_channel} → ${mapping.rx_port}/${mapping.rx_channel}`;
    const mappingMatches = (left: Rfc2544PortMapping | undefined, right: Rfc2544PortMapping) =>
        left !== undefined &&
        left.tx_port === right.tx_port &&
        left.tx_channel === right.tx_channel &&
        left.rx_port === right.rx_port &&
        left.rx_channel === right.rx_channel;
    const frameRateMpps = (gbps: number, frameSize: number) => gbps * 1_000 / ((frameSize + 20) * 8);
    const rfc2544RateUnitLabel = rfc2544RateUnit === "mpps" ? "Mpps" : "Gbit/s";
    const rfc2544RateValue = (gbps: number, frameSize: number) =>
        rfc2544RateUnit === "mpps" ? frameRateMpps(gbps, frameSize) : gbps;
    const formatRfc2544ChartRate = (value: number) =>
        `${value.toFixed(value >= 10 ? 2 : 3)} ${rfc2544RateUnitLabel}`;
    const chartTextColor = typeof document !== "undefined"
        ? getComputedStyle(document.documentElement).getPropertyValue("--color-text").trim() || "#000000"
        : "#000000";
    const rfc2544ThroughputValueLabels = {
        id: `rfc2544ThroughputValueLabels-${rfc2544RateUnit}`,
        afterDatasetsDraw: (chart: any) => {
            const { ctx, data } = chart;
            ctx.save();
            ctx.fillStyle = chartTextColor;
            ctx.font = "12px sans-serif";
            ctx.textAlign = "center";
            ctx.textBaseline = "bottom";
            data.datasets.forEach((dataset: any, datasetIndex: number) => {
                if (datasetIndex === 0) return;
                const meta = chart.getDatasetMeta(datasetIndex);
                meta.data.forEach((point: any, pointIndex: number) => {
                    const value = dataset.data[pointIndex];
                    if (typeof value !== "number" || !Number.isFinite(value)) return;
                    ctx.fillText(formatRfc2544ChartRate(value), point.x, point.y - 8);
                });
            });
            ctx.restore();
        },
    };
    const rfc2544ChartOptions = (xTitle: string, yTitle: string, suggestedMax?: number, linearX = false) => ({
        responsive: true,
        aspectRatio: 4,
        scales: {
            x: {
                type: linearX ? "linear" as const : "category" as const,
                title: {
                    display: true,
                    text: xTitle,
                    color: chartTextColor,
                },
                ticks: {
                    color: chartTextColor,
                },
                grid: {
                    color: "rgba(128, 128, 128, 0.25)",
                },
            },
            y: {
                beginAtZero: true,
                suggestedMax,
                title: {
                    display: true,
                    text: yTitle,
                    color: chartTextColor,
                },
                ticks: {
                    color: chartTextColor,
                },
                grid: {
                    color: "rgba(128, 128, 128, 0.25)",
                },
            },
        },
        plugins: {
            legend: {
                labels: {
                    color: chartTextColor,
                },
            },
        },
    });
    const rfc2544ThroughputChartData = rfc2544 ? {
        labels: rfc2544FrameSizes.map((frameSize) => `${frameSize}`),
        datasets: [
            {
                label: "Theoretical media rate",
                data: rfc2544FrameSizes.map((frameSize) => rfc2544RateValue(rfc2544.line_rate_gbps, frameSize)),
                borderColor: RFC2544_CHART_COLORS[0],
                backgroundColor: "rgba(53, 162, 235, 0.25)",
                tension: 0.2,
            },
            ...rfc2544Mappings.map((mapping, index) => {
                const color = RFC2544_CHART_COLORS[(index + 1) % RFC2544_CHART_COLORS.length];
                return {
                    label: `Measured ${mappingLabel(mapping)}`,
                    data: rfc2544FrameSizes.map((frameSize) => {
                        const row = rfc2544.throughput.find((entry) => entry.frame_size === frameSize && mappingMatches(entry.mapping, mapping));
                        return row ? rfc2544RateValue(row.zero_loss_rate_gbps, frameSize) : null;
                    }),
                    borderColor: color,
                    backgroundColor: `${color.replace("rgb", "rgba").replace(")", ", 0.25)")}`,
                    tension: 0.2,
                    pointRadius: 5,
                    pointHoverRadius: 7,
                    pointBorderWidth: 2,
                };
            }),
        ],
    } : undefined;
    const rfc2544FrameLossChartData = rfc2544 ? {
        datasets: rfc2544Mappings.flatMap((mapping, mappingIndex) => rfc2544FrameSizes.map((frameSize, frameSizeIndex) => {
            const index = mappingIndex * rfc2544FrameSizes.length + frameSizeIndex;
            const color = RFC2544_CHART_COLORS[index % RFC2544_CHART_COLORS.length];
            return {
                label: `${mappingLabel(mapping)} ${frameSize} B`,
                data: RFC2544_FRAME_LOSS_GRAPH_STEPS.map((offeredPercent) => {
                    const x = rfc2544RateValue(rfc2544.line_rate_gbps * offeredPercent / 100, frameSize);
                    if (offeredPercent === 0) return { x, y: 0 };
                    const row = rfc2544.frame_loss.find((entry) =>
                        entry.frame_size === frameSize &&
                        entry.offered_percent === offeredPercent &&
                        mappingMatches(entry.mapping, mapping)
                    );
                    return row ? { x, y: row.loss_percentage } : null;
                }).filter((point): point is { x: number, y: number } => point !== null),
                borderColor: color,
                backgroundColor: `${color.replace("rgb", "rgba").replace(")", ", 0.25)")}`,
                tension: 0.2,
            };
        })),
    } : undefined;
    const renderRfc2544RateUnitToggle = (idSuffix: string) => (
        <div className="d-flex justify-content-end align-items-center gap-2 mt-2">
            <span className="small text-muted">Rate unit</span>
            <ButtonGroup size="sm">
                <ToggleButton
                    id={`rfc2544-rate-unit-mpps-${idSuffix}`}
                    type="radio"
                    variant={rfc2544RateUnit === "mpps" ? "primary" : "outline-secondary"}
                    name="rfc2544-rate-unit"
                    value="mpps"
                    checked={rfc2544RateUnit === "mpps"}
                    onChange={() => setRfc2544RateUnit("mpps")}
                >
                    Mpps
                </ToggleButton>
                <ToggleButton
                    id={`rfc2544-rate-unit-gbit-${idSuffix}`}
                    type="radio"
                    variant={rfc2544RateUnit === "gbit" ? "primary" : "outline-secondary"}
                    name="rfc2544-rate-unit"
                    value="gbit"
                    checked={rfc2544RateUnit === "gbit"}
                    onChange={() => setRfc2544RateUnit("gbit")}
                >
                    Gbit/s
                </ToggleButton>
            </ButtonGroup>
        </div>
    );

    const generalStatsView = <>
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
    </>;

    const rfc2544ThroughputView = rfc2544 && rfc2544ThroughputSelected ?
        <Row className="mt-3">
            <Col className="col-12">
                {renderRfc2544RateUnitToggle("throughput")}
            </Col>
            <Col className="col-12">
                {rfc2544ThroughputChartData ?
                    <Line
                        key={`rfc2544-throughput-${rfc2544RateUnit}`}
                        options={rfc2544ChartOptions("Frame size (bytes)", rfc2544RateUnitLabel)}
                        data={rfc2544ThroughputChartData}
                        plugins={[rfc2544ThroughputValueLabels]}
                    />
                    : null}
            </Col>
            <Col className={"col-12 col-md-6"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <Rfc2544Caption className="caption-top fw-semibold">
                        RFC2544 Zero Loss Throughput&nbsp;
                        <InfoBox>
                            <>
                                <h5>Zero Loss Throughput</h5>
                                <p>RFC2544 defines throughput as the fastest offered rate where the DUT forwards all test frames without loss. P4TG records this per configured frame size.</p>
                            </>
                        </InfoBox>
                    </Rfc2544Caption>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Mapping</th>
                            <th>Frame Size</th>
                            <th>Zero Loss Throughput</th>
                            <th>First Loss Rate</th>
                            <th>Lost Frames</th>
                            <th>Aggregation</th>
                            <th>Repetitions</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rfc2544Mappings.flatMap((mapping) => rfc2544FrameSizes.map((frameSize) => {
                            const row = rfc2544.throughput.find((entry) => entry.frame_size === frameSize && mappingMatches(entry.mapping, mapping));
                            return <tr key={`throughput-${mappingLabel(mapping)}-${frameSize}`}>
                                <td>{mappingLabel(mapping)}</td>
                                <td>{frameSize} B</td>
                                <td>{formatOptionalGbps(row?.zero_loss_rate_gbps)}</td>
                                <td>{formatOptionalGbps(row?.first_loss_rate_gbps)}</td>
                                <td>{row ? formatFrameCount(row.lost_frames) : "-"}</td>
                                <td>{formatThroughputAggregation(row?.aggregation)}</td>
                                <td>{row?.repetition_count ?? "-"}</td>
                            </tr>
                        }))}
                    </tbody>
                </Table>
            </Col>
            {rfc2544.throughput.some((row) => (row.repetitions ?? []).length > 1) ?
                <Col className={"col-12 col-md-6"}>
                    <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                        <Rfc2544Caption className="caption-top fw-semibold">
                            RFC2544 ZLT Repetitions&nbsp;
                            <InfoBox>
                                <>
                                    <h5>ZLT Repetitions</h5>
                                    <p>Repeated zero-loss throughput runs are aggregated into the reported value. Clustered mode groups rates within the configured Gbit/s tolerance and uses the largest stable group.</p>
                                </>
                            </InfoBox>
                        </Rfc2544Caption>
                        <thead className={"table-dark"}>
                            <tr>
                                <th>Mapping</th>
                                <th>Frame Size</th>
                                <th>Rep.</th>
                                <th>ZLT</th>
                                <th>First Loss</th>
                                <th>Lost Frames</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rfc2544Mappings.flatMap((mapping) => rfc2544FrameSizes.flatMap((frameSize) => {
                                const row = rfc2544.throughput.find((entry) => entry.frame_size === frameSize && mappingMatches(entry.mapping, mapping));
                                const repetitions = row?.repetitions ?? [];
                                if (repetitions.length <= 1) {
                                    return [];
                                }
                                return repetitions.map((repetition) => (
                                    <tr key={`throughput-repetition-${mappingLabel(mapping)}-${frameSize}-${repetition.repetition}`}>
                                        <td>{mappingLabel(mapping)}</td>
                                        <td>{frameSize} B</td>
                                        <td>{repetition.repetition}</td>
                                        <td>{formatOptionalGbps(repetition.zero_loss_rate_gbps)}</td>
                                        <td>{formatOptionalGbps(repetition.first_loss_rate_gbps)}</td>
                                        <td>{formatFrameCount(repetition.lost_frames)}</td>
                                    </tr>
                                ));
                            }))}
                        </tbody>
                    </Table>
                </Col>
                : null}
        </Row>
        : null;

    const rfc2544LatencyView = rfc2544 && rfc2544LatencySelected ?
        <Row className="mt-3">
            <Col className={"col-12"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <Rfc2544Caption className="caption-top fw-semibold">
                        <OverlayTrigger
                            placement="top"
                            overlay={(props) => renderTooltip(props, "Latency values are sampled from P4TG RTT/2 measurements. Sampled values may miss short-lived variation and may not be 100% accurate.")}
                        >
                            <span className="text-decoration-underline">RFC2544 Latency</span>
                        </OverlayTrigger>
                        &nbsp;
                        <InfoBox>
                            <>
                                <h5>Latency</h5>
                                <p>RFC2544 runs latency at the previously determined throughput rate for each frame size. P4TG reports latency as one half of the measured RTT.</p>
                            </>
                        </InfoBox>
                    </Rfc2544Caption>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Mapping</th>
                            <th>Frame Size</th>
                            <th>Rate</th>
                            <th><Overline>Latency</Overline></th>
                            <th>Min</th>
                            <th>Max</th>
                            <th>Jitter</th>
                            <th>Samples</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rfc2544Mappings.flatMap((mapping) => rfc2544FrameSizes.map((frameSize) => {
                            const row = rfc2544.latency.find((entry) => entry.frame_size === frameSize && mappingMatches(entry.mapping, mapping));
                            return <tr key={`latency-${mappingLabel(mapping)}-${frameSize}`}>
                                <td>{mappingLabel(mapping)}</td>
                                <td>{frameSize} B</td>
                                <td>{formatOptionalGbps(row?.rate_gbps)}</td>
                                <td>{row ? formatNanoSeconds(row.mean_latency_ns) : "-"}</td>
                                <td>{row ? formatNanoSeconds(row.min_latency_ns) : "-"}</td>
                                <td>{row ? formatNanoSeconds(row.max_latency_ns) : "-"}</td>
                                <td>{row ? formatNanoSeconds(row.jitter_ns) : "-"}</td>
                                <td>{row ? row.samples : "-"}</td>
                            </tr>
                        }))}
                    </tbody>
                </Table>
            </Col>
        </Row>
        : null;

    const rfc2544ResetView = rfc2544 && rfc2544ResetSelected ?
        <Row className="mt-3">
            <Col className={"col-12"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <Rfc2544Caption className="caption-top fw-semibold">
                        RFC2544 Reset&nbsp;
                        <InfoBox>
                            <>
                                <h5>Reset</h5>
                                <p>RFC2544 reset time measures the interval between the last frame before reset and the first forwarded frame after recovery. P4TG observes this as the RX outage duration.</p>
                            </>
                        </InfoBox>
                    </Rfc2544Caption>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Mapping</th>
                            <th>Frame Size</th>
                            <th>Rate</th>
                            <th>Reset Time</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rfc2544Mappings.flatMap((mapping) => rfc2544FrameSizes.map((frameSize) => {
                            const row = rfc2544.reset.find((entry) => entry.frame_size === frameSize && mappingMatches(entry.mapping, mapping));
                            return <tr key={`reset-${mappingLabel(mapping)}-${frameSize}`}>
                                <td>{mappingLabel(mapping)}</td>
                                <td>{frameSize} B</td>
                                <td>{formatOptionalGbps(row?.rate_gbps)}</td>
                                <td>{row?.reset_time_ms !== undefined ? formatNanoSeconds(row.reset_time_ms * 1_000_000) : "-"}</td>
                                <td>{row?.status ?? (rfc2544.running ? "Pending" : "Not run")}</td>
                            </tr>
                        }))}
                    </tbody>
                </Table>
            </Col>
        </Row>
        : null;

    const rfc2544FrameLossView = rfc2544 && rfc2544FrameLossSelected ?
        <Row className="mt-3">
            <Col className="col-12">
                {renderRfc2544RateUnitToggle("frame-loss")}
            </Col>
            <Col className="col-12">
                {rfc2544FrameLossChartData ?
                    <Line
                        key={`rfc2544-frame-loss-${rfc2544RateUnit}`}
                        options={rfc2544ChartOptions(`Offered rate (${rfc2544RateUnitLabel})`, "Frame loss (%)", 100, true)}
                        data={rfc2544FrameLossChartData}
                    />
                    : null}
            </Col>
            <Col className={"col-12"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <Rfc2544Caption className="caption-top fw-semibold">
                        RFC2544 Frame Loss Rate&nbsp;
                        <InfoBox>
                            <>
                                <h5>Frame Loss Rate</h5>
                                <p>RFC2544 starts frame loss at 100% of the maximum rate, then reduces offered load in 10% steps until two successive trials complete without loss.</p>
                            </>
                        </InfoBox>
                    </Rfc2544Caption>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Mapping</th>
                            <th>Frame Size</th>
                            {RFC2544_FRAME_LOSS_STEPS.map((offeredPercent) => (
                                <th key={`frame-loss-header-${offeredPercent}`} className="text-nowrap">
                                    {offeredPercent} %
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {rfc2544Mappings.flatMap((mapping) => rfc2544FrameSizes.map((frameSize) => (
                            <tr key={`frame-loss-${mappingLabel(mapping)}-${frameSize}`}>
                                <td>{mappingLabel(mapping)}</td>
                                <td>{frameSize} B</td>
                                {RFC2544_FRAME_LOSS_STEPS.map((offeredPercent) => {
                                    const row = rfc2544.frame_loss.find((entry) =>
                                        entry.frame_size === frameSize &&
                                        entry.offered_percent === offeredPercent &&
                                        mappingMatches(entry.mapping, mapping)
                                    );
                                    const rate = formatGbps(rfc2544.line_rate_gbps * offeredPercent / 100);
                                    const tooltip = row
                                        ? `Rate: ${rate}; TX: ${formatFrameCount(row.tx_frames)}; RX: ${formatFrameCount(row.rx_frames)}; Lost: ${formatFrameCount(row.lost_frames)}`
                                        : `${rfc2544.running ? "Pending" : "Not run or skipped after two zero-loss trials"} at ${rate}`;

                                    return <td key={`frame-loss-${frameSize}-${offeredPercent}`}>
                                        <OverlayTrigger
                                            placement="top"
                                            overlay={(props) => renderTooltip(props, tooltip)}
                                        >
                                            <span>{row ? `${row.loss_percentage.toFixed(4)} %` : "-"}</span>
                                        </OverlayTrigger>
                                    </td>
                                })}
                            </tr>
                        )))}
                    </tbody>
                </Table>
            </Col>
        </Row>
        : null;

    const rfc2544SystemRecoveryView = rfc2544 && rfc2544SystemRecoverySelected ?
        <Row className="mt-3">
            <Col className={"col-12"}>
                <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
                    <Rfc2544Caption className="caption-top fw-semibold">
                        RFC2544 System Recovery&nbsp;
                        <InfoBox>
                            <>
                                <h5>System Recovery</h5>
                                <p>RFC2544 sends traffic at 110% of the measured throughput, capped by line rate, then reduces to 50% of throughput. P4TG uses non-overlapping square-wave streams and reports when post-reduction loss stops.</p>
                                <p>Recovery time is based on controller-observed samples. The coarse sampling interval can shift the reported value by up to about one second.</p>
                            </>
                        </InfoBox>
                    </Rfc2544Caption>
                    <thead className={"table-dark"}>
                        <tr>
                            <th>Mapping</th>
                            <th>Frame Size</th>
                            <th>Throughput</th>
                            <th>Overload</th>
                            <th>Recovery Rate</th>
                            <th>
                                <OverlayTrigger
                                    placement="top"
                                    overlay={(props) => renderTooltip(props, "Recovery time is sampled coarsely; the controller sampling interval can shift this value by up to about one second.")}
                                >
                                    <span className="text-decoration-underline">Recovery Time</span>
                                </OverlayTrigger>
                            </th>
                            <th>Lost After Reduction</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rfc2544Mappings.flatMap((mapping) => rfc2544FrameSizes.map((frameSize) => {
                            const row = rfc2544SystemRecovery.find((entry) => entry.frame_size === frameSize && mappingMatches(entry.mapping, mapping));
                            return <tr key={`system-recovery-${mappingLabel(mapping)}-${frameSize}`}>
                                <td>{mappingLabel(mapping)}</td>
                                <td>{frameSize} B</td>
                                <td>{formatOptionalGbps(row?.throughput_rate_gbps)}</td>
                                <td>{formatOptionalGbps(row?.overload_rate_gbps)}</td>
                                <td>{formatOptionalGbps(row?.recovery_rate_gbps)}</td>
                                <td>{row?.recovery_time_ms !== undefined ? formatNanoSeconds(row.recovery_time_ms * 1_000_000) : "-"}</td>
                                <td>{row ? formatFrameCount(row.lost_frames_after_reduction) : "-"}</td>
                                <td>{row ? `${row.recovered ? "Recovered" : "Not confirmed"} - ${row.status}` : (rfc2544.running ? "Pending" : "Not run")}</td>
                            </tr>
                        }))}
                    </tbody>
                </Table>
            </Col>
        </Row>
        : null;

    if (rfc2544) {
        return <Tabs defaultActiveKey="general" className="mt-3">
            <Tab eventKey="general" title="General stats">
                {generalStatsView}
            </Tab>
            {rfc2544ThroughputView ? <Tab eventKey="throughput" title="Throughput">{rfc2544ThroughputView}</Tab> : null}
            {rfc2544LatencyView ? <Tab eventKey="latency" title="Latency">{rfc2544LatencyView}</Tab> : null}
            {rfc2544ResetView ? <Tab eventKey="reset" title="Reset">{rfc2544ResetView}</Tab> : null}
            {rfc2544FrameLossView ? <Tab eventKey="frame-loss" title="Frame loss">{rfc2544FrameLossView}</Tab> : null}
            {rfc2544SystemRecoveryView ? <Tab eventKey="system-recovery" title="System recovery">{rfc2544SystemRecoveryView}</Tab> : null}
        </Tabs>
    }

    return generalStatsView;
}

export default StatView
