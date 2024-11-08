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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */


import {
    DefaultMPLSHeader,
    Encapsulation,
    GenerationMode,
    MPLSHeader,
    Stream,
    StreamSettings
} from "../../common/Interfaces";
import React, {useState} from "react";
import {Button, Form, InputGroup} from "react-bootstrap";
import InfoBox from "../InfoBox";
import {StyledCol, StyledRow} from "../../sites/Settings";

const StreamElement = ({
                           running,
                           data,
                           remove,
                           mode,
                           stream_settings
                       }: {
    running: boolean,
    data: Stream,
    remove: (id: number) => void,
    mode: GenerationMode,
    stream_settings: StreamSettings[]
}) => {
    const [show_mpls_dropdown, set_show] = useState(data.encapsulation == Encapsulation.MPLS)
    const [number_of_lse, set_number_of_lse] = useState(data.number_of_lse)
    const [stream_settings_c, set_stream_settings] = useState(stream_settings)

    // Used to store VxLAN and IP Version setting. VxLAN must be disabled on changing IP version
    const [formData, setFormData] = useState({ ...data });

    const handleIPVersionChange = () => {
        // Toggle IP version and set VxLAN to false
        const newIPVersion = formData.ip_version === 4 ? 6 : 4;
        setFormData((prevData) => ({
            ...prevData,
            ip_version: newIPVersion,
            vxlan: false,  // Set VxLAN to false when IP version changes
        }));
        data.ip_version = newIPVersion;
        data.vxlan = false;
    };

    const handleVxLANToggle = () => {
        setFormData((prevData) => ({
            ...prevData,
            vxlan: !prevData.vxlan  // Toggle VxLAN
        }))
        data.vxlan = !data.vxlan;
    }

    const handleEncapsulationChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        data.encapsulation = parseInt(event.target.value)
        if (data.encapsulation === Encapsulation.MPLS) {
            set_show(true);
        } else {
            set_show(false);
            data.number_of_lse = 0;
            set_number_of_lse(0);
            update_settings();
        }
    }

    const update_settings = () => {
        stream_settings_c.map((s, i) => {
            if (s.stream_id == data.stream_id) {
                if (s.mpls_stack.length > data.number_of_lse) {
                    // Newly set length is smaller than previous length. Remove the excess elements.
                    s.mpls_stack = s.mpls_stack.slice(0, data.number_of_lse)

                } else if (s.mpls_stack.length < data.number_of_lse) {
                    // Newly set length is larger than previous length. Fill with default MPLS headers
                    let new_mpls_stack: MPLSHeader[] = []
                    let elements_to_add = data.number_of_lse - s.mpls_stack.length

                    {
                        Array.from({length: elements_to_add}, (_, index) => {
                            new_mpls_stack.push(DefaultMPLSHeader())
                        })
                    }
                    s.mpls_stack = s.mpls_stack.concat(new_mpls_stack)
                }
            }
        })
    }

    const handleNumberOfLSE = (event: React.ChangeEvent<HTMLSelectElement>) => {
        set_number_of_lse(parseInt(event.target.value))
        data.number_of_lse = parseInt(event.target.value)
        update_settings()
    }

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
                    max={mode == GenerationMode.MPPS ? 200 : 100}
                    step={"any"}
                    type={"number"}
                    placeholder="Traffic rate"
                    defaultValue={data.traffic_rate > 0 ? data.traffic_rate : ""}
                />
                <InputGroup.Text>{mode == GenerationMode.MPPS ? "Mpps" : "Gbps"}</InputGroup.Text>
            </InputGroup>
        </StyledCol>
        <StyledCol>
            <tr>
                <td>
                    <Form.Select disabled={running} required
                                 onChange={(event: any) => data.burst = parseInt(event.target.value)}>
                        <option selected={100 === data.burst} value="100">Rate Precision</option>
                        <option selected={1 === data.burst} value="1">IAT Precision</option>
                    </Form.Select>
                </td>
                <td className={"col-1"}>
                    <InfoBox>
                        <>
                            <h5>Rate Precision</h5>

                            <p>In this mode, several packets may be generated at once (burst) to fit the configured traffic rate more precisely. </p>

                            <h5>IAT Precision</h5>

                            <p>In this mode, a single packet is generated at once and all packets have the same inter-arrival times. This mode should be used if the traffic should be very "smooth", i.e., without bursts.
                                However, the configured traffic rate may not be met precisely.</p>
                        </>
                    </InfoBox>
                </td>
            </tr>
        </StyledCol>
        <StyledCol>
            <Form.Check
                type={"switch"}
                disabled={running || formData.ip_version === 6}
                checked={formData.vxlan}
                onChange={handleVxLANToggle}
                >
            </Form.Check>
        </StyledCol>
        <StyledCol>
            <tr>
                <td>v4</td>
                <td>
                    <Form.Check
                        type={"switch"}
                        disabled={running}
                        checked={formData.ip_version === 6}
                        onChange={handleIPVersionChange}  // Toggle IP version and reset VxLAN
                        >
                    </Form.Check>
                </td>
                <td>v6</td>
            </tr>
        </StyledCol>        
        <StyledCol>
            <Form.Select disabled={running} required
                         onChange={handleEncapsulationChange}
            >
                <option selected={Encapsulation.None == data.encapsulation} value={Encapsulation.None}>None</option>
                <option selected={Encapsulation.Q == data.encapsulation} value={Encapsulation.Q}>VLAN (+4 byte)</option>
                <option selected={Encapsulation.QinQ == data.encapsulation} value={Encapsulation.QinQ}>Q-in-Q (+8
                    byte)
                </option>
                <option selected={Encapsulation.MPLS == data.encapsulation} value={Encapsulation.MPLS}>MPLS (+4 byte /
                    LSE)
                </option>
            </Form.Select>
        </StyledCol>
        <StyledRow>
            <StyledCol>
                {show_mpls_dropdown ?
                    <Form.Select disabled={running}
                                 onChange={handleNumberOfLSE}
                                 defaultValue={number_of_lse}
                    >
                        <option selected={0 == number_of_lse} value="0">#LSE</option>
                        {Array.from({length: 15}, (_, index) => (
                            <option selected={index + 1 == number_of_lse} value={index + 1}>{index + 1}</option>
                        ))}
                    </Form.Select>
                    :
                    null
                }
            </StyledCol>
            <StyledCol className={"text-end"}>
                <Button disabled={running} className={"btn-sm"} variant={"dark"}
                        onClick={() => remove(data.stream_id)}>
                    <i className="bi bi-trash2-fill"/></Button>
            </StyledCol>
        </StyledRow>
    </tr>
}

export default StreamElement