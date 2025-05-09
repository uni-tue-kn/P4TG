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
    Tooltip,
    Filler,
    Legend, ArcElement,
    BarElement,
    ChartDataset,
} from 'chart.js'
import annotationPlugin from 'chartjs-plugin-annotation';

import {Doughnut, Line, Chart} from 'react-chartjs-2'
import {secondsToTime} from "./SendReceiveMonitor";
import {Statistics, TimeStatistics} from "../common/Interfaces";
import React, {useState} from "react";
import {Col, Form, Row } from 'react-bootstrap';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    ArcElement,
    LineElement,
    BarElement,
    Title,
    Tooltip,
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

function getTimeUnit(value: number): [value: number, unit: string]{
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

const generateLineData = (data_key: string, use_key: boolean, data: TimeStatistics, port_mapping: { [name: number]: number }): [string[], number[]] => {
    let cum_data: {[name: number]: number}[] = []

    if(data_key in data) {
        if(use_key) {
            Object.keys(port_mapping).map(v => {
                // @ts-ignore
                if (v in data[data_key]) {
                    // @ts-ignore
                    cum_data.push(data[data_key][v])
                }
            })
        }
        else {
            Object.values(port_mapping).map(v => {
                // @ts-ignore
                if (v in data[data_key]) {
                    // @ts-ignore
                    cum_data.push(data[data_key][v])
                }
            })
        }
    }

    let ret_data = cum_data.reduce((acc, current) => {
        const key = Object.keys(current)
        const found = Object.keys(acc)

        key.forEach(k => {
            if(Object.keys(acc).includes(k)) {
                // @ts-ignore
                acc[k] += current[k]
            }
            else {
                // @ts-ignore
                acc[k] = current[k]
            }
        })

        return acc
    }, {})

    return [Object.keys(ret_data).map(v => secondsToTime(parseInt(v))), Object.values(ret_data)]
}

const generateHistogram = (
    data: Statistics,
    port_mapping: { [name: number]: number }
): [string[], number[]] => {
    const histogram_data = data["rtt_histogram"];
    let combined_bins: { [binIndex: string]: number } = {};
    let min = Infinity;
    let max = -Infinity;
    let num_bins = 0;

    if (histogram_data) {
        const ports = Object.values(port_mapping).map(String);
        ports.forEach(port => {
            
            const config = histogram_data[port]?.config;
            const data = histogram_data[port]?.data;
            if (config && data) {
                min = Math.min(min, config.min);
                max = Math.max(max, config.max);
                num_bins = config.num_bins;

                for (let i = 0; i < config.num_bins; i++) {
                    const binKey = i.toString();
                    const value = data.data_bins[binKey] || 0;
                    combined_bins[binKey] = (combined_bins[binKey] || 0) + value;
                }
            }
        });
    }

    if (min === Infinity || max === -Infinity || num_bins === 0) {
        return [[], []]; // no valid data
    }

    const binWidth = (max - min) / num_bins;
    const labels: string[] = [];
    const values: number[] = [];

    for (let i = 0; i < num_bins; i++) {
        const start = Math.round(min + i * binWidth);
        let [start_val, start_unit] = getTimeUnit(start);
        const end = Math.round(min + (i + 1) * binWidth);

        let [end_val, _] = getTimeUnit(end);
        labels.push(`${start_val}-${end_val} ${start_unit}`);
        values.push(combined_bins[i.toString()] || 0);
    }

    return [labels, values];
};

const getPercentileAnnotations = (
    data: Statistics,
    port_mapping: { [name: number]: number }
): [Record<string, any>, ChartDataset[]] => {
    const annotations: Record<string, any> = {};
    const legend_dataset: ChartDataset[] = [];

    // Avoids redundant percentile labels from different ports
    const seenPercentiles = new Set<string>();

    const histogram = data["rtt_histogram"];

    const percentileColors: Record<string, string> = {
        '25': '#3c82e7',
        '50': '#e74c3c',
        '75': '#e7a23c',
        '90': '#a23ce7',
    };

    if (histogram) {
        const ports = Object.values(port_mapping).map(String);

        ports.forEach(port => {
            const config = histogram[port]?.config;
            const data = histogram[port]?.data;            
            if (config && data) {

                const percentile_data = data.percentiles;

                Object.entries(percentile_data).forEach(([key, value]) => {
                    const binWidth = (config.max - config.min) / config.num_bins;
                    const binIndex = Math.floor((value - config.min) / binWidth);

                    const color = percentileColors[key] || 'gray';

                    if (value != null) {
                        annotations[`p${key}`] = {
                            type: 'line',
                            scaleID: 'x',
                            value: binIndex,
                            borderColor: color,
                            borderWidth: 2,
                            borderDash: [6, 6],
                        };

                        if (!seenPercentiles.has(key)) {
                            seenPercentiles.add(key);
                            // Push an invisible data point so we can render a legend in the chart
                            legend_dataset.push({
                                label: `${key}th percentile`,
                                data: [{ x: binIndex, y: 0 }],
                                borderColor: color,
                                borderDash: [6, 6],
                                pointRadius: 0,
                                fill: false,
                                type: 'line',
                                tension: 0,
                                showLine: true,
                                borderWidth: 2,
                            });                              
                        }                     
                    }
                });


            }
        });
    }

    return [annotations, legend_dataset];
};

const get_frame_types = (stats: Statistics, port_mapping: {[name: number]: number}, type: string): { tx: number, rx: number } => {
    let ret = { "tx": 0, "rx": 0 }

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

const get_frame_stats = (stats: Statistics, port_mapping: {[name: number]: number}, type: string, low: number, high: number) => {
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

const get_rtt = (data: TimeStatistics, port_mapping: {[name: number]: number}): [string[], number[]] => {
    let cum_data: {[name: number]: number}[] = []

    if("rtt" in data) {
        Object.values(port_mapping).map(v => {
            // @ts-ignore
            if (v in data["rtt"]) {
                // @ts-ignore
                cum_data.push(data["rtt"][v])
            }
        })
    }

    let ret_data = cum_data.reduce((acc, current) => {
        const key = Object.keys(current)

        key.forEach(k => {
            if(Object.keys(acc[0]).includes(k)) {
                // @ts-ignore
                acc[0][k] += current[k]
                // @ts-ignore
                acc[1][k] += 1
            }
            else {
                // @ts-ignore
                acc[0][k] = current[k]
                // @ts-ignore
                acc[1][k] = 1
            }
        })

        return acc
    }, [{}, {}])

    Object.keys(ret_data[0]).forEach (v => {
        // @ts-ignore
        ret_data[0][v] = ret_data[0][v] / ret_data[1][v]
    })

    return [Object.keys(ret_data[0]).map(v => secondsToTime(parseInt(v))), Object.values(ret_data[0])]
}

const Visuals = ({data, stats, port_mapping}: {data: TimeStatistics, stats: Statistics, port_mapping: { [name: number]: number }}) => {
    const [labels_tx, line_data_tx] = generateLineData("tx_rate_l1", true, data, port_mapping)
    const [labels_rx, line_data_rx] = generateLineData("rx_rate_l1", false, data, port_mapping)
    const [labels_loss, line_data_loss] = generateLineData("packet_loss", false, data, port_mapping)
    const [labels_out_of_order, line_data_out_of_order] = generateLineData("out_of_order", false, data, port_mapping)
    const [labels_rtt, line_data_rtt] = get_rtt(data, port_mapping)
    const [labels_rtt_hist, hist_data_rtt] = generateHistogram(stats, port_mapping);
    const [percentileAnnotations, legend_dataset] = getPercentileAnnotations(stats, port_mapping);

    const [visual_select, set_visual_select] = useState("rate")

    const rate_data = {
        labels: labels_tx,
        datasets: [
            {
                fill: true,
                label: 'TX rate',
                data: line_data_tx.map(val => val * 10**-9),
                borderColor: 'rgb(53, 162, 235)',
                backgroundColor: 'rgba(53, 162, 235, 0.5)',
            },
            {
                fill: true,
                label: 'RX rate',
                data: line_data_rx.map(val => val * 10**-9),
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
                data: line_data_rtt.map(val => val * 10**-3),
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
                    get_frame_types(stats, port_mapping, "arp").tx,
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

    const rtt_hist_data = {
        labels: labels_rtt_hist,
        datasets: [
            {
                label: 'RTT distribution',
                data: hist_data_rtt,
                backgroundColor: 'rgba(53, 162, 235, 0.5)'                     
            },
            ...legend_dataset
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
                    text: '#Packets'
                }
            },
            x: {
                title: {
                    display: true,
                    text: 'RTT Range (μs)'
                }
            }
        },
        plugins: {
            legend: {
                display: true,
            },
            annotation: {
                annotations: percentileAnnotations
            }
        },
    };    

    // @ts-ignore
    return <>
        {visual_select == "rate" ?
            <Line options={rate_options} data={rate_data}/>
            :
            null
        }

        {visual_select == "loss" ?
            <Line options={loss_options} data={loss_data}/>
            :
            null
        }

        {visual_select == "frame" ?
            <Row>
                <Col className={"col-4"}>
                    <Doughnut data={frame_type_data} options={frame_options} title={"Frame types"}/>
                </Col>
                <Col className={"col-4"}>
                    <Doughnut data={ethernet_type_data} options={frame_options}/>
                </Col>
                <Col className={"col-4"}>
                    <Doughnut data={frame_size_data} options={frame_options}/>
                </Col>
            </Row>
            :
            null
        }

        {visual_select == "rtt" ?
            <Line options={rtt_options} data={rtt_data}/>
            :
            null
        }

        {visual_select == "rtt_histogram" ?
            <Chart type="bar" options={rtt_histogram_options} data={rtt_hist_data} /> 
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
                <Form.Check
                    inline
                    label="RTT Histogram"
                    type="radio"
                    name={"visuals"}
                    checked={visual_select == "rtt_histogram"}
                    id={`rtt_histogram`}
                />                
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