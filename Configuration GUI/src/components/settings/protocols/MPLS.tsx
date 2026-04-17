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
import { Alert, Button, Col, Form, OverlayTrigger, Row, Tooltip } from "react-bootstrap";
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
} from "../../../common/MPLSMNA";

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
        return !!other && header.label === other.label && header.tc === other.tc && header.ttl === other.ttl;
    });
};

const cloneEntries = (entries: MNAEditorEntry[]) =>
    entries.map((entry) => ({
        plain: { ...entry.plain },
        isNasi: entry.isNasi,
        formatB: { ...entry.formatB },
        formatC: { ...entry.formatC },
        formatD: { ...entry.formatD },
    }));

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

const MPLS = ({ stream, data, set_data, running }: Props) => {
    const stackLength = stream.number_of_lse;
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

        const decoded = decodeMNAEditorEntries(nextNormalizedStack, stackLength);
        const computed = computeMNAState(decoded.entries);

        setMnaEntries(decoded.entries);
        setMnaAlert(decoded.error ?? computed.error);
        syncEffectStack(computed.encodedStack);
    }, [data.mpls_stack, set_data, stackLength, stream.mna_in_stack]);

    const updatePlainHeader = (index: number, field: "label" | "tc" | "ttl", value: number) => {
        if (stream.mna_in_stack) {
            const nextEntries = cloneEntries(mnaEntries);
            nextEntries[index].plain[field] = value;
            const computed = computeMNAState(nextEntries);
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
        const current = computeMNAState(nextEntries);
        mutate(nextEntries, current.rows);
        const computed = computeMNAState(nextEntries);
        setMnaEntries(nextEntries);
        setMnaAlert(computed.error);
        syncStack(computed.encodedStack);
    };

    const computedMna = computeMNAState(mnaEntries);

    const renderPlainEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col md={3}>
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
            <Col md={2}>
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
            <Col md={2}>
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
                <Col md={5} className="d-flex align-items-end">
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
                                disabled={running || !row.canBeNasi}
                                onClick={() =>
                                    applyMnaUpdate((entries) => {
                                        entries[index].isNasi = true;
                                    })
                                }
                            >
                                Mark as NASI
                            </Button>
                        </span>
                    </OverlayTrigger>
                </Col>
            ) : null}
        </Row>
    );

    const renderFormatAEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col md={3}>
                {showLabels && <Form.Label className="mb-1">Label</Form.Label>}
                <Form.Control value={MNA_BSPL_LABEL} disabled type="number" />
            </Col>
            <Col md={2}>
                {showLabels && <Form.Label className="mb-1">TC</Form.Label>}
                <Form.Control value={row.plain.tc} disabled type="number" />
            </Col>
            <Col md={2}>
                {showLabels && <Form.Label className="mb-1">TTL</Form.Label>}
                <Form.Control value={row.plain.ttl} disabled type="number" />
            </Col>
            <Col md={5} className="d-flex align-items-end">
                <Button
                    variant="outline-secondary"
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
            <Col md={2}>
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
            <Col md={2}>
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
            <Col md={2}>
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
            <Col md={2}>
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
                >
                    {Array.from({ length: row.maxNasl + 1 }, (_, option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </Form.Select>
            </Col>
            <Col md={2}>
                {showLabels && <Form.Label className="mb-1">NAL</Form.Label>}
                <Form.Select
                    value={row.formatB.nal}
                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.nal = parseInt(event.target.value, 10);
                        })
                    }
                    disabled={running || row.formatB.nasl === 0}
                >
                    {Array.from({ length: row.formatB.nasl + 1 }, (_, option) => (
                        <option key={option} value={option}>{option}</option>
                    ))}
                </Form.Select>
            </Col>
            <Col md={2}>
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
                <Form.Check
                    type="switch"
                    checked={row.formatB.u}
                    onChange={() =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatB.u = !entries[index].formatB.u;
                        })
                    }
                    disabled={running}
                />
            </Col>
        </Row>
    );

    const renderFormatCEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col md={3}>
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
            <Col md={3}>
                {showLabels && <Form.Label className="mb-1">Data</Form.Label>}
                <Form.Control
                    value={row.formatC.data}
                    onChange={(event: React.ChangeEvent<HTMLInputElement>) =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatC.data = Math.min(Math.max(parseInt(event.target.value, 10) || 0, 0), 0xfffff);
                        })
                    }
                    min={0}
                    max={0xfffff}
                    step={1}
                    disabled={running}
                    type="number"
                />
            </Col>
            <Col md={2}>
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
            <Col md={2}>
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
                <Form.Check
                    type="switch"
                    checked={row.formatC.u}
                    onChange={() =>
                        applyMnaUpdate((entries) => {
                            entries[index].formatC.u = !entries[index].formatC.u;
                        })
                    }
                    disabled={running}
                />
            </Col>
        </Row>
    );

    const renderFormatDEditor = (index: number, row: MNAComputedRow, showLabels: boolean = true) => (
        <Row className="g-2 align-items-center">
            <Col md={4}>
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

    if (stackLength === 0) {
        return <Form.Text className="text-muted">Configure at least one MPLS LSE to edit the stack.</Form.Text>;
    }

    const asPlainComputedRow = (index: number, header: typeof normalizedStack[number]): MNAComputedRow => ({
        index,
        role: "plain",
        plain: header,
        isNasi: false,
        formatB: { opcode: 0, data: 0, ihs: MNAIhsScope.I2E, u: false, nasl: 0, nal: 0 },
        formatC: { opcode: 0, data: 0, u: false, nal: 0 },
        formatD: { data: 0 },
        ownerIndex: null,
        canBeNasi: false,
        nasiDisabledReason: null,
        maxNasl: 0,
        maxNal: 0,
    });

    const rowsToRender: MNAComputedRow[] = stream.mna_in_stack
        ? computedMna.rows
        : normalizedStack.map((header, index) => asPlainComputedRow(index, header));

    type RenderGroup =
        | { type: "plain"; row: MNAComputedRow }
        | { type: "nas"; rows: MNAComputedRow[] };

    const groups: RenderGroup[] = [];
    let cursor = 0;
    while (cursor < rowsToRender.length) {
        const current = rowsToRender[cursor];
        if (!stream.mna_in_stack || current.role === "plain") {
            groups.push({ type: "plain", row: current });
            cursor += 1;
            continue;
        }
        const nasRows: MNAComputedRow[] = [rowsToRender[cursor]];
        cursor += 1;
        while (
            cursor < rowsToRender.length
            && rowsToRender[cursor].role !== "plain"
            && rowsToRender[cursor].role !== "formatA"
        ) {
            nasRows.push(rowsToRender[cursor]);
            cursor += 1;
        }
        groups.push({ type: "nas", rows: nasRows });
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
            case "plain":
            default:
                return renderPlainEditor(row.index, row, showLabels);
        }
    };

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
                {mnaAlert ?? "MNA editing is enabled. Mark any non-final free LSE as NASI to create an in-stack sub-stack."}
            </Alert>
        ) : null}

        {groups.map((group, groupIndex) => {
            if (group.type === "plain") {
                const row = group.row;
                const key = `mpls-row-${row.index}`;
                return (
                    <Form.Group as={StyledRow} className="mb-3" controlId={key} key={key}>
                        {renderLseLabel(row)}
                        <Col className="col-9 text-start">
                            {renderEditor(row, true)}
                        </Col>
                    </Form.Group>
                );
            }

            const shownRoles = new Set<MNAComputedRow["role"]>();
            const labelFlags = group.rows.map((row) => {
                if (shownRoles.has(row.role)) return false;
                shownRoles.add(row.role);
                return true;
            });

            return (
                <div className="mna-nas-container" key={`mna-group-${groupIndex}`}>
                    <div className="mna-nas-header">Network Action Sub-Stack</div>
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
            );
        })}
    </>;
}

export default MPLS
