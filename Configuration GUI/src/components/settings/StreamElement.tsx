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
    DetNetSeqNumLength,
    DefaultMPLSHeader,
    Encapsulation,
    GenerationMode,
    MPLSHeader,
    Stream,
    StreamSettings,
    P4TGInfos,
    ASIC,
    GenerationUnit,
    GenerationPattern,
    GenerationPatternConfig
} from "../../common/Interfaces";
import React, { useState } from "react";
import { Button, Col, Form, InputGroup, OverlayTrigger, Row, Tooltip } from "react-bootstrap";
import InfoBox from "../InfoBox";
import { StyledCol, StyledRow } from "../../sites/Settings";
import PatternModal from "./PatternModal";
import StreamAdvancedOptionsModal from "./StreamAdvancedOptionsModal";
import { stripPostStackEncoding } from "./protocols/MPLSMNA";

const getDefaultFlashcrowdQuietUntil = (period: number) => period * 0.2;
const getDefaultFlashcrowdRampUntil = (period: number) => period * 0.25;
const optionsControlHeight = "44px";
const optionsButtonStyle = {
    height: optionsControlHeight,
    minWidth: optionsControlHeight,
    padding: "0.375rem 0.5rem",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
};
const optionsSelectStyle = {
    maxWidth: "92px",
    minWidth: "92px",
    height: optionsControlHeight,
};

const StreamElement = ({
    running,
    data,
    remove,
    mode,
    stream_settings,
    p4tg_infos
}: {
    running: boolean,
    data: Stream,
    remove: (id: number) => void,
    mode: GenerationMode,
    stream_settings: StreamSettings[],
    p4tg_infos: P4TGInfos
}) => {
    const [show_mpls_dropdown, set_show] = useState(data.encapsulation == Encapsulation.MPLS)
    const [show_sid_config, set_show_sid_config] = useState(data.encapsulation == Encapsulation.SRv6)
    const [number_of_lse, set_number_of_lse] = useState(data.number_of_lse)
    const [number_of_srv6_sids, set_number_of_srv6_sids] = useState(data.number_of_srv6_sids)
    const [patternConfig, setPatternConfig] = useState<GenerationPatternConfig | null>(data.pattern ?? null)
    const [showPatternModal, setShowPatternModal] = useState(false);
    const [showAdvancedOptionsModal, setShowAdvancedOptionsModal] = useState(false);

    // Used to store tunneling and IP Version setting. Tunneling must be disabled on changing IP version
    const [formData, setFormData] = useState({ ...data });

    const renderTooltip = (props: any, message: string) => (
        <Tooltip id="tooltip-stream-options" {...props}>
            {message}
        </Tooltip>
    );

    const updateFormData = (updates: Partial<Stream>) => {
        setFormData((prevData) => ({
            ...prevData,
            ...updates,
        }));
    };

    const getCurrentStreamSettings = () =>
        stream_settings.find((setting) => setting.stream_id === data.stream_id);

    const clearDetNetSettings = () => {
        data.detnet_cw = false;
        data.detnet_seq_num_length = null;
        updateFormData({
            detnet_cw: false,
            detnet_seq_num_length: null,
        });
    };

    const clearMNASettings = () => {
        data.mna_in_stack = false;
        data.mna_post_stack = false;
        updateFormData({
            mna_in_stack: false,
            mna_post_stack: false,
        });
    };

    const clearPostStackMNA = (updates: Partial<Stream> = {}) => {
        const currentSettings = getCurrentStreamSettings();
        if (currentSettings) {
            currentSettings.mpls_stack = stripPostStackEncoding(currentSettings.mpls_stack, data.number_of_lse);
        }
        data.mna_post_stack = false;
        updateFormData({
            ...updates,
            mna_post_stack: false,
        });
    };

    const enforceDetNetConstraints = (detnetEnabled: boolean) => {
        if (p4tg_infos.asic === ASIC.Tofino1 && data.encapsulation === Encapsulation.MPLS && detnetEnabled) {
            data.ip_version = 4;
            updateFormData({
                ip_version: 4,
            });
        }

        if (detnetEnabled && data.mna_post_stack) {
            clearPostStackMNA();
        }
    };

    const handleIPVersionChange = () => {
        // Toggle IP version and set tunneling to none
        const newIPVersion = formData.ip_version === 4 ? 6 : 4;
        data.ip_version = newIPVersion;
        data.vxlan = false;
        data.gtpu = false;
        if (newIPVersion !== 4) {
            clearPostStackMNA({
                ip_version: newIPVersion,
                vxlan: false,
                gtpu: false,
            });
            return;
        }
        updateFormData({
            ip_version: newIPVersion,
            vxlan: false,
            gtpu: false,
        });
    };

    const handleTunnelingChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        data.vxlan = value === "vxlan";
        data.gtpu = value === "gtpu";
        if (value !== "none") {
            clearPostStackMNA({
                vxlan: data.vxlan,
                gtpu: data.gtpu,
            });
            return;
        }
        updateFormData({
            vxlan: false,
            gtpu: false,
        });
    }

    const handleBatchesToggle = () => {
        updateFormData({
            batches: !formData.batches
        });
        data.batches = !data.batches;
    };

    const handleUnitChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        updateFormData({
            unit: data.unit
        })
        data.unit = parseInt(event.target.value);
    }

    const handleEncapsulationChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        data.encapsulation = parseInt(event.target.value)
        if (data.encapsulation === Encapsulation.MPLS) {
            set_show(true);
            set_show_sid_config(false);
            if (p4tg_infos.asic == ASIC.Tofino1) {
                // Disable tunneling. Not supported in combination with MPLS on Tofino 1
                updateFormData({
                    vxlan: false,
                    gtpu: false,
                    encapsulation: Encapsulation.MPLS
                });
                data.vxlan = false;
                data.gtpu = false;
            } else {
                updateFormData({
                    encapsulation: Encapsulation.MPLS
                });
            }
            enforceDetNetConstraints(data.detnet_cw);
        } else if (data.encapsulation === Encapsulation.SRv6) {
            set_show_sid_config(true);
            set_show(false);
            clearDetNetSettings();
            clearMNASettings();
            // Disable tunneling
            updateFormData({
                vxlan: false,
                gtpu: false,
                encapsulation: Encapsulation.SRv6
            });
            data.vxlan = false;
            data.gtpu = false;
        } else {
            set_show(false);
            set_show_sid_config(false);
            clearDetNetSettings();
            clearMNASettings();
            data.number_of_lse = 0;
            data.number_of_srv6_sids = 0;
            set_number_of_srv6_sids(0);
            set_number_of_lse(0);
            update_settings();
            updateFormData({
                encapsulation: data.encapsulation
            });
        }
    };

    const handleModeChange = (event: any) => {
        data.burst = parseInt(event.target.value)
        // Toggle burst precision mode off for IAT mode, on for rate mode
        updateFormData({
            batches: parseInt(event.target.value) !== 1
        });
        data.batches = parseInt(event.target.value) !== 1;
    }

    const update_settings = () => {
        const currentSettings = getCurrentStreamSettings();
        if (!currentSettings) {
            return;
        }

        const mpls_stack = currentSettings.mpls_stack ?? [];
        if (mpls_stack.length > data.number_of_lse) {
            currentSettings.mpls_stack = mpls_stack.slice(0, data.number_of_lse);
        } else if (mpls_stack.length < data.number_of_lse) {
            const elementsToAdd = data.number_of_lse - mpls_stack.length;
            const newMplsStack: MPLSHeader[] = Array.from({ length: elementsToAdd }, () => DefaultMPLSHeader());
            currentSettings.mpls_stack = mpls_stack.concat(newMplsStack);
        }

        const sid_list = currentSettings.sid_list ?? [];
        if (sid_list.length > data.number_of_srv6_sids) {
            currentSettings.sid_list = sid_list.slice(0, data.number_of_srv6_sids);
        } else if (sid_list.length < data.number_of_srv6_sids) {
            const elementsToAdd = data.number_of_srv6_sids - sid_list.length;
            const newSidList = Array.from({ length: elementsToAdd }, () => "fe80::");
            currentSettings.sid_list = sid_list.concat(newSidList);
        }
    }

    const handleNumberOfLSE = (event: React.ChangeEvent<HTMLSelectElement>) => {
        set_number_of_lse(parseInt(event.target.value));
        data.number_of_lse = parseInt(event.target.value);
        update_settings();
    };

    const handleNumberOfSids = (event: React.ChangeEvent<HTMLSelectElement>) => {
        set_number_of_srv6_sids(parseInt(event.target.value));
        data.number_of_srv6_sids = parseInt(event.target.value);
        update_settings();
    };

    const handleSRv6TunnelingChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        updateFormData({
            srv6_ip_tunneling: !formData.srv6_ip_tunneling  // Toggle IP tunneling
        });
        data.srv6_ip_tunneling = !data.srv6_ip_tunneling;
    };

    const applyAdvancedOptions = (updated: {
        detnet_cw: boolean;
        detnet_seq_num_length: DetNetSeqNumLength | null;
        mna_in_stack: boolean;
        mna_post_stack: boolean;
    }) => {
        const hadPostStack = data.mna_post_stack;
        const nextIpVersion = p4tg_infos.asic === ASIC.Tofino1 && updated.detnet_cw && data.encapsulation === Encapsulation.MPLS
            ? 4
            : data.ip_version;

        data.detnet_cw = updated.detnet_cw;
        data.detnet_seq_num_length = updated.detnet_cw
            ? (updated.detnet_seq_num_length ?? DetNetSeqNumLength.TwentyEight)
            : null;
        data.mna_in_stack = updated.mna_in_stack;
        data.mna_post_stack = updated.mna_post_stack;
        data.ip_version = nextIpVersion;

        const nextFormData: Partial<Stream> = {
            detnet_cw: data.detnet_cw,
            detnet_seq_num_length: data.detnet_seq_num_length,
            mna_in_stack: data.mna_in_stack,
            ip_version: nextIpVersion,
        };

        if (hadPostStack && !updated.mna_post_stack) {
            clearPostStackMNA(nextFormData);
            return;
        }

        updateFormData({
            ...nextFormData,
            mna_post_stack: data.mna_post_stack,
        });
    };

    const handlePatternTypeChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        if (event.target.value === "") {
            setPatternConfig(null);
            data.pattern = null;
            return;
        }

        const selectedType = event.target.value as GenerationPattern;
        const baseConfig: GenerationPatternConfig = patternConfig ?? {
            pattern_type: selectedType,
            period: 20_000_000_000,
            sample_rate: 128,
            fc_quiet_until: null,
            fc_ramp_until: null,
            fc_decay_rate: null,
            square_low: null,
            square_high_until: null,
        };

        const updatedConfig: GenerationPatternConfig = {
            ...baseConfig,
            pattern_type: selectedType,
            fc_quiet_until: selectedType === GenerationPattern.Flashcrowd
                ? (baseConfig.fc_quiet_until ?? getDefaultFlashcrowdQuietUntil(baseConfig.period))
                : null,
            fc_ramp_until: selectedType === GenerationPattern.Flashcrowd
                ? (baseConfig.fc_ramp_until ?? getDefaultFlashcrowdRampUntil(baseConfig.period))
                : null,
            fc_decay_rate: selectedType === GenerationPattern.Flashcrowd ? (baseConfig.fc_decay_rate ?? 4.0) : null,
        };

        setPatternConfig(updatedConfig);
        data.pattern = updatedConfig;
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
                    step={"any"}
                    type={"number"}
                    placeholder="Traffic rate"
                    defaultValue={data.traffic_rate > 0 ? data.traffic_rate : ""}
                />
                <Form.Select
                    style={{ width: "auto", flex: "0 0 auto", minWidth: "fit-content", whiteSpace: "nowrap" }}
                    disabled={running}
                    required
                    onChange={handleUnitChange}
                >
                    <option selected={GenerationUnit.Gbps === data.unit} value={GenerationUnit.Gbps}>Gbps</option>
                    <option selected={GenerationUnit.Mpps === data.unit} value={GenerationUnit.Mpps}>Mpps</option>
                </Form.Select>
            </InputGroup>
        </StyledCol>
        <StyledCol>
            <div className="d-flex align-items-center gap-2">
                <Form.Select disabled={running} required style={{ maxWidth: "150px" }}
                    onChange={handlePatternTypeChange}>
                    <option selected={patternConfig == null} value={""}>None</option>
                    <option selected={patternConfig?.pattern_type === GenerationPattern.Sine} value={GenerationPattern.Sine}>Sine</option>
                    <option selected={patternConfig?.pattern_type === GenerationPattern.Sawtooth} value={GenerationPattern.Sawtooth}>Sawtooth</option>
                    <option selected={patternConfig?.pattern_type === GenerationPattern.Triangle} value={GenerationPattern.Triangle}>Triangle</option>
                    <option selected={patternConfig?.pattern_type === GenerationPattern.Square} value={GenerationPattern.Square}>Square</option>
                    <option selected={patternConfig?.pattern_type === GenerationPattern.Flashcrowd} value={GenerationPattern.Flashcrowd}>Flashcrowd</option>
                </Form.Select>
                <Button
                    variant="outline-secondary"
                    size="sm"
                    disabled={running || patternConfig == null}
                    onClick={() => setShowPatternModal(true)}
                    title="Configure pattern"
                >
                    <i className="bi bi-gear-wide-connected" />
                </Button>
            </div>
        </StyledCol>
        <StyledCol>
            <tr>
                <td className={"col-auto"}>
                    <Form.Select disabled={running} required
                        onChange={handleModeChange}>
                        <option selected={100 === data.burst} value="100">Rate Precision</option>
                        <option selected={1 === data.burst} value="1">IAT Precision</option>
                    </Form.Select>
                </td>
                <td className={"col-1"}>
                    Bursts
                    <Form.Check disabled={running}
                        type={"switch"}
                        checked={formData.batches}
                        onChange={handleBatchesToggle}>
                    </Form.Check>
                </td>
                <td className={"col-auto"}>
                    <InfoBox>
                        <>
                            <h5>Bursts</h5>
                            <p>Increases the burstiness to fit the configured traffic rate even more precisely. In rate precision mode, this increases the size of the bursts by a constant factor. In IAT precision mode, this toggles the generation on a single or on all pipes.</p>
                        </>
                    </InfoBox>
                </td>
            </tr>
        </StyledCol>
        <StyledCol>
            <Form.Select
                disabled={running || formData.ip_version === 6 || (p4tg_infos.asic === ASIC.Tofino1 && formData.encapsulation === Encapsulation.MPLS) || formData.encapsulation === Encapsulation.SRv6}
                value={formData.vxlan ? "vxlan" : formData.gtpu ? "gtpu" : "none"}
                onChange={handleTunnelingChange}
            >
                <option value="none">None</option>
                <option value="vxlan">VxLAN</option>
                <option value="gtpu">GTP-U</option>
            </Form.Select>
        </StyledCol>
        <StyledCol>
            <Row>
                <Col className={"text-end"}><span>v4</span></Col>
                <Col>
                    <Form.Check
                        type={"switch"}
                        disabled={running
                            || (data.encapsulation == Encapsulation.SRv6 && !data.srv6_ip_tunneling)
                            || (p4tg_infos.asic === ASIC.Tofino1
                                && data.encapsulation === Encapsulation.MPLS
                                && data.detnet_cw)}
                        checked={formData.ip_version === 6}
                        onChange={handleIPVersionChange}  // Toggle IP version and reset VxLAN
                    >
                    </Form.Check>
                </Col>
                <Col className={"text-start"}><span>v6</span></Col>
            </Row>
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
                {p4tg_infos.asic == ASIC.Tofino2 ? <option selected={Encapsulation.SRv6 == data.encapsulation} value={Encapsulation.SRv6}>SRv6 (+48 byte + 16 byte / SID)
                </option>
                    :
                    null}
            </Form.Select>
        </StyledCol>
        <StyledRow>
            <StyledCol style={{ textIndent: 0 }}>
                <div className="d-flex align-items-center justify-content-end gap-2 flex-nowrap">
                    {show_mpls_dropdown ?
                        <Form.Select
                            disabled={running}
                            onChange={handleNumberOfLSE}
                            defaultValue={number_of_lse}
                            style={optionsSelectStyle}
                        >
                            <option selected={0 == number_of_lse} value="0">#LSE</option>
                            {Array.from({ length: 15 }, (_, index) => (
                                <option selected={index + 1 == number_of_lse} value={index + 1}>{index + 1}</option>
                            ))}
                        </Form.Select>
                        :
                        null
                    }
                    {show_sid_config ?
                        <Form.Group className="mb-0">
                            <Form.Select
                                disabled={running}
                                onChange={handleNumberOfSids}
                                defaultValue={number_of_srv6_sids}
                                style={optionsSelectStyle}
                            >
                                <option selected={0 == number_of_srv6_sids} value="0">#SIDs</option>
                                {Array.from({ length: 3 }, (_, index) => (
                                    <option selected={index + 1 == number_of_srv6_sids} value={index + 1}>{index + 1}</option>
                                ))}
                            </Form.Select>
                            <tr>
                                <td>IP Tunneling</td>
                                <td>
                                    <Form.Check
                                        type={"switch"}
                                        disabled={running}
                                        checked={data.srv6_ip_tunneling}
                                        onChange={handleSRv6TunnelingChange}
                                    >
                                    </Form.Check>
                                </td>
                                <td>
                                    <InfoBox>
                                        <>
                                            <h5>IP Tunneling</h5>

                                            <p>Adds an inner IPv4 or IPv6 header to the packet, if enabled. If disabled, the UDP header follows directly after the SRv6 header.</p>

                                        </>
                                    </InfoBox>
                                </td>
                            </tr>
                        </Form.Group>
                        :
                        null
                    }
                </div>
            </StyledCol>
            <StyledCol style={{ textIndent: 0 }}>
                <div className="d-flex align-items-center justify-content-end gap-2 flex-nowrap">
                    {data.encapsulation === Encapsulation.MPLS ? (
                        <OverlayTrigger
                            placement="top"
                            overlay={(props) => renderTooltip(props, "Advanced stream options")}
                        >
                            <Button
                                size={"sm"}
                                disabled={running}
                                variant={"outline-secondary"}
                                style={optionsButtonStyle}
                                onClick={() => setShowAdvancedOptionsModal(true)}
                            >
                                <i className="bi bi-sliders" />
                            </Button>
                        </OverlayTrigger>
                    ) : null}
                    <Button
                        size={"sm"}
                        disabled={running}
                        variant={"outline-secondary"}
                        style={optionsButtonStyle}
                        onClick={() => remove(data.stream_id)}
                    >
                        <i className="bi bi-trash2-fill" />
                    </Button>
                </div>
            </StyledCol>
        </StyledRow>
        <PatternModal
            show={showPatternModal}
            hide={() => setShowPatternModal(false)}
            data={patternConfig ?? {
                pattern_type: GenerationPattern.Sine,
                period: 20_000_000_000,
                sample_rate: 128,
                fc_quiet_until: null,
                fc_ramp_until: null,
                fc_decay_rate: null,
                square_low: null,
                square_high_until: null,
            }}
            disabled={running}
            set_data={(updated) => {
                setPatternConfig(updated);
                data.pattern = updated;
            }}
        />
        {data.encapsulation === Encapsulation.MPLS ? (
            <StreamAdvancedOptionsModal
                show={showAdvancedOptionsModal}
                hide={() => setShowAdvancedOptionsModal(false)}
                data={data}
                disabled={running}
                p4tg_infos={p4tg_infos}
                set_data={applyAdvancedOptions}
            />
        ) : null}
    </tr>
}

export default StreamElement
