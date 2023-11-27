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
import Loader from "../components/Loader";
import {get, post} from '../common/API'
import {Button, Col, Form, Row, Table} from "react-bootstrap";
import styled from "styled-components";

const StyledCol = styled.td`
    vertical-align: middle;
    display: table-cell;
    text-indent: 5px;
`

export const PortStat = styled.span<{ active: boolean }>`
    color: ${props => (props.active ? 'var(--color-okay)' : 'var(--color-primary)')};
`

export const PortStatus = ({active}: { active: boolean }) => {
    return <PortStat active={active}>
        {active ?
            <i className="bi bi-arrow-up-circle-fill"/>
            :
            <i className="bi bi-arrow-down-circle-fill"/>
        }
    </PortStat>
}

const Ports = () => {
    const [loaded, set_loaded] = useState(false)
    const [ports, set_ports] = useState([])

    const fec_mapping: { [name: string]: string } = {
        "BF_FEC_TYP_NONE": "None",
        "BF_FEC_TYP_FC": "Firecode",
        "BF_FEC_TYP_REED_SOLOMON": "Reed Solomon"
    }
    const auto_neg_mapping: { [name: string]: string } = {
        "PM_AN_DEFAULT": "Auto",
        "PM_AN_FORCE_DISABLE": "Off",
        "PM_AN_FORCE_ENABLE": "On"
    }

    const speed_mapping: { [name: string]: string } = {
        "BF_SPEED_1G": "1G",
        "BF_SPEED_10G": "10G",
        "BF_SPEED_25G": "25G",
        "BF_SPEED_40G": "40G",
        "BF_SPEED_50G": "50G",
        "BF_SPEED_100G": "100G"
    }

    const loopback_mapping: { [name: string]: string } = {
        "BF_LPBK_NONE": "Off",
        "BF_LPBK_MAC_NEAR": "On"
    }


    const loadPorts = async () => {
        let stats = await get({route: "/ports"})

        if (stats.status === 200) {
            set_ports(stats.data)
            set_loaded(true)
        }
    }

    const updatePort = async (pid: number, speed: string, fec: string, auto_neg: string) => {
        let update = await post({
            route: "/ports", body: {
                pid: pid,
                speed: speed,
                fec: fec,
                auto_neg: auto_neg
            }
        })

        if (update.status === 201) {
            refresh()
        }
    }

    const refresh = () => {
        set_loaded(false)
        loadPorts()
    }

    useEffect(() => {
        loadPorts()

    }, [])


    return <Loader loaded={loaded}>
        <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
            <thead className={"table-dark"}>
            <tr>
                <th>PID</th>
                <th>Port</th>
                <th>Speed</th>
                <th>Auto Negotiation</th>
                <th>FEC</th>
                {/*<th>Loopback</th>*/}
                <th>Status</th>
            </tr>
            </thead>
            <tbody>
            {ports.map((v: any, i: number) => {
                if (loopback_mapping[v["loopback"]] == "Off") {
                    return <tr key={i}>
                        <StyledCol>{v["pid"]}</StyledCol>
                        <StyledCol>{v['port']}/{v["channel"]}</StyledCol>
                        <StyledCol>{speed_mapping[(v['speed']) as string]}</StyledCol>
                        <StyledCol>
                            <Form.Select onChange={async (event: any) => {
                                await updatePort(v["pid"], v["speed"], v["fec"], event.target.value)
                            }}>
                                {Object.keys(auto_neg_mapping).map(f => {
                                    return <option selected={f == v["auto_neg"]}
                                                   value={f}>{auto_neg_mapping[f]}</option>
                                })}
                            </Form.Select></StyledCol>
                        <StyledCol><Form.Select onChange={async (event: any) => {
                            await updatePort(v["pid"], v["speed"], event.target.value, v["auto_neg"])
                        }}>
                            {Object.keys(fec_mapping).map(f => {
                                if (f != "BF_FEC_TYP_FC" || v["speed"] != "BF_SPEED_100G") {
                                    return <option selected={f == v["fec"]} value={f}>{fec_mapping[f]}</option>
                                }
                            })}
                        </Form.Select>
                            {//{fec_mapping[v['fec']]}
                            }
                        </StyledCol>
                        {/*<td>{loopback_mapping[v["loopback"]]}</td>*/}
                        <StyledCol><PortStatus active={v['status']}/></StyledCol>
                    </tr>
                }
            })
            }
            </tbody>
        </Table>

        <Row>
            <Col>
                <Button onClick={refresh} className={"ml-3"}><i className="bi bi-arrow-clockwise"/> Refresh</Button>
            </Col>
        </Row>
    </Loader>
}

export default Ports