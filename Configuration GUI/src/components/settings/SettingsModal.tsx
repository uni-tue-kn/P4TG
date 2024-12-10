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

import { Encapsulation, Stream, StreamSettings} from "../../common/Interfaces";
import React, { useState } from "react";
import { Accordion, Button, Modal, Alert} from "react-bootstrap";

import { VLAN, Ethernet, IPv4, QinQ, VxLAN, MPLS, IPv6, SRv6 } from "./protocols";
import { validateIP, validateToS, validateMAC, validateMPLS, validateUdpPort, validateVNI, validateTrafficClass, validateFlowLabel, validateIPv6, validateSIDList} from "../../common/Validators";

export const randomMAC = (allow_multicast = true) => {
    let mac = "XX:XX:XX:XX:XX:XX".replace(/X/g, function () {
        return "0123456789ABCDEF".charAt(Math.floor(Math.random() * 16))
    })

    if (allow_multicast) {
        return mac
    }
    else { // non-multicast mac addresses have the least significant bit in the most significant octet set to 0
        let new_mac = mac.split("")
        new_mac[1] = "02468ACE".charAt(Math.floor(Math.random() * 8))
        return new_mac.join("")
    }
}

export const randomIP = () => {
    return (Math.floor(Math.random() * 255) + 1) + "." + (Math.floor(Math.random() * 255)) + "." + (Math.floor(Math.random() * 255)) + "." + (Math.floor(Math.random() * 255));

}

export const randomIPv6 = () => {
    const getRandomHexSegment = (): string => {
        // Generate a 4-digit hexadecimal segment
        return Math.floor(Math.random() * 0x10000).toString(16).padStart(4, "0");
    };

    // IPv6 address consists of 8 segments separated by colons
    const segments = Array.from({ length: 8 }, getRandomHexSegment);
    return segments.join(":");
}

const SettingsModal = ({
    show,
    hide,
    data,
    running,
    stream
}: {
    show: boolean,
    hide: () => void,
    data: StreamSettings,
    running: boolean,
    stream: Stream
}) => {

    const [tmp_data, set_tmp_data] = useState(data)
    const [alertMessage, setAlertMessage] = useState<string | null>(null);

    const update_data = (object: any) => {
        set_tmp_data(tmp_data => ({
            ...tmp_data,
            ...object
        }))
    }

    const submit = () => {
        if (!validateMAC(tmp_data.vxlan.eth_src)) {
            setAlertMessage("VxLAN Ethernet source not a valid MAC.")
            return
        }
        else if (!validateMAC(tmp_data.vxlan.eth_dst)) {
            setAlertMessage("VxLAN Ethernet destination not a valid MAC.")
            return
        }
        else if (!validateIP(tmp_data.vxlan.ip_src)) {
            setAlertMessage("VxLAN source IP not valid.")
            return
        }
        else if (!validateIP(tmp_data.vxlan.ip_dst)) {
            setAlertMessage("VxLAN destination IP not valid.")
            return
        }
        else if (!validateToS(tmp_data.vxlan.ip_tos)) {
            setAlertMessage("VxLAN IP ToS not valid.")
            return
        }
        else if (!validateUdpPort(tmp_data.vxlan.udp_source)) {
            setAlertMessage("VxLAN UDP source port not valid.")
            return
        }
        else if (!validateVNI(tmp_data.vxlan.vni)) {
            setAlertMessage("VxLAN VNI not valid.")
            return
        }
        else if (!validateMAC(tmp_data.ethernet.eth_src)) {
            setAlertMessage("Ethernet source not a valid MAC.")
            return
        } else if (!validateMAC(tmp_data.ethernet.eth_dst)) {
            setAlertMessage("Ethernet destination not a valid MAC.")
            return
        } else if (stream.ip_version == 4 && !validateIP(tmp_data.ip.ip_src)) {
            setAlertMessage("Source IP not valid.")
            return
        } else if (stream.ip_version == 4 && !validateIP(tmp_data.ip.ip_dst)) {
            setAlertMessage("Destination IP not valid.")
            return       
        } else if (stream.ip_version == 4 && !validateToS(tmp_data.ip.ip_tos)) {
            setAlertMessage("IP ToS not valid.")
            return
        } else if (stream.ip_version == 6 && !validateIPv6(tmp_data.ipv6.ipv6_src)) {
            setAlertMessage("Source IP not valid.")
            return
        } else if (stream.ip_version == 6 && !validateIPv6(tmp_data.ipv6.ipv6_dst)) {
            setAlertMessage("Destination IP not valid.")
            return
        } else if (stream.ip_version == 6 && !validateTrafficClass(tmp_data.ipv6.ipv6_traffic_class)) {
            setAlertMessage("IP traffic class not valid.")
            return          
        } else if (stream.ip_version == 6 && !validateFlowLabel(tmp_data.ipv6.ipv6_flow_label)) {
            setAlertMessage("IP flow label not valid.")
            return                
        } else if (!validateMPLS(tmp_data.mpls_stack)) {
            setAlertMessage("MPLS stack is not valid.")
            return
        } else if (!validateSIDList(tmp_data.sid_list)){
            setAlertMessage("SID list is not valid.")
            return            
        } else if (!validateIPv6(tmp_data.srv6_base_header.ipv6_src)) {
            setAlertMessage("SRv6 Source IP not valid.")
            return
        } else if (!validateIPv6(tmp_data.srv6_base_header.ipv6_dst)) {
            setAlertMessage("SRv6 destination IP not valid.")
        }
        // TODO mask validation

        setAlertMessage(null);

        data.vxlan = tmp_data.vxlan
        data.ethernet = tmp_data.ethernet
        data.vlan = tmp_data.vlan
        data.ip = tmp_data.ip
        data.ipv6 = tmp_data.ipv6
        data.srv6_base_header = tmp_data.srv6_base_header
        data.sid_list = tmp_data.sid_list
        data.mpls_stack = tmp_data.mpls_stack
        data.vlan = tmp_data.vlan

        hide()
    }

    const hideRestore = () => {
        set_tmp_data(data)
        setAlertMessage(null);
        hide()
    }

    return <Modal show={show} size="lg" onHide={hideRestore}>
        <Modal.Header closeButton>
            <Modal.Title>Stream #{stream.app_id}</Modal.Title>
        </Modal.Header>
        <form onSubmit={submit}>
            <Modal.Body>
                {alertMessage && (
                            <Alert
                                variant="danger"
                                onClose={() => setAlertMessage(null)}
                                dismissible
                            >
                                {alertMessage}
                            </Alert>
                        )}
                <Accordion defaultActiveKey={['0']} alwaysOpen>
                    {stream.vxlan ?
                        <> <Accordion.Item eventKey="5">
                            <Accordion.Header>VxLAN</Accordion.Header>
                            <Accordion.Body>
                                <VxLAN running={running} data={tmp_data} set_data={update_data} />
                            </Accordion.Body>
                        </Accordion.Item>
                        </>
                        :
                        null
                    }
                    <Accordion.Item eventKey="0">
                        <Accordion.Header>Ethernet</Accordion.Header>
                        <Accordion.Body>
                            <Ethernet data={tmp_data} set_data={update_data} running={running} />
                        </Accordion.Body>
                    </Accordion.Item>

                    {stream.encapsulation == Encapsulation.Q ?
                        <>
                            <Accordion.Item eventKey="2">
                                <Accordion.Header>VLAN</Accordion.Header>
                                <Accordion.Body>
                                    <VLAN data={tmp_data} set_data={update_data} running={running} />
                                </Accordion.Body>
                            </Accordion.Item>
                        </>
                        :
                        null}

                    {stream.encapsulation == Encapsulation.QinQ ?
                        <>
                            <Accordion.Item eventKey="3">
                                <Accordion.Header>QinQ</Accordion.Header>
                                <Accordion.Body>
                                    <QinQ data={tmp_data} set_data={update_data} running={running} />
                                </Accordion.Body>
                            </Accordion.Item>
                        </>
                        :
                        null}

                    {stream.encapsulation == Encapsulation.MPLS ?
                        <>
                            <Accordion.Item eventKey="0">
                                <Accordion.Header>MPLS</Accordion.Header>
                                <Accordion.Body>
                                    <MPLS stream={stream} data={tmp_data} set_data={set_tmp_data} running={running} />
                                </Accordion.Body>
                            </Accordion.Item>
                        </>
                        :
                        null
                    }

                    {stream.encapsulation == Encapsulation.SRv6 ?
                        <>
                            <Accordion.Item eventKey="0">
                                <Accordion.Header>SRv6</Accordion.Header>
                                <Accordion.Body>
                                    <SRv6 stream={stream} data={tmp_data} set_data={update_data} running={running} />
                                </Accordion.Body>
                            </Accordion.Item>
                        </>
                        :
                        null
                    }                    

                    {stream.ip_version == 6 ?
                        <>
                            <Accordion.Item eventKey="1">
                                <Accordion.Header>IPv6</Accordion.Header>
                                <Accordion.Body>
                                    <IPv6 data={tmp_data} set_data={update_data} running={running} />
                                </Accordion.Body>
                            </Accordion.Item>
                        </>
                        :
                        <Accordion.Item eventKey="1">
                            <Accordion.Header>IPv4</Accordion.Header>
                            <Accordion.Body>
                                <IPv4 data={tmp_data} set_data={update_data} running={running} />
                            </Accordion.Body>
                        </Accordion.Item>
                    }
                </Accordion>
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

export default SettingsModal