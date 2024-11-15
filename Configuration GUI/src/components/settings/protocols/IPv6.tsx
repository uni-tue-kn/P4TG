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

import {Button, Col, Form, Row} from "react-bootstrap";
import { randomIPv6 } from "../SettingsModal";

import InfoBox from "../../InfoBox";
import {StreamSettings} from "../../../common/Interfaces";
import {StyledRow} from "../../../sites/Settings";

interface Props {
    data: StreamSettings,
    set_data: (object: any) => void,
    running: boolean
}

const IPv6 = ({data, set_data, running}: Props) => {
    return <>
            <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextEmail">
            <Form.Label className={"col-3 text-start"}>
                Source
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({ipv6: {...data.ipv6, ipv6_src: event.target.value}})}
                                      disabled={running} type={"text"} value={data.ipv6.ipv6_src}/>
                    </Col>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({ipv6: {...data.ipv6, ipv6_src_mask: event.target.value}})}
                                      disabled={running} type={"text"} value={data.ipv6.ipv6_src_mask}/>
                    </Col>
                    <Col className={"col-1"}>
                        <InfoBox>
                            <>
                                <p>IP addresses can be randomized to simulate multiple flows.</p>
                                <p>The second value (default ::) represents a randomization mask that can be used to randomize parts of the src/dst address. The maximum vaue for the mask is ::ff:ffff:ffff</p>

                                <p>In the dataplane, a 48 bit value (least-significant 48 bits of a randomized IPv6 address) is generated and bitwise ANDed with the randomization mask. The resulting IP address is bitwise ORed with the src/dst address.</p>

                                <h3>Example</h3>

                                <p>Src IP address is set to ff:: and the randomization mask is set to ::ff. P4TG will then generate IP addresses with a randomized last octet, i.e., a address in the range ff::-ff::ff</p>
                            </>
                        </InfoBox>
                    </Col>
                </Row>
            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({ipv6: {...data.ipv6, ipv6_src: randomIPv6()}})}><i className="bi bi-shuffle"/></Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Destination
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Row>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({ipv6: {...data.ipv6, ipv6_dst: event.target.value}})}
                                      disabled={running} type={"text"} value={data.ipv6.ipv6_dst}/>
                    </Col>
                    <Col>
                        <Form.Control onChange={(event: any) => set_data({ipv6: {...data.ipv6, ipv6_dst_mask: event.target.value}})}
                                      disabled={running} type={"text"} value={data.ipv6.ipv6_dst_mask}/>
                    </Col>
                    <Col className={"col-1"}>
                        <InfoBox>
                            <>
                            <p>IP addresses can be randomized to simulate multiple flows.</p>
                                <p>The second value (default ::) represents a randomization mask that can be used to randomize parts of the src/dst address. The maximum vaue for the mask is ::ff:ffff:ffff</p>

                                <p>In the dataplane, a 48 bit value (least-significant 48 bits of a randomized IPv6 address) is generated and bitwise ANDed with the randomization mask. The resulting IP address is bitwise ORed with the src/dst address.</p>

                                <h3>Example</h3>

                                <p>Src IP address is set to ff:: and the randomization mask is set to ::ff. P4TG will then generate IP addresses with a randomized last octet, i.e., a address in the range ff::-ff::ff</p>
                            </>
                        </InfoBox>
                    </Col>
                </Row>

            </Col>
            <Col className={"col-1 text-end"}>
                <Button disabled={running} onClick={() => set_data({ipv6: {...data.ipv6, ipv6_dst: randomIPv6()}})}>
                    <i className="bi bi-shuffle"/>
                </Button>
            </Col>
        </Form.Group>

        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Traffic Class
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control onChange={(event: any) => set_data({ipv6: {...data.ipv6, ipv6_traffic_class: parseInt(event.target.value)}})}
                              disabled={running} type={"number"} defaultValue={data.ipv6.ipv6_traffic_class}/>
            </Col>
        </Form.Group>
        <Form.Group as={StyledRow} className="mb-3" controlId="formPlaintextPassword">
            <Form.Label className={"col-3 text-start"}>
                Flow Label
            </Form.Label>
            <Col className={"col-7 text-end"}>
                <Form.Control onChange={(event: any) => set_data({ipv6: {...data.ipv6, ipv6_flow_label: parseInt(event.target.value)}})}
                              disabled={running} type={"number"} defaultValue={data.ipv6.ipv6_flow_label}/>
            </Col>
        </Form.Group>        
    </>
}

export default IPv6