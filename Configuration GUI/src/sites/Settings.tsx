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

import React, {useEffect, useRef, useState} from 'react'
import {Button, Col, Form, Row, Table} from "react-bootstrap";
import {get} from "../common/API";
import Loader from "../components/Loader";
import {
    DefaultStream,
    DefaultStreamSettings,
    GenerationMode, P4TGInfos,
    Stream,
    StreamSettings, TrafficGenData,
} from "../common/Interfaces";
import styled from "styled-components";
import InfoBox from "../components/InfoBox";

import {GitHub} from "./Home";
import StreamSettingsList from "../components/settings/StreamSettingsList";
import StreamElement from "../components/settings/StreamElement";
import {validateStreams, validateStreamSettings} from "../common/Validators";

export const StyledRow = styled.tr`
    display: flex;
    align-items: center;
`

export const StyledCol = styled.td`
    vertical-align: middle;
    display: table-cell;
    text-indent: 5px;
`


const Settings = ({p4tg_infos}: {p4tg_infos: P4TGInfos}) => {
    const [ports, set_ports] = useState<{
        pid: number,
        port: number,
        channel: number,
        loopback: string,
        status: boolean
    }[]>([])
    const [running, set_running] = useState(false)
    // @ts-ignore
    const [streams, set_streams] = useState<Stream[]>(JSON.parse(localStorage.getItem("streams")) || [])
    // @ts-ignore
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(JSON.parse(localStorage.getItem("streamSettings")) || [])

    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<{ [name: number]: number }>(JSON.parse(localStorage.getItem("port_tx_rx_mapping")) || {})

    const [mode, set_mode] = useState(parseInt(localStorage.getItem("gen-mode") || String(GenerationMode.NONE)))
    const [loaded, set_loaded] = useState(false)
    const ref = useRef()

    const loadPorts = async () => {
        let stats = await get({route: "/ports"})

        if (stats.status === 200) {
            set_ports(stats.data)
        }
    }

    const refresh = async () => {
        set_loaded(false)
        await loadPorts()
        await loadGen()
        set_loaded(true)
    }

    const loadGen = async () => {
        let stats = await get({route: "/trafficgen"})

        if (Object.keys(stats.data).length > 1) {
            let old_streams = JSON.stringify(streams)

            if (old_streams != JSON.stringify(stats.data.streams)) {
                set_mode(stats.data.mode)
                set_port_tx_rx_mapping(stats.data.port_tx_rx_mapping)
                set_stream_settings(stats.data.stream_settings)
                set_streams(stats.data.streams)

                localStorage.setItem("streams", JSON.stringify(stats.data.streams))
                localStorage.setItem("gen-mode", stats.data.mode)
                localStorage.setItem("streamSettings", JSON.stringify(stats.data.stream_settings))
                localStorage.setItem("port_tx_rx_mapping", JSON.stringify(stats.data.port_tx_rx_mapping))
            }

            set_running(true)
        } else {
            set_running(false)
        }
    }

    useEffect(() => {
        refresh()

        const interval = setInterval(loadGen, 2000);

        return () => {
            clearInterval(interval)
        }
    }, [streams])

    const save = () => {
        localStorage.setItem("streams", JSON.stringify(streams))
        localStorage.setItem("gen-mode", String(mode))

        localStorage.setItem("streamSettings", JSON.stringify(stream_settings))

        localStorage.setItem("port_tx_rx_mapping", JSON.stringify(port_tx_rx_mapping))

        alert("Settings saved.")
    }

    const reset = () => {
        localStorage.clear()

        set_streams([])
        set_stream_settings([])
        set_mode(GenerationMode.NONE)
        set_port_tx_rx_mapping({})

        alert("Reset complete.")
    }

    const addStream = () => {
        if (streams.length > 6) {
            alert("Only 7 different streams allowed.")
        } else {
            let id = 0

            if (streams.length > 0) {
                id = Math.max(...streams.map(s => s.stream_id))
            }

            set_streams(old => [...old, DefaultStream(id + 1)])

            ports.map((v, i) => {
                if (v.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback) {
                    set_stream_settings(old => [...old, DefaultStreamSettings(id + 1, v.pid)])
                }
            })
        }
    }

    const removeStream = (id: number) => {
        set_streams(streams.filter(v => v.stream_id != id))
        set_stream_settings(stream_settings.filter(v => v.stream_id != id))
    }

    const exportSettings = () => {
        const settings = {
            "mode": mode,
            "stream_settings": stream_settings,
            "streams": streams,
            "port_tx_rx_mapping": port_tx_rx_mapping
        }

        const json = `data:text/json;charset=utf-8,${encodeURIComponent(
            JSON.stringify(settings, null, "\t")
        )}`

        const link = document.createElement("a");
        link.href = json
        link.download = "settings.json"

        link.click()
    }

    const importSettings = (e: any) => {
        // @ts-ignore
        ref.current.click()
    }

    const loadSettings = (e: any) => {
        e.preventDefault()

        const fileReader = new FileReader();
        fileReader.readAsText(e.target.files[0], "UTF-8");

        fileReader.onload = (e: any) => {
            let data: TrafficGenData = JSON.parse(e.target.result)

            if(!validateStreams(data.streams) || !validateStreamSettings(data.stream_settings)) {
                alert("Settings not valid.")
                // @ts-ignore
                ref.current.value = ""
            }
            else {
                localStorage.setItem("streams", JSON.stringify(data.streams))
                localStorage.setItem("gen-mode", String(data.mode))

                localStorage.setItem("streamSettings", JSON.stringify(data.stream_settings))

                localStorage.setItem("port_tx_rx_mapping", JSON.stringify(data.port_tx_rx_mapping))

                alert("Import successfull. Reloading...")

                window.location.reload()
            }
        }
    }

    // @ts-ignore
    // @ts-ignore
    return <Loader loaded={loaded}>
        <Row>
            <Col className={"col-2"}>
                <Form.Select disabled={running} required
                             onChange={(event: any) => {
                                 set_streams([]);
                                 set_stream_settings([]);
                                 if (event.target.value != "" && event.target.value != GenerationMode.ANALYZE) {
                                     addStream();
                                 }
                                 set_mode(parseInt(event.target.value));
                             }}>
                    <option value={GenerationMode.NONE}>Generation Mode</option>
                    <option selected={mode === GenerationMode.CBR} value={GenerationMode.CBR}>CBR</option>
                    <option selected={mode === GenerationMode.POISSON} value={GenerationMode.POISSON}>Poisson</option>
                    <option selected={mode === GenerationMode.MPPS} value={GenerationMode.MPPS}>Mpps</option>
                    <option selected={mode === GenerationMode.ANALYZE} value={GenerationMode.ANALYZE}>Monitor</option>
                </Form.Select>
            </Col>
            <Col>
                <InfoBox>
                    <>
                        <p>P4TG supports multiple modes.</p>

                        <h5>Constant bit rate (CBR)</h5>

                        <p>Constant bit rate (CBR) traffic sends traffic with a constant rate.</p>

                        <h5>Poisson</h5>

                        <p>Poisson traffic is traffic with random inter-arrival times but a constant average traffic
                            rate.</p>

                        <h5>Mpps</h5>

                        <p>In Mpps mode, P4TG generates traffic with a fixed number of packets per seconds.</p>

                        <h5>Monitor/Analyze</h5>

                        <p>In monitor/analyze mode, P4TG forwards traffic received on its ports and measures L1/L2
                            rates, packet sizes/types and inter-arrival times.</p>

                    </>
                </InfoBox>
            </Col>
            <Col className={"text-end"}>
                <Button onClick={importSettings} disabled={running} variant={"primary"}>
                    <i className="bi bi-cloud-arrow-down-fill"/> Import
                </Button>
                {" "}
                <Button onClick={exportSettings} disabled={running} variant={"danger"}>
                    <i className="bi bi-cloud-arrow-up-fill"/> Export
                </Button>
            </Col>
        </Row>
        <Row>

        </Row>
        {mode != GenerationMode.ANALYZE ?
            <Row>
                <Col>
                    <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
                        <thead className={"table-dark"}>
                        <tr>
                            <th>Stream-ID</th>
                            <th>Frame Size</th>
                            <th>Rate</th>
                            <th>Mode</th>
                            <th>VxLAN &nbsp;
                                <InfoBox>
                                    <p>VxLAN (<a href={"https://datatracker.ietf.org/doc/html/rfc7348"} target="_blank">RFC
                                        7348</a>) adds an additional outer Ethernet, IP and VxLAN header to the packet.
                                    </p>
                                </InfoBox>
                            </th>
                            <th>Encapsulation &nbsp;
                                <InfoBox>
                                    <p>P4TG supports various encapsulations for the generated IP/UDP packet.</p>
                                </InfoBox>
                            </th>
                            <th>Options</th>
                        </tr>
                        </thead>
                        <tbody>
                        {streams.map((v, i) => {
                            v.app_id = i + 1;
                            return <StreamElement key={i} mode={mode} data={v} remove={removeStream} running={running}
                                                  stream_settings={stream_settings}/>
                        })}

                        </tbody>
                    </Table>

                </Col>
            </Row>
            : null
        }
        <Row className={"mb-3"}>
            <Col className={"text-start"}>
                {running ? null :
                    mode === GenerationMode.CBR || mode == GenerationMode.MPPS ?
                        <Button onClick={addStream} variant="primary"><i className="bi bi-plus"/> Add
                            stream</Button>
                        :
                        null
                }
            </Col>
        </Row>

        {streams.length > 0 || mode == GenerationMode.ANALYZE ?
            <Row>
                <Col>
                    <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
                        <thead className={"table-dark"}>
                        <tr>
                            <th>TX Port</th>
                            <th>RX Port</th>
                            {streams.map((v, i) => {
                                return <th key={i}>Stream {v.app_id}</th>
                            })}
                        </tr>
                        </thead>
                        <tbody>
                        {ports.map((v, i) => {
                            if (v.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback) {
                                return <tr key={i}>
                                    <StyledCol>{v.port} ({v.pid})</StyledCol>
                                    <StyledCol>
                                        <Form.Select disabled={running || !v.status} required
                                                     defaultValue={port_tx_rx_mapping[v.pid] || -1}
                                                     onChange={(event: any) => {
                                                         let current = port_tx_rx_mapping;

                                                         if (parseInt(event.target.value) == -1) {
                                                             delete current[v.pid]
                                                         } else {
                                                             current[v.pid] = parseInt(event.target.value);
                                                         }

                                                         set_port_tx_rx_mapping(current);
                                                     }}>
                                            <option value={-1}>Select RX Port</option>
                                            {ports.map((v, i) => {
                                                if (v.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback) {
                                                    return <option key={i}
                                                                   value={v.pid}>{v.port} ({v.pid})</option>
                                                }
                                            })
                                            }
                                        </Form.Select>

                                    </StyledCol>
                                    <StreamSettingsList stream_settings={stream_settings} streams={streams}
                                                        running={running} port={v}/>

                                </tr>
                            }
                        })}

                        </tbody>
                    </Table>

                </Col>
            </Row>
            :
            null
        }

        <Row>
            <Col>
                <Button onClick={save} disabled={running} variant="primary"><i className="bi bi-check"/> Save</Button>
                {" "}
                <Button onClick={reset} disabled={running} variant="danger"><i className="bi bi-x-octagon-fill"/> Reset</Button>
            </Col>
        </Row>

        <input
            style={{display: "none"}}
            accept=".json"
            // @ts-ignore
            ref={ref}
            onChange={loadSettings}
            type="file"
        />

        <GitHub/>


    </Loader>
}

export default Settings