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

import React from "react"
import {Button, Col, Form } from "react-bootstrap";
import {StyledRow} from "../../../sites/Settings";
import {StreamSettings} from "../../../common/Interfaces";
import {randomMAC, randomIP} from "../SettingsModal";

interface Props {
    data: StreamSettings,
    set_data: (object: any) => void,
    running: boolean
}

const VxLAN = ({data, set_data, running}: Props) => {
    return <>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                Ethernet Source
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control disabled={running} type={"text"}
                              onChange={(event: any) => set_data({vxlan: {...data.vxlan, eth_src: event.target.value}})}
                              value={data.vxlan.eth_src}
                />
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({vxlan: {...data.vxlan, eth_src: randomMAC(false)}})}><i
                    className="bi bi-shuffle"/></Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Ethernet Destination
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control disabled={running} onChange={(event: any) => set_data({vxlan: {...data.vxlan, eth_dst: event.target.value}})}
                              type={"text"}
                              value={data.vxlan.eth_dst}/>
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({vxlan: {...data.vxlan, eth_dst: randomMAC()}})}>
                    <i className="bi bi-shuffle"/></Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                IPv4 Source
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control disabled={running} type={"text"}
                              onChange={(event: any) => set_data({vxlan: {...data.vxlan, ip_src: event.target.value}})}
                              value={data.vxlan.ip_src}
                />
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({vxlan: {...data.vxlan, ip_src: randomIP()}})}>
                    <i className="bi bi-shuffle"/></Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                IPv4 Destination
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control disabled={running} onChange={(event: any) => set_data({vxlan: {...data.vxlan, ip_dst: event.target.value}})}
                              type={"text"}
                              value={data.vxlan.ip_dst}/>
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({vxlan: {...data.vxlan, ip_dst: randomIP()}})}>
                    <i className="bi bi-shuffle"/></Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                IPv4 ToS
            </Form.Label>
            <Col className={"col-9 text-end"}>
                <Form.Control onChange={(event: any) => set_data({vxlan: {...data.vxlan, ip_tos: parseInt(event.target.value)}})}
                              disabled={running} type={"number"} defaultValue={data.vxlan.ip_tos}/>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                UDP Source
            </Form.Label>
            <Col className={"col-9 text-end"}>
                <Form.Control onChange={(event: any) => set_data({vxlan: {...data.vxlan, udp_source: parseInt(event.target.value)}})}
                              disabled={running} type={"number"} defaultValue={data.vxlan.udp_source}/>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                VNI
            </Form.Label>
            <Col className={"col-9 text-end"}>
                <Form.Control onChange={(event: any) => set_data({vxlan: {...data.vxlan, vni: parseInt(event.target.value)}})}
                              disabled={running} type={"number"} min={0} defaultValue={data.vxlan.vni}/>
            </Col>
        </Form.Group>
        </>
}

export default VxLAN