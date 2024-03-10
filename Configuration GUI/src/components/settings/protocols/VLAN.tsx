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
import {Col, Form, Row} from "react-bootstrap";
import {StyledRow} from "../../../sites/Settings";
import {StreamSettings} from "../../../common/Interfaces";

interface Props {
    data: StreamSettings,
    set_data: (object: any) => void,
    running: boolean
}

const VLAN = ({data, set_data, running}: Props) => {
    return <>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                PCP
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({vlan: {...data.vlan, pcp: parseInt(event.target.value)}})}
                                      disabled={running} type={"number"} value={data.vlan.pcp}/>
                    </Col>
                </Row>
            </Col>
        </Form.Group>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                DEI
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({vlan: {...data.vlan, dei: parseInt(event.target.value)}})}
                                      disabled={running} type={"number"} max={1} min={0} value={data.vlan.dei}/>
                    </Col>
                </Row>
            </Col>
        </Form.Group>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                VLAN ID
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col>
                        <Form.Control
                            onChange={(event: any) => set_data({vlan: {...data.vlan, vlan_id: parseInt(event.target.value)}})}
                            disabled={running} type={"number"} value={data.vlan.vlan_id}/>
                    </Col>
                </Row>
            </Col>
        </Form.Group>
    </>
}

export default VLAN