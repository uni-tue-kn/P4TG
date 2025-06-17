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
import {DefaultMPLSHeader, Stream, StreamSettings} from "../../../common/Interfaces";

interface Props {
    stream: Stream,
    data: StreamSettings,
    set_data: (object: any) => void,
    running: boolean
}



const MPLS = ({stream, data, set_data, running}: Props) => {
    const set_label = (label: number, i: number) => {
        data.mpls_stack[i].label = label;
    }

    const set_tc = (tc: number, i: number) => {
        data.mpls_stack[i].tc = tc;
    }

    const set_ttl = (ttl: number, i: number) => {
        data.mpls_stack[i].ttl = ttl;
    }

    return <>
        <Form.Group as={StyledRow} className="mb-12" controlId="formPlaintextEmail">
            <Col className={"col-3 text-start"}>
                <Form.Label>
                </Form.Label>
            </Col>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col className={"text-start"}>
                        <Form.Label>
                            Label
                        </Form.Label>
                    </Col>
                    <Col className={"text-start"}>
                        <Form.Label>
                            TC
                        </Form.Label>
                    </Col>
                    <Col className={"text-start"}>
                        <Form.Label>
                            TTL
                        </Form.Label>
                    </Col>
                </Row>
            </Col>
        </Form.Group>

        {Array.from({length: stream.number_of_lse}, (_, i) => {

            if (data.mpls_stack[i] === undefined) {
                // Settings were never saved before, initialize with default header
                data.mpls_stack[i] = DefaultMPLSHeader()
            }

            return <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
                <Form.Label className={"col-3 text-start"}>
                    LSE {i + 1}
                </Form.Label>
                <Col className={"col-7 text-end"}>

                    <Row>
                        <Col className={"text-end"}>
                            <Form.Control className={"col-3 text-start"}
                                          onChange={(event: any) => set_label(parseInt(event.target.value), i)}
                                          min={0}
                                          max={2 ** 20 - 1}
                                          step={1}
                                          placeholder={data.mpls_stack[i].label.toString()}
                                          disabled={running} type={"number"}/>
                        </Col>
                        <Col className={"text-end"}>
                            <Form.Control className={"col-3 text-start"}
                                          onChange={(event: any) => set_tc(parseInt(event.target.value), i)}
                                          min={0}
                                          max={7}
                                          step={1}
                                          placeholder={data.mpls_stack[i].tc.toString()}
                                          disabled={running} type={"number"}/>
                        </Col>
                        <Col className={"text-end"}>
                            <Form.Control className={"col-3 text-start"}
                                          onChange={(event: any) => set_ttl(parseInt(event.target.value), i)}
                                          min={0}
                                          max={255}
                                          step={1}
                                          placeholder={data.mpls_stack[i].ttl.toString()}
                                          disabled={running} type={"number"}/>
                        </Col>
                    </Row>
                </Col>
            </Form.Group>
        })
        }
        </>
}

export default MPLS
