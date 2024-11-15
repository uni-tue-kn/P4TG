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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import { Col, Form, Row, Button } from "react-bootstrap";

import { StreamSettings, Stream } from "../../../common/Interfaces";
import { StyledRow } from "../../../sites/Settings";
import { randomIPv6 } from "../SettingsModal";

interface Props {
    stream: Stream,
    data: StreamSettings,
    set_data: (object: any) => void,
    running: boolean
}

const SRv6 = ({ stream, data, set_data, running }: Props) => {
    const set_sid = (sid: string, i: number) => {
        data.sid_list[i] = sid;
    }

    return <>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                Source
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({ srv6_base_header: { ...data.srv6_base_header, ipv6_src: event.target.value } })}
                            disabled={running} type={"text"} value={data.srv6_base_header.ipv6_src} />
                    </Col>
                </Row>
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({ srv6_base_header: { ...data.srv6_base_header, ipv6_src: randomIPv6() } })}><i className="bi bi-shuffle" /></Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Destination
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({ srv6_base_header: { ...data.srv6_base_header, ipv6_dst: event.target.value } })}
                            disabled={running} type={"text"} value={data.srv6_base_header.ipv6_dst} />
                    </Col>
                </Row>
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({ srv6_base_header: { ...data.srv6_base_header, ipv6_dst: randomIPv6() } })}><i className="bi bi-shuffle" /></Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Traffic Class
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control onChange={(event: any) => set_data({ srv6_base_header: { ...data.srv6_base_header, ipv6_traffic_class: parseInt(event.target.value) } })}
                    disabled={running} type={"number"} defaultValue={data.srv6_base_header.ipv6_traffic_class} />
            </Col>
        </Form.Group>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Flow Label
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control onChange={(event: any) => set_data({ srv6_base_header: { ...data.srv6_base_header, ipv6_flow_label: parseInt(event.target.value) } })}
                    disabled={running} type={"number"} defaultValue={data.srv6_base_header.ipv6_flow_label} />
            </Col>
        </Form.Group>

        {Array.from({ length: stream.number_of_srv6_sids }, (_, i) => {

            if (data.sid_list[i] === undefined) {
                // Settings were never saved before, initialize with default header
                data.sid_list[i] = "ff80::"
            }

            return <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
                <Form.Label className={"col-3 text-start"}>
                    SID {i + 1}
                </Form.Label>
                <Col className={"col-7 text-end"}>
                    <Row>
                        <Col className={"text-end"}>
                            <Form.Control className={"col-3 text-start"}
                                onChange={(event: any) => set_sid(event.target.value, i)}
                                placeholder={data.sid_list[i].toString()}
                                disabled={running} type={"string"} />
                        </Col>
                    </Row>
                </Col>
                <Col className={"col-1 text-end"}>
                    <Button
                        disabled={running}
                        onClick={() =>
                            set_data({
                                ...data,
                                sid_list: data.sid_list.map((item, index) =>
                                    index === i ? randomIPv6() : item
                                ),
                            })
                        }
                    >
                        <i className="bi bi-shuffle" />
                    </Button>                </Col>
            </Form.Group>
        })
        }
    </>
}

export default SRv6