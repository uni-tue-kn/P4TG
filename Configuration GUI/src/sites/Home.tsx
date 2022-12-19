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
import {Button, Col, Form, InputGroup, Modal, Row, Tab, Tabs, Table} from 'react-bootstrap'
import {del, get, post} from "../common/API";
import SendReceiveMonitor, {formatBits} from "../components/SendReceiveMonitor";
import StatView from "../components/StatView";
import Loader from "../components/Loader";

import {
    DefaultStream,
    Statistics as StatInterface,
    StatisticsObject,
    Stream,
    StreamSettings
} from '../common/Interfaces'
import styled from "styled-components";
import StreamView from "../components/StreamView";

const StyledRow = styled(Row)`
  display: flex;
  align-items: center;
`

const StyledCol = styled(Col)`
  padding-left: 0;
`



const Home = () => {
    const [loaded, set_loaded] = useState(false)
    const [running, set_running] = useState(false)
    // @ts-ignore
    const [streams, set_streams] = useState<Stream[]>(JSON.parse(localStorage.getItem("streams")) || [])
    // @ts-ignore
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(JSON.parse(localStorage.getItem("streamSettings")) || [])
    const [mode, set_mode] = useState(localStorage.getItem("gen-mode") || "")

    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<{[name: number]: number}>(JSON.parse(localStorage.getItem("port_tx_rx_mapping")) || {})
    const [statistics, set_statistics] = useState<StatInterface>(StatisticsObject)

    const [startTime, set_start_time] = useState(0)

    useEffect(() => {
        refresh()

        setInterval(loadStatistics, 500);
        setInterval(loadGen, 2000);

    }, [])

    const activePorts = () : {"tx": number, "rx": number}[] => {
        let active_ports: {tx: number, rx: number}[] = []
        let exists: number[] = []

        stream_settings.forEach(v => {
            if(v.active) {
                if(!exists.includes(v.port)) {
                    exists.push(v.port)
                    // @ts-ignore
                    active_ports.push({tx: v.port, rx: parseInt(port_tx_rx_mapping[v.port])})
                }

            }
        })


        return active_ports
    }

    const getStreamIDsByPort = (pid: number) : number[] => {
        let ret: number[] = []

        stream_settings.forEach(v => {
            if(v.port == pid && v.active) {
                streams.forEach(s => {
                    if(s.stream_id == v.stream_id) {
                        ret.push(s.app_id)
                        return
                    }
                })
            }
        })

        return ret
    }

    const getStreamFrameSize = (stream_id: number) : number => {
        let ret = 0

        streams.forEach(v => {
            if(v.app_id == stream_id) {
                ret = v.frame_size
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

        if (running) {
            await del({route: "/trafficgen"})
            set_running(false)
            set_start_time(0)
        } else {
            if (streams.length === 0 && mode != "Monitor") {
                alert("You need to define at least one stream.")
            } else {
                let overall_rate = 0
                streams.forEach((v) => {
                    overall_rate += v.traffic_rate
                })

                if (mode != "Mpps" && overall_rate > 100) {
                    alert("Sum of stream rates > 100 Gbps!")
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
                    set_start_time(Date.now())
                }
            }
        }
    }

    const loadStatistics = async () => {
        let stats = await get({route: "/statistics"})

        if (stats.status === 200) {
            set_statistics(stats.data)
        }
    }

    const loadGen = async () => {
        let stats = await get({route: "/trafficgen"})

        if (Object.keys(stats.data).length > 0) {
            set_mode(stats.data.mode)
            set_port_tx_rx_mapping(stats.data.port_mapping)
            set_stream_settings(stats.data.stream_settings)
            set_streams(stats.data.streams)

            localStorage.setItem("streams", JSON.stringify(stats.data.streams))
            localStorage.setItem("gen-mode", stats.data.mode)
            localStorage.setItem("streamSettings", JSON.stringify(stats.data.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(stats.data.port_mapping))

            //set_streams(stats.data.streams)
            set_running(true)
        } else {
            set_running(false)
            set_start_time(0)
        }
    }


    const reset = async () => {
        await get({route: "/reset"})
    }

    return <Loader loaded={loaded}>
        <form onSubmit={onSubmit}>
            <Row className={"mb-3"}>
                <Col className={"text-start"}>
                    {running ?
                        <Button type={"submit"} variant="danger"><i className="bi bi-stop-fill"/> Stop</Button>
                        :
                        <>
                            <Button type={"submit"} variant="primary"><i className="bi bi-play-circle-fill"/> Start </Button>
                            {" "}
                            <Button onClick={reset} variant="warning"><i className="bi bi-trash-fill"/> Reset </Button>
                        </>
                    }
                </Col>

            </Row>
        </form>

        <SendReceiveMonitor stats={statistics} startTime={startTime}/>

        <Tabs
            defaultActiveKey="Summary"
            className="mt-3"
        >
            <Tab eventKey="Summary" title="Summary">
                <StatView stats={statistics} port_mapping={port_tx_rx_mapping}/>
            </Tab>
            {activePorts().map((v, i) => {
                let mapping: {[name: number]: number} = {[v.tx]: v.rx}
                return <Tab eventKey={i} key={i} title={v.tx + "->" + v.rx}>
                    <Tabs
                        defaultActiveKey={"Overview"}
                        className={"mt-3"}
                        >
                        <Tab eventKey={"Overview"} title={"Overview"}>
                            <StatView stats={statistics} port_mapping={mapping}/>
                        </Tab>
                        {Object.keys(mapping).map(Number).map(v => {
                            let stream_ids = getStreamIDsByPort(v)

                            return stream_ids.map((stream: number, i) => {
                                let stream_frame_size = getStreamFrameSize(stream)
                                return <Tab key={i} eventKey={stream} title={"Stream " + stream}>
                                    <StreamView stats={statistics} port_mapping={mapping} stream_id={stream} frame_size={stream_frame_size}/>
                                </Tab>
                            })
                        })}

                    </Tabs>

                </Tab>
            })}

        </Tabs>


    </Loader>
}

export default Home