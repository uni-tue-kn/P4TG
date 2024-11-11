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
import {Button, Col, Form, Row, Tab, Tabs} from 'react-bootstrap'
import {del, get, post} from "../common/API";
import SendReceiveMonitor from "../components/SendReceiveMonitor";
import StatView from "../components/StatView";
import Loader from "../components/Loader";

import {
    ASIC,
    Encapsulation,
    GenerationMode,
    P4TGInfos,
    Statistics as StatInterface,
    StatisticsObject,
    Stream,
    StreamSettings,
    TimeStatistics,
    TimeStatisticsObject
} from '../common/Interfaces'
import styled from "styled-components";
import StreamView from "../components/StreamView";

styled(Row)`
    display: flex;
    align-items: center;
`;
styled(Col)`
    padding-left: 0;
`;
const StyledLink = styled.a`
    color: var(--color-secondary);
    text-decoration: none;
    opacity: 0.5;

    :hover {
        opacity: 1;
        color: var(--color-primary);
    }
`


export const GitHub = () => {
    return <Row className="mt-2">
        <Col className="text-center col-12 mt-3">
            <StyledLink href="https://github.com/uni-tue-kn/P4TG" target="_blank">P4TG @ <i
                className="bi bi-github"></i></StyledLink>
        </Col>
    </Row>
}

const Home = ({p4tg_infos} : {p4tg_infos: P4TGInfos}) => {
    const [loaded, set_loaded] = useState(false)
    const [overlay, set_overlay] = useState(false)
    const [running, set_running] = useState(false)
    const [visual, set_visual] = useState(true)

    // @ts-ignore
    const [streams, set_streams] = useState<Stream[]>(JSON.parse(localStorage.getItem("streams")) || [])
    // @ts-ignore
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(JSON.parse(localStorage.getItem("streamSettings")) || [])
    const [mode, set_mode] = useState(parseInt(localStorage.getItem("gen-mode") || String(GenerationMode.NONE)))

    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<{ [name: number]: number }>(JSON.parse(localStorage.getItem("port_tx_rx_mapping")) || {})
    const [statistics, set_statistics] = useState<StatInterface>(StatisticsObject)
    const [time_statistics, set_time_statistics] = useState<TimeStatistics>(TimeStatisticsObject)

    useEffect(() => {
        refresh()

        const interval_stats = setInterval(async () => await Promise.all([loadStatistics()]), 500);
        const interval_loadgen = setInterval(async () => await Promise.all([loadGen()]), 5000);
        const inverval_timestats = setInterval(async () => await Promise.all([loadTimeStatistics()]), 2000);

        return () => {
            clearInterval(interval_stats)
            clearInterval(interval_loadgen)
            clearInterval(inverval_timestats)
        }

    }, [])

    const activePorts = (): { "tx": number, "rx": number }[] => {
        let active_ports: { tx: number, rx: number }[] = []
        let exists: number[] = []

        Object.keys(port_tx_rx_mapping).forEach((tx_port: string) => {
            let port = parseInt(tx_port)
            exists.push(port)
            active_ports.push({tx: port, rx: port_tx_rx_mapping[port]})
        })

        return active_ports
    }

    const getStreamIDsByPort = (pid: number): number[] => {
        let ret: number[] = []

        stream_settings.forEach(v => {
            if (v.port == pid && v.active) {
                streams.forEach(s => {
                    if (s.stream_id == v.stream_id) {
                        ret.push(s.app_id)
                        return
                    }
                })
            }
        })

        return ret
    }

    const getStreamFrameSize = (stream_id: number): number => {
        let ret = 0

        streams.forEach(v => {
            if (v.app_id == stream_id) {
                ret = v.frame_size
                if (v.encapsulation == Encapsulation.Q) {
                    ret += 4
                } else if (v.encapsulation == Encapsulation.QinQ) {
                    ret += 8
                }
                else if (v.encapsulation == Encapsulation.MPLS) {
                    ret += v.number_of_lse * 4 // 4 bytes per LSE
                }

                if (v.vxlan) {
                    ret += 50 // 50 bytes overhead
                }

                return
            }
        })

        return ret
    }


    const refresh = async () => {
        await loadGen()
        await loadStatistics()
        set_loaded(true)
    }

    const onSubmit = async (event: any) => {
        event.preventDefault()

        let max_rate = 100;

        if(p4tg_infos.asic == ASIC.Tofino2) {
            max_rate = 400;
        }

        set_overlay(true)

        if (running) {
            await del({route: "/trafficgen"})
            set_running(false)
        } else {
            if (streams.length === 0 && mode != GenerationMode.ANALYZE) {
                alert("You need to define at least one stream.")
            } else {
                let overall_rate = 0
                streams.forEach((v) => {
                    overall_rate += v.traffic_rate
                })

                if (mode != GenerationMode.MPPS && overall_rate > max_rate) {
                    alert("Sum of stream rates > " + max_rate + " Gbps!")
                } else {
                    await post({
                        route: "/trafficgen",
                        body: {
                            "streams": streams,
                            "stream_settings": stream_settings,
                            "port_tx_rx_mapping": port_tx_rx_mapping,
                            "mode": mode,
                        }
                    })

                    set_running(true)
                }
            }
        }
        set_overlay(false)
    }

    const loadStatistics = async () => {
        let stats = await get({route: "/statistics"})

        if (stats != undefined && stats.status === 200) {
            set_statistics(stats.data)
        }
    }

    const loadTimeStatistics = async () => {
        let stats = await get({route: "/time_statistics?limit=100"})

        if (stats != undefined && stats.status === 200) {
            set_time_statistics(stats.data)
        }
    }


    const loadGen = async () => {
        let stats = await get({route: "/trafficgen"})

        if (stats != undefined && Object.keys(stats.data).length > 1) {
            set_mode(stats.data.mode)
            set_port_tx_rx_mapping(stats.data.port_tx_rx_mapping)
            set_stream_settings(stats.data.stream_settings)
            set_streams(stats.data.streams)

            localStorage.setItem("streams", JSON.stringify(stats.data.streams))
            localStorage.setItem("gen-mode", String(stats.data.mode))
            localStorage.setItem("streamSettings", JSON.stringify(stats.data.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(stats.data.port_tx_rx_mapping))

            //set_streams(stats.data.streams)
            set_running(true)
        } else {
            set_running(false)
        }
    }


    const reset = async () => {
        set_overlay(true)
        await get({route: "/reset"})
        set_overlay(false)
    }

    const restart = async () => {
        set_overlay(true)
        await get({route: "/restart"})
        set_overlay(false)
    }

    return <Loader loaded={loaded} overlay={overlay}>
        <form onSubmit={onSubmit}>
            <Row className={"mb-3"}>
                <SendReceiveMonitor stats={statistics} running={running}/>
                <Col className={"text-end col-4"}>
                    {running ?
                        <>
                            <Button type={"submit"} className="mb-1" variant="danger"><i
                                className="bi bi-stop-fill"/> Stop</Button>
                            {" "}
                            <Button onClick={restart} className="mb-1" variant="primary"><i
                                className="bi bi-arrow-clockwise"/> Restart </Button>
                        </>
                        :
                        <>
                            <Button type={"submit"} className="mb-1" variant="primary"><i
                                className="bi bi-play-circle-fill"/> Start </Button>
                            {" "}
                            <Button onClick={reset} className="mb-1" variant="warning"><i
                                className="bi bi-trash-fill"/> Reset </Button>
                        </>
                    }
                </Col>

            </Row>
        </form>

        <Form>
            <Form.Check // prettier-ignore
                type="switch"
                id="custom-switch"
                checked={visual}
                onClick={() => set_visual(!visual)}
                label="Visualization"
            />
        </Form>

        <Tabs
            defaultActiveKey="Summary"
            className="mt-3"
        >
            <Tab eventKey="Summary" title="Summary">
                <StatView stats={statistics} time_stats={time_statistics} port_mapping={port_tx_rx_mapping} visual={visual} mode={mode}/>
            </Tab>
            {activePorts().map((v, i) => {
                let mapping: { [name: number]: number } = {[v.tx]: v.rx}
                return <Tab eventKey={i} key={i} title={v.tx + " → " + v.rx}>
                    <Tabs
                        defaultActiveKey={"Overview"}
                        className={"mt-3"}
                    >
                        <Tab eventKey={"Overview"} title={"Overview"}>
                            <StatView stats={statistics} time_stats={time_statistics} port_mapping={mapping} mode={mode} visual={visual}/>
                        </Tab>
                        {Object.keys(mapping).map(Number).map(v => {
                            let stream_ids = getStreamIDsByPort(v)

                            return stream_ids.map((stream: number, i) => {
                                let stream_frame_size = getStreamFrameSize(stream)
                                return <Tab key={i} eventKey={stream} title={"Stream " + stream}>
                                    <StreamView stats={statistics} port_mapping={mapping} stream_id={stream}
                                                frame_size={stream_frame_size}/>
                                </Tab>
                            })
                        })}

                    </Tabs>

                </Tab>
            })}

        </Tabs>

        <GitHub/>


    </Loader>
}

export default Home