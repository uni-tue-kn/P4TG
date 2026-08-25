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

import { HistogramConfig, HistogramStreamGroups, Stream, unitOptions } from "../../common/Interfaces";
import React, { useEffect, useState } from "react";
import { Alert, Button, Col, Form, Modal, Row } from "react-bootstrap";

type HistogramType = "rtt" | "iat";
type EditableHistogramConfig = Omit<HistogramConfig, "min" | "max" | "num_bins"> & {
    min: number | "";
    max: number | "";
    num_bins: number | "";
};

const MAX_HISTOGRAM_VALUE = 2 ** 32 - 1;

const isPowerOfTwo = (value: number) =>
    Number.isSafeInteger(value) && value > 0 && Number.isInteger(Math.log2(value));

const nextPowerOfTwo = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return null;

    const optimizedValue = 2 ** Math.ceil(Math.log2(Math.ceil(value)));
    return optimizedValue <= MAX_HISTOGRAM_VALUE ? optimizedValue : null;
};

const conciseNumber = (value: number) => Number(value.toPrecision(12));


const HistogramModal = ({
    show,
    hide,
    rtt_data,
    iat_data,
    disabled,
    pid,
    channel,
    set_rtt_data,
    set_iat_data,
    streams,
}: {
    show: boolean,
    hide: () => void,
    rtt_data: HistogramConfig,
    iat_data: HistogramConfig,
    disabled: boolean,
    pid: number,
    channel: number
    set_rtt_data: (pid: number, channel: number, updated: HistogramConfig) => void,
    set_iat_data: (pid: number, channel: number, updated: HistogramConfig) => void,
    streams: Stream[],
}) => {

    const defaultPercentiles = [0.25, 0.5, 0.75, 0.9];
    const buildConfig = (type: HistogramType, cfg?: HistogramConfig): EditableHistogramConfig => ({
        min: cfg?.min ?? (type === "iat" ? 0 : 1024),
        max: cfg?.max ?? (type === "iat" ? 1024 : 2048),
        num_bins: cfg?.num_bins ?? 16,
        percentiles: cfg?.percentiles ?? defaultPercentiles,
        stream_groups: cfg?.stream_groups ? {
            aggregate: [...cfg.stream_groups.aggregate],
            separate: [...cfg.stream_groups.separate],
        } : undefined,
    });

    const [tmpConfigs, setTmpConfigs] = useState<{ rtt: EditableHistogramConfig; iat: EditableHistogramConfig }>(() => ({
        rtt: buildConfig("rtt", rtt_data),
        iat: buildConfig("iat", iat_data),
    }));
    const [alertMessage, setAlertMessage] = useState<string | null>(null);

    const [unitSelection, setUnitSelection] = useState<Record<HistogramType, string>>({ rtt: "ns", iat: "ns" });
    const getMultiplier = (unit: string) => unitOptions.find(u => u.label === unit)?.multiplier || 1;

    const [percentileInput, setPercentileInput] = useState<{ rtt: string; iat: string }>({
        rtt: (rtt_data?.percentiles ?? defaultPercentiles).join(", "),
        iat: (iat_data?.percentiles ?? defaultPercentiles).join(", "),
    });

    // useEffect to reset tmp_data when data changes
    useEffect(() => {
        if (show) {
            const rttConfig = buildConfig("rtt", rtt_data);
            const iatConfig = buildConfig("iat", iat_data);
            setTmpConfigs({
                rtt: rttConfig,
                iat: iatConfig,
            });
            setPercentileInput({
                rtt: (rttConfig.percentiles ?? defaultPercentiles).join(", "),
                iat: (iatConfig.percentiles ?? defaultPercentiles).join(", "),
            });
            setUnitSelection({ rtt: "ns", iat: "ns" });
            setAlertMessage(null);
        }
    }, [show, rtt_data, iat_data]);

    const hideRestore = () => {
        const rttConfig = buildConfig("rtt", rtt_data);
        const iatConfig = buildConfig("iat", iat_data);
        setTmpConfigs({
            rtt: rttConfig,
            iat: iatConfig,
        });
        setPercentileInput({
            rtt: (rttConfig.percentiles ?? defaultPercentiles).join(", "),
            iat: (iatConfig.percentiles ?? defaultPercentiles).join(", "),
        });
        setUnitSelection({ rtt: "ns", iat: "ns" });
        setAlertMessage(null);
        hide();
    };

    const handleUnit = (type: HistogramType, newUnit: string) => {
        // Changes the displayed value for min and max if the unit is changed in the dropdown, e.g., 2500 ns -> 2.5 us
        const unitMap = Object.fromEntries(unitOptions.map(u => [u.label, u.multiplier]));

        const currentFactor = unitMap[unitSelection[type]];
        const newFactor = unitMap[newUnit];
        const factor = currentFactor / newFactor;

        setTmpConfigs(prev => ({
            ...prev,
            [type]: {
                ...prev[type],
                min: prev[type].min === "" ? "" : prev[type].min * factor,
                max: prev[type].max === "" ? "" : prev[type].max * factor,
            },
        }));

        setUnitSelection(prev => ({ ...prev, [type]: newUnit }));
    };

    const validateConfig = (config: EditableHistogramConfig, unit: string, label: string): HistogramConfig | null => {
        const min = config.min === "" ? NaN : config.min * getMultiplier(unit);
        const max = config.max === "" ? NaN : config.max * getMultiplier(unit);
        const numBins = config.num_bins === "" ? NaN : config.num_bins;
        const percentiles = (config.percentiles && config.percentiles.length > 0 ? config.percentiles : defaultPercentiles);

        if (!Number.isFinite(min) || !Number.isFinite(max) || !Number.isFinite(numBins)) {
            setAlertMessage(`${label}: All fields must be valid numbers.`);
            return null;
        }

        if (min >= max) {
            setAlertMessage(`${label}: Minimum value must be less than maximum value of range.`);
            return null;
        }
        if (!Number.isInteger(numBins) || numBins <= 0) {
            setAlertMessage(`${label}: Number of bins must be a positive integer.`);
            return null;
        }
        if (numBins > (max - min)) {
            setAlertMessage(`${label}: Too many bins for too less of range. Increase range, or decrease number of bins.`);
            return null;
        }
        if (min > 2 ** 32 - 1) {
            setAlertMessage(`${label}: Minimum range exceeds range of 32-bit.`);
            return null;
        }
        if (max > 2 ** 32 - 1) {
            setAlertMessage(`${label}: Maximum range exceeds range of 32-bit.`);
            return null;
        }
        const invalid = percentiles.some(
            (p: number) => typeof p !== "number" || p <= 0.0 || p >= 1.0
        );
        if (invalid) {
            setAlertMessage(`${label}: All percentiles must be numbers between 0.0 and 1.0.`);
            return null;
        }
        if (percentiles.length > 10) {
            setAlertMessage(`${label}: Too many percentiles. At most 10 percentiles are supported.`);
            return null;
        }
        return {
            num_bins: numBins,
            min,
            max,
            percentiles: percentiles,
            stream_groups: config.stream_groups &&
                (config.stream_groups.aggregate.length > 0 || config.stream_groups.separate.length > 0)
                ? {
                    aggregate: [...config.stream_groups.aggregate],
                    separate: [...config.stream_groups.separate],
                }
                : undefined,
        };
    };

    const submit = () => {
        const validatedRTT = validateConfig(tmpConfigs.rtt, unitSelection.rtt, "RTT histogram");
        if (!validatedRTT) return;

        const validatedIAT = validateConfig(tmpConfigs.iat, unitSelection.iat, "IAT histogram");
        if (!validatedIAT) return;

        setAlertMessage(null);

        set_rtt_data(pid, channel, validatedRTT);
        set_iat_data(pid, channel, validatedIAT);

        hide();

        //updateConfig(pid, min, max, tmp_data.num_bins)
    }

    const handleChange = (type: HistogramType, field: "min" | "max" | "num_bins", value: string) => {
        setTmpConfigs(prev => ({
            ...prev,
            [type]: { ...prev[type], [field]: value === "" ? "" : Number(value) },
        }));
    };

    const useOptimizedRange = (type: HistogramType, optimizedMaxNanoseconds: number) => {
        const multiplier = getMultiplier(unitSelection[type]);

        setTmpConfigs(prev => ({
            ...prev,
            [type]: {
                ...prev[type],
                min: 0,
                max: conciseNumber(optimizedMaxNanoseconds / multiplier),
            },
        }));
    };

    const configuredAppIds = Array.from(new Set(streams.map(stream => stream.app_id))).sort((a, b) => a - b);

    const minimumMaskCount = (groups?: HistogramStreamGroups) => {
        if (!groups || groups.aggregate.length === 0) return 0;
        const aggregate = Array.from(new Set(groups.aggregate));
        const separate = new Set(groups.separate);
        const excluded = configuredAppIds.filter(id => !aggregate.includes(id) && !separate.has(id));
        const seen = new Set<string>();
        const byCoverage = new Map<bigint, { value: number, mask: number, coverage: bigint }>();
        const bitCount = (value: bigint) => {
            let count = 0;
            while (value !== 0n) {
                value &= value - 1n;
                count++;
            }
            return count;
        };

        for (const appId of aggregate) {
            for (let mask = 0; mask <= 0xff; mask++) {
                const value = appId & mask;
                const key = `${value}/${mask}`;
                if (seen.has(key) || excluded.some(id => (id & mask) === value)) continue;
                seen.add(key);
                let coverage = 0n;
                aggregate.forEach((id, index) => {
                    if ((id & mask) === value) coverage |= 1n << BigInt(index);
                });
                const current = byCoverage.get(coverage);
                if (!current || bitCount(BigInt(mask)) < bitCount(BigInt(current.mask))) {
                    byCoverage.set(coverage, { value, mask, coverage });
                }
            }
        }

        const candidates = Array.from(byCoverage.values()).sort((left, right) =>
            bitCount(right.coverage) - bitCount(left.coverage)
            || bitCount(BigInt(left.mask)) - bitCount(BigInt(right.mask))
            || left.mask - right.mask
            || left.value - right.value
        );
        const primeCandidates: typeof candidates = [];
        for (const candidate of candidates) {
            if (!primeCandidates.some(prime =>
                (prime.coverage & candidate.coverage) === candidate.coverage)) {
                primeCandidates.push(candidate);
            }
        }

        const full = (1n << BigInt(aggregate.length)) - 1n;
        let best = aggregate.length;
        const visited = new Map<bigint, number>();
        const search = (covered: bigint, depth: number) => {
            if (covered === full) {
                best = Math.min(best, depth);
                return;
            }
            if (depth >= best || (visited.get(covered) ?? Number.POSITIVE_INFINITY) <= depth) return;
            visited.set(covered, depth);

            const uncovered = full & ~covered;
            const maxNew = Math.max(...primeCandidates.map(candidate =>
                bitCount(candidate.coverage & uncovered)));
            if (maxNew === 0 || depth + Math.ceil(bitCount(uncovered) / maxNew) >= best) return;

            let branches: typeof primeCandidates = [];
            for (let index = 0; index < aggregate.length; index++) {
                const bit = 1n << BigInt(index);
                if ((uncovered & bit) === 0n) continue;
                const matching = primeCandidates.filter(candidate => (candidate.coverage & bit) !== 0n);
                if (branches.length === 0 || matching.length < branches.length) branches = matching;
            }
            branches.sort((left, right) =>
                bitCount(right.coverage & uncovered) - bitCount(left.coverage & uncovered));
            branches.forEach(candidate => search(covered | candidate.coverage, depth + 1));
        };
        search(0n, 0);
        return best;
    };

    const setCustomGrouping = (type: HistogramType, custom: boolean) => {
        setTmpConfigs(prev => ({
            ...prev,
            [type]: {
                ...prev[type],
                stream_groups: custom
                    ? {
                        aggregate: configuredAppIds,
                        separate: [],
                    }
                    : undefined,
            },
        }));
    };

    const setStreamClassification = (
        type: HistogramType,
        appId: number,
        classification: "aggregate" | "separate" | "exclude",
    ) => {
        setTmpConfigs(prev => {
            const current = prev[type].stream_groups ?? { aggregate: [], separate: [] };
            const next: HistogramStreamGroups = {
                aggregate: current.aggregate.filter(id => id !== appId),
                separate: current.separate.filter(id => id !== appId),
            };
            if (classification !== "exclude") next[classification].push(appId);
            next.aggregate.sort((a, b) => a - b);
            next.separate.sort((a, b) => a - b);
            return {
                ...prev,
                [type]: { ...prev[type], stream_groups: next },
            };
        });
    };

    const renderHistogramControls = (type: HistogramType, label: string, description: string) => {
        const config = tmpConfigs[type];
        const multiplier = getMultiplier(unitSelection[type]);
        const minNanoseconds = config.min === "" ? NaN : config.min * multiplier;
        const maxNanoseconds = config.max === "" ? NaN : config.max * multiplier;
        const numBins = config.num_bins === "" ? NaN : config.num_bins;
        const binWidthNanoseconds = (maxNanoseconds - minNanoseconds) / numBins;
        const binCountIsPowerOfTwo = config.num_bins !== "" && isPowerOfTwo(config.num_bins);
        const rangeIsOptimized = Number.isSafeInteger(minNanoseconds)
            && isPowerOfTwo(binWidthNanoseconds)
            && minNanoseconds % binWidthNanoseconds === 0;
        const binWidthInSelectedUnit = rangeIsOptimized
            ? conciseNumber(binWidthNanoseconds / multiplier)
            : null;
        const binWidthExponent = rangeIsOptimized ? Math.log2(binWidthNanoseconds) : null;
        const optimizedMaxNanoseconds = nextPowerOfTwo(maxNanoseconds);
        const optimizedMaxInSelectedUnit = optimizedMaxNanoseconds === null
            ? null
            : conciseNumber(optimizedMaxNanoseconds / multiplier);
        const optimizedExponent = optimizedMaxNanoseconds === null
            ? null
            : Math.log2(optimizedMaxNanoseconds);
        const customGrouping = config.stream_groups !== undefined;
        const aggregateMaskCount = minimumMaskCount(config.stream_groups);
        const separateCount = config.stream_groups?.separate.length ?? 0;
        const usesLegacyFallback = customGrouping && aggregateMaskCount + separateCount === 0;

        return <>
            <h5 className="mb-2">{label}</h5>
            <p className="mb-3">{description}</p>

            <Form.Group as={Row} className=" mb-3 align-items-center">
                <Form.Label className={"col-3 text-start"} column sm={2}>Range</Form.Label>

                <Col sm={3}>
                    <Form.Control
                        type="number"
                        value={config.min}
                        onChange={(e) => handleChange(type, "min", e.target.value)}
                        required
                        disabled={disabled}
                    />
                </Col>
                <Col sm={1} className="text-center">
                    —
                </Col>
                <Col sm={3}>
                    <Form.Control
                        type="number"
                        value={config.max}
                        onChange={(e) => handleChange(type, "max", e.target.value)}
                        required
                        disabled={disabled}
                    />
                </Col>
                <Col sm={3}>
                    <Form.Select value={unitSelection[type]} disabled={disabled}
                        onChange={(e) => handleUnit(type, e.target.value)}>
                        {unitOptions.map(u => (
                            <option key={u.label} value={u.label}>{u.label}</option>
                        ))}
                    </Form.Select>
                </Col>
            </Form.Group>

            {(rangeIsOptimized || (optimizedMaxNanoseconds !== null && optimizedMaxInSelectedUnit !== null)) && (
                <div className="histogram-optimization-hint mb-3">
                    <span className="histogram-optimization-copy">
                        {rangeIsOptimized ? (
                            <>
                                <i
                                    className="bi bi-check-circle-fill histogram-optimization-icon histogram-optimization-icon-aligned"
                                    aria-hidden="true"
                                />
                                Binary-aligned bins: <strong>{binWidthInSelectedUnit} {unitSelection[type]}</strong>
                                {" "}each (2<sup>{binWidthExponent}</sup> ns). The minimum is aligned to the bin width, so each bin uses one ternary entry.
                            </>
                        ) : (
                            <>
                                <i
                                    className="bi bi-exclamation-circle-fill histogram-optimization-icon histogram-optimization-icon-suggestion"
                                    aria-hidden="true"
                                />
                                Suggested range: <strong>0 – {optimizedMaxInSelectedUnit} {unitSelection[type]}</strong>
                                {" "}(2<sup>{optimizedExponent}</sup> ns). {binCountIsPowerOfTwo
                                    ? "This makes the bin width a power of two, so each bin uses one ternary entry."
                                    : "Use this range with a power-of-two bin count so each bin can use one ternary entry."}
                            </>
                        )}
                    </span>
                    {!rangeIsOptimized && optimizedMaxNanoseconds !== null && (
                        <button
                            type="button"
                            className="histogram-optimization-action"
                            disabled={disabled}
                            onClick={() => useOptimizedRange(type, optimizedMaxNanoseconds)}
                        >
                            Use suggestion
                        </button>
                    )}
                </div>
            )}

            <Form.Group as={Row} className="mb-3">
                <Form.Label column sm={2}>Number of bins</Form.Label>
                <Col sm={8}>
                    <Form.Control
                        type="number"
                        value={config.num_bins}
                        onChange={(e) => handleChange(type, "num_bins", e.target.value)}
                        min={1}
                        required
                        disabled={disabled}
                    />
                    {config.num_bins !== "" && (
                        <Form.Text className="histogram-bin-hint">
                            {binCountIsPowerOfTwo
                                ? "Power-of-two bin count."
                                : "Tip: use a power-of-two bin count (1, 2, 4, 8, …) for efficient ternary matching."}
                        </Form.Text>
                    )}
                </Col>
            </Form.Group>

            <Form.Group as={Row} className="mb-4">
                <Form.Label column sm={2}>Percentiles</Form.Label>
                <Col sm={8}>
                    <Form.Control
                        type="text"
                        value={percentileInput[type]}
                        onChange={e => {
                            const input = e.target.value;
                            setPercentileInput(prev => ({ ...prev, [type]: input }));

                            const values = input
                                .split(",")
                                .map(v => v.trim())
                                .filter(v => v.length > 0)
                                .map(Number)
                                .filter(v => !isNaN(v));

                            setTmpConfigs(prev => ({
                                ...prev,
                                [type]: {
                                    ...prev[type],
                                    percentiles: values
                                }
                            }));
                        }}
                        placeholder="e.g. 0.25, 0.5, 0.9"
                        disabled={disabled}
                    />
                    <Form.Text className="text-muted">
                        Enter percentiles as comma-separated values between 0.0 and 1.0.
                    </Form.Text>
                </Col>
            </Form.Group>

            <Form.Group className="mb-4 histogram-stream-collection">
                <Form.Label className="d-block">Stream collection</Form.Label>
                <Form.Check
                    type="radio"
                    name={`${type}-stream-collection`}
                    id={`${type}-stream-legacy`}
                    label="All streams aggregated (legacy wildcard)"
                    checked={!customGrouping}
                    disabled={disabled}
                    onChange={() => setCustomGrouping(type, false)}
                />
                <Form.Check
                    type="radio"
                    name={`${type}-stream-collection`}
                    id={`${type}-stream-custom`}
                    label="Custom stream grouping"
                    checked={customGrouping}
                    disabled={disabled || configuredAppIds.length === 0}
                    onChange={() => setCustomGrouping(type, true)}
                />

                {customGrouping && (
                    <div className="mt-2 border rounded p-2">
                        <Row className="fw-semibold mb-1">
                            <Col>Stream</Col>
                            <Col>Aggregate</Col>
                            <Col>Separate</Col>
                            <Col>Exclude</Col>
                        </Row>
                        {configuredAppIds.map(appId => {
                            const classification = config.stream_groups?.separate.includes(appId)
                                ? "separate"
                                : config.stream_groups?.aggregate.includes(appId)
                                    ? "aggregate"
                                    : "exclude";
                            return <Row key={`${type}-stream-${appId}`} className="align-items-center py-1">
                                <Col>Stream {appId}</Col>
                                {(["aggregate", "separate", "exclude"] as const).map(value =>
                                    <Col key={value}>
                                        <Form.Check
                                            type="radio"
                                            name={`${type}-stream-${appId}`}
                                            aria-label={`${label} stream ${appId} ${value}`}
                                            checked={classification === value}
                                            disabled={disabled}
                                            onChange={() => setStreamClassification(type, appId, value)}
                                        />
                                    </Col>
                                )}
                            </Row>
                        })}
                        <Form.Text className="d-block mt-2 histogram-stream-summary">
                            {usesLegacyFallback
                                ? "No selected streams uses the legacy wildcard (app-filter multiplier: 1)."
                                : <>Aggregate uses {aggregateMaskCount} app mask{aggregateMaskCount === 1 ? "" : "s"}; Separate uses {separateCount} exact app filter{separateCount === 1 ? "" : "s"}. App-filter multiplier: {aggregateMaskCount + separateCount}.</>}
                        </Form.Text>
                    </div>
                )}
            </Form.Group>
        </>
    }

    return <Modal show={show} size="lg" onHide={hideRestore}>
        <Modal.Header closeButton>
            <Modal.Title>Configure histogram options on RX port {pid}/{channel}</Modal.Title>
        </Modal.Header>
        <form onSubmit={submit}>
            <Modal.Body>
                {alertMessage && (
                    <Alert variant="danger" onClose={() => setAlertMessage(null)} dismissible>
                        {alertMessage}
                    </Alert>
                )}

                {renderHistogramControls(
                    "rtt",
                    "RTT Histogram",
                    "Configure how the incoming data on this RX port will be processed in the RTT histogram. Adjust the range, unit, and bin count to tailor the output."
                )}

                <hr />

                {renderHistogramControls(
                    "iat",
                    "IAT Histogram",
                    "Configure the inter-arrival time histogram for this RX port. Use the same controls to tailor the range and resolution. The IAT histogram will be measured for TX/RX ports."
                )}
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
}

export default HistogramModal
