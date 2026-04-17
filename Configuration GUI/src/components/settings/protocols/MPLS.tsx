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

import React, { useEffect, useState } from "react";
import { Alert, Button, Col, Dropdown, Form, OverlayTrigger, Row, Tooltip } from "react-bootstrap";
import { StyledRow } from "../../../sites/Settings";
import { DefaultMPLSHeader, Stream, StreamSettings } from "../../../common/Interfaces";
import {
    computeMNAState,
    createDefaultMNAEditorEntries,
    decodeMNAEditorEntries,
    MNA_BSPL_LABEL,
    MNAComputedRow,
    MNAEditorEntry,
    MNAIhsScope,
    normalizePostStackEntries,
} from "./MPLSMNA";

interface Props {
    stream: Stream,
    data: StreamSettings,
    set_data: React.Dispatch<React.SetStateAction<StreamSettings>>,
    running: boolean
}

const ensureStackLength = (stack: StreamSettings["mpls_stack"], length: number) => {
    const next = (stack ?? []).map((header) => ({ ...header }));

    while (next.length < length) {
        next.push(DefaultMPLSHeader());
    }

    return next.slice(0, length);
};

const stacksEqual = (left: StreamSettings["mpls_stack"], right: StreamSettings["mpls_stack"]) => {
    if ((left?.length ?? 0) !== (right?.length ?? 0)) {
        return false;
    }

    return (left ?? []).every((header, index) => {
        const other = right?.[index];
        return (
            !!other &&
            header.label === other.label &&
            header.tc === other.tc &&
            header.bos === other.bos &&
            header.ttl === other.ttl
        );
    });
};

const cloneEntries = (entries: MNAEditorEntry[]) =>
    entries.map((entry) => ({
        plain: { ...entry.plain },
        isNasi: entry.isNasi,
        isPsmht: entry.isPsmht,
        formatB: { ...entry.formatB },
        formatC: { ...entry.formatC },
        formatD: { ...entry.formatD },
        psmht: { ...entry.psmht },
        psna: { ...entry.psna },
        psData: { ...entry.psData },
    }));

const clearPostStackMarkersAfter = (entries: MNAEditorEntry[], index: number) => {
    for (let markerIndex = index + 1; markerIndex < entries.length; markerIndex += 1) {
        entries[markerIndex].isPsmht = false;
    }
};

const sanitizeEntriesForFeatureFlags = (entries: MNAEditorEntry[], allowPostStack: boolean) => {
    if (!allowPostStack) {
        entries.forEach((entry) => {
            entry.isPsmht = false;
            entry.formatB.p = false;
        });
        return;
    }

    normalizePostStackEntries(entries);
};

const ihsLabel = (value: MNAIhsScope) => {
    switch (value) {
        case MNAIhsScope.I2E:
            return "I2E";
        case MNAIhsScope.HBH:
            return "HBH";
        case MNAIhsScope.Select:
            return "Select";
        case MNAIhsScope.Reserved:
        default:
            return "Reserved";
    }
};

const roleLabel = (row: MNAComputedRow) => {
    switch (row.role) {
        case "formatA":
            return "Format A";
        case "formatB":
            return "Format B";
        case "formatC":
            return "Format C";
        case "formatD":
            return "Format D";
        case "psmht":
            return "PSMHT";
        case "psna":
            return "PSNA";
        case "psData":
            return "PS Data";
        case "plain":
        default:
            return "Plain MPLS";
    }
};

const roleBadgeStyle = (role: MNAComputedRow["role"]): React.CSSProperties => {
    switch (role) {
        case "formatA":
            return { backgroundColor: "#1e3a8a", color: "#ffffff" };
        case "formatB":
            return { backgroundColor: "#2563eb", color: "#ffffff" };
        case "formatC":
            return { backgroundColor: "#60a5fa", color: "#0f172a" };
        case "formatD":
            return { backgroundColor: "#bfdbfe", color: "#0f172a" };
        case "psmht":
            return { backgroundColor: "#92400e", color: "#ffffff" };
        case "psna":
            return { backgroundColor: "#d97706", color: "#ffffff" };
        case "psData":
            return { backgroundColor: "#fcd34d", color: "#0f172a" };
        case "plain":
        default:
            return { backgroundColor: "#6b7280", color: "#ffffff" };
    }
};

const renderTooltip = (props: any, message: string) => (
    <Tooltip id="tooltip-mna-help" {...props}>
        {message}
    </Tooltip>
);

const responsiveFieldCol = {
    xs: 12,
    sm: 6,
    lg: 3,
};

const responsiveCompactCol = {
    xs: 12,
    sm: 6,
    xl: 2,
};

const responsiveSmallSelectCol = {
    xs: 6,
    sm: 4,
    lg: 3,
    xl: "auto" as const,
};

const MPLS = ({ stream, data, set_data, running }: Props) => {
    const stackLength = stream.number_of_lse;
    const allowPostStack = stream.mna_post_stack === true;
    const normalizedStack = ensureStackLength(data.mpls_stack, stackLength);
    const [mnaEntries, setMnaEntries] = useState<MNAEditorEntry[]>(() =>
        createDefaultMNAEditorEntries(normalizedStack, stackLength)
    );
    const [mnaAlert, setMnaAlert] = useState<string | null>(null);

    const syncStack = (nextStack: StreamSettings["mpls_stack"]) => {
        set_data((prev) => {
            if (stacksEqual(prev.mpls_stack, nextStack)) {
                return prev;
            }

            return {
                ...prev,
                mpls_stack: nextStack,
            };
        });
    };

    useEffect(() => {
        const nextNormalizedStack = ensureStackLength(data.mpls_stack, stackLength);
        const syncEffectStack = (nextStack: StreamSettings["mpls_stack"]) => {
            set_data((prev) => {
                if (stacksEqual(prev.mpls_stack, nextStack)) {
                    return prev;
                }

                return {
                    ...prev,
                    mpls_stack: nextStack,
                };
            });
        };

        if (!stream.mna_in_stack) {
            syncEffectStack(nextNormalizedStack);
            setMnaEntries(createDefaultMNAEditorEntries(nextNormalizedStack, stackLength));
            setMnaAlert(null);
            return;
        }

        const decoded = decodeMNAEditorEntries(nextNormalizedStack, stackLength, {
            allowPostStack,
        });
        sanitizeEntriesForFeatureFlags(decoded.entries, allowPostStack);
        const computed = computeMNAState(decoded.entries, {
            allowPostStack,
        });

        setMnaEntries(decoded.entries);
        setMnaAlert(decoded.error ?? computed.error);
        syncEffectStack(computed.encodedStack);
    }, [allowPostStack, data.mpls_stack, set_data, stackLength, stream.mna_in_stack]);

    const updatePlainHeader = (index: number, field: "label" | "tc" | "ttl", value: number) => {
        if (stream.mna_in_stack) {
            const nextEntries = cloneEntries(mnaEntries);
            nextEntries[index].plain[field] = value;
            sanitizeEntriesForFeatureFlags(nextEntries, allowPostStack);
            const computed = computeMNAState(nextEntries, {
                allowPostStack,
            });
            setMnaEntries(nextEntries);
            setMnaAlert(computed.error);
            syncStack(computed.encodedStack);
            return;
        }

        const nextStack = ensureStackLength(data.mpls_stack, stackLength);
        nextStack[index][field] = value;
        syncStack(nextStack);
    };

    const applyMnaUpdate = (mutate: (entries: MNAEditorEntry[], computedRows: MNAComputedRow[]) => void) => {
        const nextEntries = cloneEntries(mnaEntries);
        const current = computeMNAState(nextEntries, {
            allowPostStack,
        });
        mutate(nextEntries, current.rows);
        sanitizeEntriesForFeatureFlags(nextEntries, allowPostStack);
        const computed = computeMNAState(nextEntries, {
            allowPostStack,
        });
        setMnaEntries(nextEntries);
        setMnaAlert(computed.error);
        syncStack(computed.encodedStack);
    };

    const computedMna = computeMNAState(mnaEntries, {
        allowPostStack,
    });

    const renderPlainEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col xs={12} sm={6} lg={3}>
                {showLabels && <Form.Label className="mb-1">Label</Form.Label>}
                <Form.Control
                    value={row.plain.label}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        updatePlainHeader(index, "label", parseInt(event.target.value, 10) || 0)
                    }
                    min={0}
                    max={2 ** 20 - 1}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col xs={6} sm={3} lg={2}>
                {showLabels && <Form.Label className="mb-1">TC</Form.Label>}
                <Form.Control
                    value={row.plain.tc}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        updatePlainHeader(index, "tc", parseInt(event.target.value, 10) || 0)
                    }
                    min={0}
                    max={7}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col xs={6} sm={3} lg={2}>
                {showLabels && <Form.Label className="mb-1">TTL</Form.Label>}
                <Form.Control
                    value={row.plain.ttl}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        updatePlainHeader(index, "ttl", parseInt(event.target.value, 10) || 0)
                    }
                    min={0}
                    max={255}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            {stream.mna_in_stack ? (
                <Col xs={12} lg={5} className="d-flex align-items-end gap-2 flex-wrap">
                    {allowPostStack ? (
                        <OverlayTrigger
                            placement="top"
                            overlay={(props) =>
                                renderTooltip(
                                    props,
                                    "Choose whether this free row starts an in-stack NAS or a post-stack MNA section."
                                )
                            }
                        >
                            <Dropdown className="mna-action-dropdown">
                                <Dropdown.Toggle
                                    variant="outline-secondary"
                                    className="mna-action-button"
                                    disabled={running || (!row.canBeNasi && !row.canBePsmht)}
                                >
                                    Add MNA
                                </Dropdown.Toggle>
                                <Dropdown.Menu>
                                    <Dropdown.Item
                                        disabled={!row.canBeNasi}
                                        onClick={() =>
                                            applyMnaUpdate((entries) => {
                                                entries[index].isNasi = true;
                                            })
                                        }
                                    >
                                        Add NASI
                                    </Dropdown.Item>
                                    <Dropdown.Item
                                        disabled={!row.canBePsmht}
                                        onClick={() =>
                                            applyMnaUpdate((entries) => {
                                                clearPostStackMarkersAfter(entries, index);
                                                entries[index].isPsmht = true;
                                                entries[index].psmht.psmhLen = entries.length - index - 1;
                                            })
                                        }
                                    >
                                        Add Post-Stack Header
                                    </Dropdown.Item>
                                </Dropdown.Menu>
                            </Dropdown>
                        </OverlayTrigger>
                    ) : (
                        <OverlayTrigger
                            placement="top"
                            overlay={(props) =>
                                renderTooltip(
                                    props,
                                    row.canBeNasi
                                        ? "Mark this LSE as the MNA sub-stack indicator."
                                        : row.nasiDisabledReason ?? "This row cannot be NASI."
                                )
                            }
                        >
                            <span className="d-inline-block">
                                <Button
                                    variant="outline-secondary"
                                    className="mna-action-button"
                                    disabled={running || !row.canBeNasi}
                                    onClick={() =>
                                        applyMnaUpdate((entries) => {
                                            entries[index].isNasi = true;
                                        })
                                    }
                                >
                                    Add NASI
                                </Button>
                            </span>
                        </OverlayTrigger>
                    )}
                </Col>
            ) : null}
        </Row>
    );

    const renderFormatAEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col xs={12} sm={6} lg={3}>
                {showLabels && <Form.Label className="mb-1">Label</Form.Label>}
                <Form.Control value={MNA_BSPL_LABEL} disabled type="number" />
            </Col>
            <Col xs={6} sm={3} lg={2}>
                {showLabels && <Form.Label className="mb-1">TC</Form.Label>}
                <Form.Control value={row.plain.tc} disabled type="number" />
            </Col>
            <Col xs={6} sm={3} lg={2}>
                {showLabels && <Form.Label className="mb-1">TTL</Form.Label>}
                <Form.Control value={row.plain.ttl} disabled type="number" />
            </Col>
            <Col xs={12} lg={5} className="d-flex align-items-end">
                <Button
                    variant="outline-secondary"
                    className="mna-action-button"
                    disabled={running}
                    onClick={() =>
                        applyMnaUpdate((entries) => {
                            entries[index].isNasi = false;
                            if (entries[index].plain.label === MNA_BSPL_LABEL) {
                                entries[index].plain = DefaultMPLSHeader();
                            }
                        })
                    }
                >
                    Remove NASI
                </Button>
            </Col>
        </Row>
    );

    const renderFormatBEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col {...responsiveCompactCol}>
                {showLabels && <Form.Label className="mb-1">Opcode</Form.Label>}
                <Form.Control
                    value={row.formatB.opcode}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.opcode = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 127);
                        })
                    }
                    min={0}
                    max={127}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col {...responsiveCompactCol}>
                {showLabels && <Form.Label className="mb-1">Data</Form.Label>}
                <Form.Control
                    value={row.formatB.data}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.data = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 0x1fff);
                        })
                    }
                    min={0}
                    max={0x1fff}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col xs={12} sm={6} xl={2}>
                {showLabels && <Form.Label className="mb-1">IHS</Form.Label>}
                <Form.Select
                    value={row.formatB.ihs}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.ihs = parseInt(event.target.value, 10) as MNAIhsScope;
                        })
                    }
                    disabled={running}
                >
                    {[MNAIhsScope.I2E, MNAIhsScope.HBH, MNAIhsScope.Select, MNAIhsScope.Reserved].map((scope) => (
                        <option key={scope} value={scope}>{ihsLabel(scope)}</option>
                    ))}
                </Form.Select>
            </Col>
            {allowPostStack ? (
                <Col xs={6} sm={4} lg={3} xl={1}>
                    {showLabels && <Form.Label className="mb-1">P</Form.Label>}
                    <Form.Check
                        type="switch"
                        checked={row.formatB.p}
                        onChange={() =>
                            applyMnaUpdate((entries) => {
                                entries[index].formatB.p = !entries[index].formatB.p;
                            })
                        }
                        disabled={running}
                    />
                </Col>
            ) : null}
            <Col {...responsiveSmallSelectCol}>
                {showLabels && <Form.Label className="mb-1">NASL</Form.Label>}
                <Form.Select
                    value={row.formatB.nasl}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.nasl = parseInt(event.target.value, 10);
                            if (entries[index].formatB.nal > entries[index].formatB.nasl) {
                                entries[index].formatB.nal = entries[index].formatB.nasl;
                            }
                        })
                    }
                    disabled={running || row.maxNasl === 0}
                    style={{ width: "3.85rem", maxWidth: "100%" }}
                >
                    {Array.from({ length: row.maxNasl + 1 }, (_, option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </Form.Select>
            </Col>
            <Col {...responsiveSmallSelectCol}>
                {showLabels && <Form.Label className="mb-1">NAL</Form.Label>}
                <Form.Select
                    value={row.formatB.nal}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.nal = parseInt(event.target.value, 10);
                        })
                    }
                    disabled={running || row.formatB.nasl === 0}
                    style={{ width: "3.85rem", maxWidth: "100%" }}
                >
                    {Array.from({ length: row.formatB.nasl + 1 }, (_, option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </Form.Select>
            </Col>
            <Col xs={6} md="auto" className="d-flex flex-column align-items-md-end">
                {showLabels && (
                    <Form.Label className="mb-1 d-flex align-items-center gap-1">
                        <span>U</span>
                        <OverlayTrigger
                            placement="top"
                            overlay={(props) => renderTooltip(props, "Unknown Action handling")}
                        >
                            <span className="text-muted" style={{ cursor: "help" }}>
                                <i className="bi bi-question-circle" />
                            </span>
                        </OverlayTrigger>
                    </Form.Label>
                )}
                <Form.Select
                    value={row.formatB.u ? "drop" : "ignore"}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.u = event.target.value === "drop";
                        })
                    }
                    disabled={running}
                    style={{ width: "4rem", maxWidth: "100%" }}
                >
                    <option value="ignore">Ign.</option>
                    <option value="drop">Drop</option>
                </Form.Select>
            </Col>
        </Row>
    );

    const renderFormatCEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col {...responsiveFieldCol}>
                {showLabels && <Form.Label className="mb-1">Opcode</Form.Label>}
                <Form.Control
                    value={row.formatC.opcode}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatC.opcode = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 127);
                        })
                    }
                    min={0}
                    max={127}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col {...responsiveFieldCol}>
                {showLabels && <Form.Label className="mb-1">Data</Form.Label>}
                <Form.Control
                    value={row.formatC.data}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatC.data = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 0x7ffff);
                        })
                    }
                    min={0}
                    max={0x7ffff}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col xs={6} sm={4} lg={2}>
                {showLabels && <Form.Label className="mb-1">NAL</Form.Label>}
                <Form.Select
                    value={row.formatC.nal}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatC.nal = parseInt(event.target.value, 10);
                        })
                    }
                    disabled={running || row.maxNal === 0}
                >
                    {Array.from({ length: row.maxNal + 1 }, (_, option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </Form.Select>
            </Col>
            <Col xs={6} md="auto" className="d-flex flex-column align-items-md-end">
                {showLabels && (
                    <Form.Label className="mb-1 d-flex align-items-center gap-1">
                        <span>U</span>
                        <OverlayTrigger
                            placement="top"
                            overlay={(props) => renderTooltip(props, "Unknown Action handling")}
                        >
                            <span className="text-muted" style={{ cursor: "help" }}>
                                <i className="bi bi-question-circle" />
                            </span>
                        </OverlayTrigger>
                    </Form.Label>
                )}
                <Form.Select
                    value={row.formatC.u ? "drop" : "ignore"}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatC.u = event.target.value === "drop";
                        })
                    }
                    disabled={running}
                    style={{ width: "4rem", maxWidth: "100%" }}
                >
                    <option value="ignore">Ign.</option>
                    <option value="drop">Drop</option>
                </Form.Select>
            </Col>
        </Row>
    );

    const renderFormatDEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col xs={12} sm={6} lg={4}>
                {showLabels && <Form.Label className="mb-1">Data</Form.Label>}
                <Form.Control
                    value={row.formatD.data}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatD.data = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 0x3fffffff);
                        })
                    }
                    min={0}
                    max={0x3fffffff}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
        </Row>
    );

    const renderPsmhtEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col xs={12} sm={6} lg={4}>
                {showLabels && <Form.Label className="mb-1">PSMH-Len</Form.Label>}
                <Form.Select
                    value={row.psmht.psmhLen}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].psmht.psmhLen = parseInt(event.target.value, 10);
                            clearPostStackMarkersAfter(entries, index);
                        })
                    }
                    disabled={running || row.maxPsmhLen <= 1}
                >
                    {Array.from({ length: Math.max(row.maxPsmhLen, 1) }, (_, option) => option + 1).map((option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </Form.Select>
            </Col>
            <Col xs={12} sm={6} lg={5} className="d-flex align-items-end">
                <Button
                    variant="outline-secondary"
                    className="mna-action-button"
                    disabled={running}
                    onClick={() =>
                        applyMnaUpdate((entries) => {
                            let previousPsmhtIndex = -1;
                            for (let markerIndex = index - 1; markerIndex >= 0; markerIndex -= 1) {
                                if (entries[markerIndex].isPsmht) {
                                    previousPsmhtIndex = markerIndex;
                                    break;
                                }
                            }
                            clearPostStackMarkersAfter(entries, index);
                            entries[index].isPsmht = false;
                            if (previousPsmhtIndex !== -1) {
                                entries[previousPsmhtIndex].psmht.psmhLen = entries.length - previousPsmhtIndex - 1;
                            }
                        })
                    }
                >
                    Remove Post-Stack Header
                </Button>
            </Col>
        </Row>
    );

    const renderPsnaEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col {...responsiveFieldCol}>
                {showLabels && <Form.Label className="mb-1">Opcode</Form.Label>}
                <Form.Control
                    value={row.psna.opcode}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].psna.opcode = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 127);
                        })
                    }
                    min={0}
                    max={127}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col {...responsiveFieldCol}>
                {showLabels && <Form.Label className="mb-1">Data</Form.Label>}
                <Form.Control
                    value={row.psna.data}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].psna.data = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 0xffff);
                        })
                    }
                    min={0}
                    max={0xffff}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col xs={12} sm={6} lg={3}>
                {showLabels && <Form.Label className="mb-1">PS-NAL</Form.Label>}
                <Form.Select
                    value={row.psna.psNal}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].psna.psNal = parseInt(event.target.value, 10);
                        })
                    }
                    disabled={running || row.maxPsNal === 0}
                >
                    {Array.from({ length: row.maxPsNal + 1 }, (_, option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </Form.Select>
            </Col>
        </Row>
    );

    const renderPsDataEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col xs={12} sm={6} lg={4}>
                {showLabels && <Form.Label className="mb-1">Data</Form.Label>}
                <Form.Control
                    value={row.psData.data}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].psData.data = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 0xffffffff);
                        })
                    }
                    min={0}
                    max={0xffffffff}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
        </Row>
    );

    if (stackLength === 0) {
        return <Form.Text className="text-muted">Configure at least one MPLS LSE to edit the stack.</Form.Text>;
    }

    const asPlainComputedRow = (index: number, header: typeof normalizedStack[number]): MNAComputedRow => ({
        index,
        role: "plain",
        plain: header,
        isNasi: false,
        isPsmht: false,
        formatB: { opcode: 0, data: 0, ihs: MNAIhsScope.I2E, p: false, u: false, nasl: 0, nal: 0 },
        formatC: { opcode: 0, data: 0, u: false, nal: 0 },
        formatD: { data: 0 },
        psmht: { psmhLen: 1 },
        psna: { opcode: 0, psNal: 0, data: 0 },
        psData: { data: 0 },
        ownerIndex: null,
        canBeNasi: false,
        nasiDisabledReason: null,
        canBePsmht: false,
        psmhtDisabledReason: null,
        maxNasl: 0,
        maxNal: 0,
        maxPsmhLen: 0,
        maxPsNal: 0,
    });

    const rowsToRender: MNAComputedRow[] = stream.mna_in_stack
        ? computedMna.rows
        : normalizedStack.map((header, index) => asPlainComputedRow(index, header));

    type RenderGroup =
        | { type: "plain"; row: MNAComputedRow }
        | { type: "nas"; rows: MNAComputedRow[] }
        | { type: "postStack"; rows: MNAComputedRow[] };

    const groups: RenderGroup[] = [];
    let cursor = 0;
    while (cursor < rowsToRender.length) {
        const current = rowsToRender[cursor];
        if (!stream.mna_in_stack || current.role === "plain") {
            groups.push({ type: "plain", row: current });
            cursor += 1;
            continue;
        }
        const groupType = current.role === "psmht" ? "postStack" : "nas";
        const groupedRows: MNAComputedRow[] = [rowsToRender[cursor]];
        cursor += 1;
        while (
            cursor < rowsToRender.length
            && rowsToRender[cursor].role !== "plain"
            && rowsToRender[cursor].role !== "formatA"
            && rowsToRender[cursor].role !== "psmht"
        ) {
            groupedRows.push(rowsToRender[cursor]);
            cursor += 1;
        }
        groups.push({ type: groupType, rows: groupedRows });
    }

    const renderEditor = (row: MNAComputedRow, showLabels: boolean) => {
        switch (row.role) {
            case "formatA":
                return renderFormatAEditor(row.index, row, showLabels);
            case "formatB":
                return renderFormatBEditor(row.index, row, showLabels);
            case "formatC":
                return renderFormatCEditor(row.index, row, showLabels);
            case "formatD":
                return renderFormatDEditor(row.index, row, showLabels);
            case "psmht":
                return renderPsmhtEditor(row.index, row, showLabels);
            case "psna":
                return renderPsnaEditor(row.index, row, showLabels);
            case "psData":
                return renderPsDataEditor(row.index, row, showLabels);
            case "plain":
            default:
                return renderPlainEditor(row.index, row, showLabels);
        }
    };

    const renderPlainStackHeader = () => (
        <Form.Group as={StyledRow} className="mb-2" controlId="mpls-plain-header">
            <div className="col-3" />
            <Col className="col-9 text-start">
                <Row className="g-2 align-items-end">
                    <Col xs={12} sm={6} lg={3}>
                        <Form.Label className="mb-1">Label</Form.Label>
                    </Col>
                    <Col xs={6} sm={3} lg={2}>
                        <Form.Label className="mb-1">TC</Form.Label>
                    </Col>
                    <Col xs={6} sm={3} lg={2}>
                        <Form.Label className="mb-1">TTL</Form.Label>
                    </Col>
                </Row>
            </Col>
        </Form.Group>
    );

    const renderLseLabel = (row: MNAComputedRow) => (
        <Form.Label className="col-3 text-start">
            <div className="d-flex align-items-center gap-2">
                <span>LSE {row.index + 1}</span>
                {stream.mna_in_stack ? (
                    <span
                        className="badge rounded-pill"
                        style={{ ...roleBadgeStyle(row.role), fontWeight: 600 }}
                    >
                        {roleLabel(row)}
                    </span>
                ) : null}
            </div>
        </Form.Label>
    );

    return <>
        {stream.mna_in_stack ? (
            <Alert variant={mnaAlert ? "warning" : "info"} className="mb-3">
                {mnaAlert ?? (allowPostStack
                    ? "MNA editing is enabled. Mark any free non-final row as NASI for in-stack data or as a Post-Stack MNA Header to start post-stack data."
                    : "MNA editing is enabled. Mark any free non-final row as NASI to create an in-stack network action sub-stack.")}
            </Alert>
        ) : null}

        {!stream.mna_in_stack ? renderPlainStackHeader() : null}

        {groups.map((group, groupIndex) => {
            if (group.type === "plain") {
                const row = group.row;
                const key = `mpls-row-${row.index}`;
                return (
                    <Form.Group as={StyledRow} className="mb-3" controlId={key} key={key}>
                        {renderLseLabel(row)}
                        <Col className="col-9 text-start">
                            {renderEditor(row, stream.mna_in_stack)}
                        </Col>
                    </Form.Group>
                );
            }

            const showBosDivider = allowPostStack
                && group.type === "postStack"
                && group.rows[0].index === rowsToRender.find((row) => row.role === "psmht")?.index;

            const shownRoles = new Set<MNAComputedRow["role"]>();
            const labelFlags = group.rows.map((row) => {
                if (shownRoles.has(row.role)) return false;
                shownRoles.add(row.role);
                return true;
            });

            return (
                <React.Fragment key={`mna-group-${groupIndex}`}>
                    {showBosDivider ? (
                        <div className="mna-bos-divider">
                            <span className="mna-bos-divider-label">Bottom of Stack</span>
                        </div>
                    ) : null}
                    <div className={`mna-nas-container${group.type === "postStack" ? " mna-post-stack-container" : ""}`}>
                        <div className={`mna-nas-header${group.type === "postStack" ? " mna-post-stack-header" : ""}`}>
                            {group.type === "postStack" ? "Post-Stack MNA Header" : "Network Action Sub-Stack"}
                        </div>
                        {group.rows.map((row, rowIndex) => {
                            const key = `mpls-row-${row.index}`;
                            return (
                                <Form.Group
                                    as={StyledRow}
                                    className={rowIndex === group.rows.length - 1 ? "mb-2" : "mb-3"}
                                    controlId={key}
                                    key={key}
                                >
                                    {renderLseLabel(row)}
                                    <Col className="col-9 text-start">
                                        {renderEditor(row, labelFlags[rowIndex])}
                                    </Col>
                                </Form.Group>
                            );
                        })}
                    </div>
                </React.Fragment>
            );
        })}
    </>;
}

export default MPLS
