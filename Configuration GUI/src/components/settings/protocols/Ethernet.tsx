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
import { Button, Col, Form } from "react-bootstrap";
import { StreamSettings } from "../../../common/Interfaces";
import { StyledRow } from "../../../sites/Settings";
import { randomMAC } from "../SettingsModal";

interface Props {
    data: StreamSettings,
    set_data: (object: any) => void,
    running: boolean
}

const Ethernet = ({ data, set_data, running }: Props) => {
    return <>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                Source
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control disabled={running} type={"text"}
                    onChange={(event: any) => set_data({ ethernet: { ...data.ethernet, eth_src: event.target.value } })}
                    value={data.ethernet.eth_src}
                />
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({ ethernet: { ...data.ethernet, eth_src: randomMAC(false) } })}>
                    <i className="bi bi-shuffle" />
                </Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Destination
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control disabled={running} onChange={(event: any) => set_data({ ethernet: { ...data.ethernet, eth_dst: event.target.value } })}
                    type={"text"}
                    value={data.ethernet.eth_dst} />
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({ ethernet: { ...data.ethernet, eth_dst: randomMAC() } })}>
                    <i className="bi bi-shuffle" /></Button>
            </Col>
        </Form.Group>
    </>
}

export default Ethernet