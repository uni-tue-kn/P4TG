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
import {Button, Col, Form, InputGroup, Modal, Row, Table} from "react-bootstrap";
import {get} from "../common/API";
import Loader from "../components/Loader";
import {DefaultStream, DefaultStreamSettings, Stream, StreamSettings} from "../common/Interfaces";
import styled from "styled-components";

const StyledRow = styled.tr`
  display: flex;
  align-items: center;
`

const StyledCol = styled.td`
  vertical-align: middle;
  display: table-cell;
  text-indent: 5px;
`

const SettingsModal = ({
                           show,
                           hide,
                           data,
                           running
                       }: { show: boolean, hide: () => void, data: StreamSettings, running: boolean }) => {
    const [eth_src, set_eth_src] = useState(data.eth_src)
    const [eth_dst, set_eth_dst] = useState(data.eth_dst)
    const [ip_src, set_ip_src] = useState(data.ip_src)
    const [ip_dst, set_ip_dst] = useState(data.ip_dst)
    const [ip_tos, set_ip_tos] = useState(data.ip_tos)
    const [ip_src_mask, set_ip_src_mask] = useState(data.ip_src_mask)
    const [ip_dst_mask, set_ip_dst_mask] = useState(data.ip_dst_mask)

    const validateMAC = (mac: string) => {
        let regex = /^([0-9A-F]{2}[:-]){5}([0-9A-F]{2})$/;

        return regex.test(mac)
    }

    const randomMAC = () => {
        return "XX:XX:XX:XX:XX:XX".replace(/X/g, function () {
            return "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))
        });
    }
    const validateIP = (ip: string) => {
        let regex = /^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]\d|\d)){3}$/gm;

        return regex.test(ip)
    }

    const randomIP = () => {
        return (Math.floor(Math.random() * 255) + 1) + "." + (Math.floor(Math.random() * 255)) + "." + (Math.floor(Math.random() * 255)) + "." + (Math.floor(Math.random() * 255));

    }

    const validateToS = (tos: number) => {
        return !isNaN(tos) && (0 <= tos) && tos <= (2 ** 7 - 1)
    }

    const submit = () => {
        if (!validateMAC(eth_src)) {
            alert("Ethernet source not a valid MAC.")
        } else if (!validateMAC(eth_dst)) {
            alert("Ethernet destination not a valid MAC.")
        } else if (!validateIP(ip_src)) {
            alert("Source IP not valid.")
        } else if (!validateIP(ip_dst)) {
            alert("Destination IP not valid.")
        } else if (!validateToS(ip_tos)) {
            alert("IP ToS not valid.")
        }

        data.eth_src = eth_src
        data.eth_dst = eth_dst
        data.ip_src = ip_src
        data.ip_dst = ip_dst
        data.ip_tos = ip_tos
        data.ip_src_mask = ip_src_mask
        data.ip_dst_mask = ip_dst_mask

        hide()
    }

    const hideRestore = () => {
        set_eth_src(data.eth_src)
        set_eth_dst(data.eth_dst)

        set_ip_src(data.ip_src)
        set_ip_dst(data.ip_dst)
        set_ip_src_mask(data.ip_src_mask)
        set_ip_dst_mask(data.ip_dst_mask)

        hide()


    }

    return <Modal show={show} size="lg" onHide={hideRestore}>
        <Modal.Header closeButton>
            <Modal.Title>Stream</Modal.Title>
        </Modal.Header>
        <form onSubmit={submit}>
            <Modal.Body>

                <h4>Ethernet</h4>
                <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
                    <Form.Label className={"col-3 text-start"}>
                        Source
                    </Form.Label>
                    <Col className={"col-7 text-end"}>
                        <Form.Control disabled={running} type={"text"}
                                      onChange={(event: any) => set_eth_src(event.target.value)}
                                      value={eth_src}
                        />
                    </Col>
                    <Col className={"col-1 text-end"}>
                        <Button disabled={running} onClick={() => set_eth_src(randomMAC())}><i
                            className="bi bi-shuffle"/></Button>
                    </Col>
                </Form.Group>

                <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
                    <Form.Label className={"col-3 text-start"}>
                        Destination
                    </Form.Label>
                    <Col className={"col-7 text-end"}>
                        <Form.Control disabled={running} onChange={(event: any) => set_eth_dst(event.target.value)}
                                      type={"text"}
                                      value={eth_dst}/>
                    </Col>
                    <Col className={"col-1 text-end"}>
                        <Button disabled={running} onClick={() => set_eth_dst(randomMAC())}><i
                            className="bi bi-shuffle"/></Button>
                    </Col>
                </Form.Group>

                <h4>IPv4</h4>

                <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
                    <Form.Label className={"col-3 text-start"}>
                        Source
                    </Form.Label>
                    <Col className={"col-7 text-end"}>
                        <Row>
                            <Col>
                                <Form.Control onChange={(event: any) => set_ip_src(event.target.value)}
                                              disabled={running} type={"text"} value={ip_src}/>
                            </Col>
                            <Col>
                                <Form.Control onChange={(event: any) => set_ip_src_mask(event.target.value)}
                                              disabled={running} type={"text"} value={ip_src_mask}/>
                            </Col>
                        </Row>
                    </Col>
                    <Col className={"col-1 text-end"}>
                        <Button disabled={running} onClick={() => set_ip_src(randomIP())}><i className="bi bi-shuffle"/></Button>
                    </Col>
                </Form.Group>

                <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
                    <Form.Label className={"col-3 text-start"}>
                        Destination
                    </Form.Label>
                    <Col className={"col-7 text-end"}>
                        <Row>
                            <Col>
                                <Form.Control onChange={(event: any) => set_ip_dst(event.target.value)}
                                              disabled={running} type={"text"} value={ip_dst}/>
                            </Col>
                            <Col>
                                <Form.Control onChange={(event: any) => set_ip_dst_mask(event.target.value)}
                                              disabled={running} type={"text"} value={ip_dst_mask}/>
                            </Col>
                        </Row>

                    </Col>
                    <Col className={"col-1 text-end"}>
                        <Button disabled={running} onClick={() => set_ip_dst(randomIP())}><i className="bi bi-shuffle"/></Button>
                    </Col>
                </Form.Group>

                <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
                    <Form.Label className={"col-3 text-start"}>
                        ToS
                    </Form.Label>
                    <Col className={"col-7 text-end"}>
                        <Form.Control onChange={(event: any) => set_ip_tos(parseInt(event.target.value))}
                                      disabled={running} type={"number"} defaultValue={data.ip_tos}/>
                    </Col>
                </Form.Group>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={hideRestore}>
                    Close
                </Button>
                <Button variant="primary" onClick={submit} disabled={running}>
                    Save
                </Button>
            </Modal.Footer>
        </form>
    </Modal>
}

const StreamElement = ({
                           running,
                           data,
                           remove,
                           mode
                       }: { running: boolean, data: Stream, remove: (id: number) => void, mode: string }) => {
    const [show, set_show] = useState(false)

    return <tr>
        <StyledCol>{data.app_id}</StyledCol>
        <StyledCol>
            <InputGroup>
                <Form.Select disabled={running} required
                             defaultValue={data.frame_size}
                             onChange={(event: any) => data.frame_size = parseInt(event.target.value)}>
                    <option value={""}>Frame size</option>
                    {[64, 128, 256, 512, 1024, 1280, 1518, 9000].map((v, i) => {
                        return <option selected={v === data.frame_size} key={i}
                                       value={v}>{v == 9000 ? "Jumbo (9000)" : v}</option>
                    })
                    }
                </Form.Select>
                <InputGroup.Text>bytes</InputGroup.Text>
            </InputGroup>
        </StyledCol>
        <StyledCol>
            <InputGroup>
                <Form.Control
                    disabled={running}
                    onChange={(event: any) => data.traffic_rate = parseFloat(event.target.value)}
                    required
                    min={"0"}
                    max={mode == "Mpps" ? 200 : 100}
                    step={"any"}
                    type={"number"}
                    placeholder="Traffic rate"
                    defaultValue={data.traffic_rate > 0 ? data.traffic_rate : ""}
                />
                <InputGroup.Text>{mode == "Mpps" ? "Mpps" : "Gbps"}</InputGroup.Text>
            </InputGroup>
        </StyledCol>
        <StyledCol>
            <Form.Select disabled={running} required
                         onChange={(event: any) => data.burst = parseInt(event.target.value)}>
                <option selected={100 === data.burst} value="100">Rate Precision</option>
                <option selected={1 === data.burst} value="1">IAT Precision</option>
            </Form.Select>
        </StyledCol>
        <StyledCol className={"text-end"}>
            <Button disabled={running} className={"btn-sm"} variant={"dark"}
                    onClick={() => remove(data.stream_id)}>
                <i className="bi bi-trash2-fill"/></Button>
        </StyledCol>


    </tr>
}

const StreamSettingsElement = ({
                                   running,
                                   stream
                               }: { running: boolean, stream: StreamSettings }) => {
    const [show, set_show] = useState(false)

    return <>
        <SettingsModal running={running} data={stream} show={show} hide={() => set_show(false)}/>
        <StyledCol>
            <Form.Check
                className={"d-inline"}
                disabled={running}
                defaultChecked={stream.active}
                type={"checkbox"}
                onChange={(event) => {
                    stream.active = !stream.active
                }
                }
            />

            <i role={"button"}
               onClick={() => set_show(true)}
               className="bi bi-gear-wide-connected ms-3"/>
        </StyledCol>

    </>
}

const Settings = () => {
    const [ports, set_ports] = useState<{ pid: number, port: number, channel: number, loopback: string, status: boolean }[]>([])
    const [running, set_running] = useState(false)
    // @ts-ignore
    const [streams, set_streams] = useState<Stream[]>(JSON.parse(localStorage.getItem("streams")) || [])
    // @ts-ignore
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(JSON.parse(localStorage.getItem("streamSettings")) || [])

    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<{ [name: number]: number }>(JSON.parse(localStorage.getItem("port_tx_rx_mapping")) || {})

    const [mode, set_mode] = useState(localStorage.getItem("gen-mode") || "")
    const [loaded, set_loaded] = useState(false)

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

        if (Object.keys(stats.data).length > 0) {
            set_mode(stats.data.mode)
            set_port_tx_rx_mapping(stats.data.port_mapping)
            set_stream_settings(stats.data.stream_settings)
            set_streams(stats.data.streams)

            localStorage.setItem("streams", JSON.stringify(stats.data.streams))
            localStorage.setItem("gen-mode", stats.data.mode)
            localStorage.setItem("streamSettings", JSON.stringify(stats.data.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(stats.data.port_mapping))

            set_running(true)
        } else {
            set_running(false)
        }
    }

    useEffect(() => {
        refresh()
        console.log(streams)

        setInterval(loadGen, 2000);
    }, [])

    const save = () => {
        localStorage.setItem("streams", JSON.stringify(streams))
        localStorage.setItem("gen-mode", mode)

        localStorage.setItem("streamSettings", JSON.stringify(stream_settings))

        localStorage.setItem("port_tx_rx_mapping", JSON.stringify(port_tx_rx_mapping))

        alert("Settings saved.")
    }

    const reset = () => {
        localStorage.removeItem("streams")
        localStorage.removeItem("gen-mode")
        localStorage.removeItem("streamSettings")
        localStorage.removeItem("port_tx_rx_mapping")

        set_streams([])
        set_stream_settings([])
        set_mode("")
        set_port_tx_rx_mapping({})

        alert("Reset complete.")
    }

    // useEffect(() => {
    //     return () => {
    //         //console.log(JSON.stringify(streams))
    //         //localStorage.setItem("streams", JSON.stringify(streams))
    //         //localStorage.setItem("gen-mode", mode)
    //
    //         //localStorage.setItem("streamSettings", JSON.stringify(stream_settings))
    //     }
    //
    // }, [streams, mode, stream_settings])

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
                if (v.loopback == "BF_LPBK_NONE") {
                    set_stream_settings(old => [...old, DefaultStreamSettings(id + 1, v.pid)])
                }
            })
        }
    }

    const removeStream = (id: number) => {
        set_streams(streams.filter(v => v.stream_id != id))
        set_stream_settings(stream_settings.filter(v => v.stream_id != id))
    }

    return <Loader loaded={loaded}>
        <Row>
            <Col className={"col-2"}>
                <Form.Select disabled={running} required
                             onChange={(event: any) => {
                                 set_streams([]);
                                 set_stream_settings([]);
                                 if (event.target.value != "" && event.target.value != "Monitor") {
                                     addStream();
                                 }
                                 set_mode(event.target.value);
                             }}>
                    <option value={""}>Generation Mode</option>
                    <option selected={mode === "CBR"} value={"CBR"}>CBR</option>
                    <option selected={mode === "Poisson"} value={"Poisson"}>Poisson</option>
                    <option selected={mode === "Mpps"} value={"Mpps"}>Mpps</option>
                    <option selected={mode === "Monitor"} value={"Monitor"}>Monitor</option>
                </Form.Select>
            </Col>
        </Row>
        <Row>

        </Row>
        {mode != "Monitor" ?
            <Row>
                <Col>
                    <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
                        <thead className={"table-dark"}>
                        <tr>
                            <th>Stream-ID</th>
                            <th>Frame Size</th>
                            <th>Rate</th>
                            <th>Mode</th>
                            <th>Options</th>
                        </tr>
                        </thead>
                        <tbody>
                        {streams.map((v, i) => {
                            v.app_id = i + 1;

                            return <StreamElement key={i} mode={mode} data={v} remove={removeStream} running={running}/>
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
                    mode === "CBR" ?
                        <Button onClick={addStream} variant="primary"><i className="bi bi-plus"/> Add
                            stream</Button>
                        :
                        null
                }
            </Col>
        </Row>

        {streams.length > 0 || mode == "Monitor" ?
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
                            if (v.loopback == "BF_LPBK_NONE" && v.status) {
                                return <tr key={i}>
                                    <StyledCol>{v.port} ({v.pid})</StyledCol>
                                    <StyledCol>
                                        <Form.Select disabled={running} required
                                                     defaultValue={port_tx_rx_mapping[v.pid] || ""}
                                                     onChange={(event: any) => {
                                                         set_port_tx_rx_mapping({
                                                             ...port_tx_rx_mapping,
                                                             [v.pid]: event.target.value
                                                         })
                                                     }}>
                                            <option value={""}>Select RX Port</option>
                                            {ports.map((v, i) => {
                                                if (v.loopback == "BF_LPBK_NONE" && v.status) {
                                                    return <option key={i}
                                                                   value={v.pid}>{v.port} ({v.pid})</option>
                                                }
                                            })
                                            }
                                        </Form.Select>

                                    </StyledCol>
                                    {stream_settings.map((s, i) => {
                                        if (s.port == v.pid) {
                                            return <StreamSettingsElement key={i} running={running} stream={s}/>
                                        }

                                    })}

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

        <Button onClick={save} disabled={running} variant="success"><i className="bi bi-check"/> Save</Button>
        { " " }
        <Button onClick={reset} disabled={running} variant="danger"><i className="bi bi-x-octagon-fill"/> Reset</Button>

    </Loader>
}

export default Settings