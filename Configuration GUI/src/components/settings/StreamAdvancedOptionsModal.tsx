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

import React, { useEffect, useState } from "react";
import { Accordion, Button, Form, Modal } from "react-bootstrap";
import {
    ASIC,
    DetNetSeqNumLength,
    Encapsulation,
    P4TGInfos,
    Stream,
} from "../../common/Interfaces";

type StreamAdvancedOptions = {
    detnet_cw: boolean;
    detnet_seq_num_length: DetNetSeqNumLength | null;
    mna_in_stack: boolean;
    mna_post_stack: boolean;
};

const defaultAdvancedOptions = (stream: Stream): StreamAdvancedOptions => ({
    detnet_cw: stream.detnet_cw ?? false,
    detnet_seq_num_length: stream.detnet_seq_num_length ?? null,
    mna_in_stack: stream.mna_in_stack ?? false,
    mna_post_stack: stream.mna_post_stack ?? false,
});

const StreamAdvancedOptionsModal = ({
    show,
    hide,
    data,
    disabled,
    p4tg_infos,
    set_data,
}: {
    show: boolean,
    hide: () => void,
    data: Stream,
    disabled: boolean,
    p4tg_infos: P4TGInfos,
    set_data: (updated: StreamAdvancedOptions) => void,
}) => {
    const [tmp_data, set_tmp_data] = useState<StreamAdvancedOptions>(
        defaultAdvancedOptions(data)
    );

    const detnetAvailable = data.encapsulation === Encapsulation.MPLS;
    const tofino1Ipv4Only = p4tg_infos.asic === ASIC.Tofino1;
    const postStackSupported = data.encapsulation === Encapsulation.MPLS
        && data.ip_version === 4
        && !data.vxlan
        && !data.gtpu
        && !tmp_data.detnet_cw;

    const postStackUnavailableReason = data.ip_version !== 4
        ? "Post-stack MNA is available with IPv4 only."
        : tmp_data.detnet_cw
            ? "Post-stack MNA cannot be combined with the DetNet Control Word."
            : data.vxlan
                ? "Post-stack MNA is not available together with VxLAN."
                : data.gtpu
                    ? "Post-stack MNA is not available together with GTP-U."
                    : null;

    useEffect(() => {
        if (show) {
            set_tmp_data(defaultAdvancedOptions(data));
        }
    }, [show, data]);

    const hideRestore = () => {
        set_tmp_data(defaultAdvancedOptions(data));
        hide();
    };

    const handleDetNetToggle = () => {
        set_tmp_data((prev) => ({
            ...(prev.mna_post_stack ? prev : {
                ...prev,
                detnet_cw: !prev.detnet_cw,
                detnet_seq_num_length: !prev.detnet_cw
                    ? (prev.detnet_seq_num_length ?? DetNetSeqNumLength.TwentyEight)
                    : null,
                mna_post_stack: !prev.detnet_cw ? false : prev.mna_post_stack,
            }),
        }));
    };

    const detnetDisabledByPostStack = tmp_data.mna_post_stack;

    const submit = () => {
        set_data({
            detnet_cw: tmp_data.detnet_cw,
            detnet_seq_num_length: tmp_data.detnet_cw
                ? (tmp_data.detnet_seq_num_length ?? DetNetSeqNumLength.TwentyEight)
                : null,
            mna_in_stack: tmp_data.mna_in_stack,
            mna_post_stack: tmp_data.mna_in_stack && postStackSupported && !tmp_data.detnet_cw
                ? tmp_data.mna_post_stack
                : false,
        });

        hide();
    };

    if (!detnetAvailable) {
        return null;
    }

    return (
        <Modal show={show} onHide={hideRestore}>
            <Modal.Header closeButton>
                <Modal.Title>Advanced stream options</Modal.Title>
            </Modal.Header>
            <form
                onSubmit={(e) => {
                    e.preventDefault();
                    submit();
                }}
            >
                <Modal.Body>
                    <Accordion alwaysOpen>
                        <Accordion.Item eventKey="0">
                            <Accordion.Header>DetNet</Accordion.Header>
                            <Accordion.Body>
                                <p className="text-muted mb-3">
                                    The DetNet Control Word (d-CW) is inserted after the MPLS stack. See{" "}
                                    <a
                                        href="https://datatracker.ietf.org/doc/html/rfc8964"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        RFC 8964
                                    </a>{" "}
                                    for the DetNet MPLS data-plane specification.
                                </p>

                                {tofino1Ipv4Only && (
                                    <p className="text-muted mb-3">
                                        On Tofino1, DetNet CW is supported only with IPv4.
                                    </p>
                                )}

                                {detnetDisabledByPostStack && (
                                    <p className="text-muted mb-3">
                                        Disable post-stack MNA before enabling the DetNet Control Word.
                                    </p>
                                )}

                                <Form.Group className="mb-3">
                                    <Form.Check
                                        type="switch"
                                        label="Enable DetNet Control Word"
                                        checked={tmp_data.detnet_cw}
                                        onChange={handleDetNetToggle}
                                        disabled={disabled || detnetDisabledByPostStack}
                                    />
                                </Form.Group>

                                <Form.Group>
                                    <Form.Label>Sequence number length</Form.Label>
                                    <Form.Select
                                        value={tmp_data.detnet_seq_num_length ?? ""}
                                        onChange={(e) =>
                                            set_tmp_data((prev) => ({
                                                ...prev,
                                                detnet_seq_num_length: e.target.value === ""
                                                    ? null
                                                    : (Number(e.target.value) as DetNetSeqNumLength),
                                            }))
                                        }
                                        disabled={disabled || !tmp_data.detnet_cw}
                                    >
                                        <option value="">Select sequence number length</option>
                                        <option value={DetNetSeqNumLength.Eight}>8 bit</option>
                                        <option value={DetNetSeqNumLength.Sixteen}>16 bit</option>
                                        <option value={DetNetSeqNumLength.TwentyEight}>28 bit</option>
                                    </Form.Select>
                                    <Form.Text className="text-muted">
                                        The first 4 bits of the d-CW remain zero; the sequence number uses
                                        8, 16, or 28 bits within the 32-bit field.
                                    </Form.Text>
                                    <Form.Text className="text-muted d-block">
                                        DetNet Control Word cannot be combined with post-stack MNA.
                                    </Form.Text>
                                </Form.Group>

                            </Accordion.Body>
                        </Accordion.Item>
                        <Accordion.Item eventKey="1">
                            <Accordion.Header>MNA</Accordion.Header>
                            <Accordion.Body>
                                <p className="text-muted mb-3">
                                    MPLS Network Actions (MNA) uses dedicated encodings for both
                                    in-stack and post-stack data inside the MPLS editor. See{" "}
                                    <a
                                        href="https://datatracker.ietf.org/doc/html/draft-ietf-mpls-mna-hdr-21"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        draft-ietf-mpls-mna-hdr-21
                                    </a>{" "}
                                    and{" "}
                                    <a
                                        href="https://datatracker.ietf.org/doc/html/draft-ietf-mpls-mna-ps-hdr-08"
                                        target="_blank"
                                        rel="noreferrer"
                                    >
                                        draft-ietf-mpls-mna-ps-hdr-08
                                    </a>{" "}
                                    for the post-stack header format.
                                </p>

                                {postStackUnavailableReason && (
                                    <p className="text-muted mb-3">
                                        {postStackUnavailableReason}
                                    </p>
                                )}

                                <Form.Group className="mb-3">
                                    <Form.Check
                                        type="switch"
                                        label="Enable MPLS Network Actions"
                                        checked={tmp_data.mna_in_stack}
                                        onChange={() =>
                                            set_tmp_data((prev) => ({
                                                ...prev,
                                                mna_in_stack: !prev.mna_in_stack,
                                                mna_post_stack: !prev.mna_in_stack
                                                    ? prev.mna_post_stack
                                                    : false,
                                            }))
                                        }
                                        disabled={disabled}
                                    />
                                </Form.Group>

                                <Form.Group>
                                    <Form.Check
                                        type="switch"
                                        label="Enable Post-Stack MNA"
                                        checked={tmp_data.mna_post_stack}
                                        onChange={() =>
                                            set_tmp_data((prev) => ({
                                                ...prev,
                                                mna_post_stack: !prev.mna_post_stack,
                                            }))
                                        }
                                        disabled={disabled || !tmp_data.mna_in_stack || !postStackSupported}
                                    />
                                    <Form.Text className="text-muted">
                                        Requires IPv4. DetNet Control Word, VxLAN, and GTP-U are not
                                        supported with post-stack MNA.
                                    </Form.Text>
                                </Form.Group>

                                {tmp_data.mna_in_stack && tmp_data.mna_post_stack && postStackSupported && (
                                    <>
                                        <p className="text-warning mt-3 mb-0">
                                            <strong>Warning:</strong> When post-stack data (PSD) is present on the
                                            receive path, RTT and packet loss measurement are not available. This
                                            only applies if the DuT does not pop/remove the post-stack data before
                                            sending the packet back to P4TG. If the DuT removes the MPLS stack (and
                                            therefore the PSD), RTT and packet loss measurement work as usual.
                                        </p>
                                        <p className="text-muted small mt-3 mb-0">
                                            <strong>Note:</strong> P4TG uses a non-standard PSMHT first-nibble
                                            value (pfn = 0x5 instead of 0x0) so the post-stack detection in the
                                            parser cannot alias DetNet d-CW (which fixes version = 0).
                                            This keeps RTT and packet-loss measurement exact for d-CW packets
                                            but makes the emitted PSMHT non-compliant with the draft encoding.
                                        </p>
                                    </>
                                )}
                            </Accordion.Body>
                        </Accordion.Item>
                    </Accordion>
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="secondary" onClick={hideRestore}>
                        Close
                    </Button>
                    <Button variant="primary" onClick={submit} disabled={disabled}>
                        Confirm
                    </Button>
                </Modal.Footer>
            </form>
        </Modal>
    );
};

export default StreamAdvancedOptionsModal;
