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

import { GenerationPattern, GenerationPatternConfig, unitOptions } from "../../common/Interfaces";
import React, { useEffect, useState } from "react";
import { Alert, Button, Col, Form, Modal, Row } from "react-bootstrap";
import { formatNanoSeconds } from "../../common/Helper";
import InfoBox from "../InfoBox";

const getDefaultFlashcrowdQuietUntil = (period: number) => period * 0.2;
const getDefaultFlashcrowdRampUntil = (period: number) => period * 0.25;

const defaultPatternConfig = (config?: GenerationPatternConfig): GenerationPatternConfig => ({
    pattern_type: config?.pattern_type ?? GenerationPattern.Sine,
    period: config?.period ?? 20_000_000_000,
    sample_rate: config?.sample_rate ?? 128,
    inverted: config?.inverted ?? false,
    fc_quiet_until: config?.fc_quiet_until ?? getDefaultFlashcrowdQuietUntil(config?.period ?? 20_000_000_000),
    fc_ramp_until: config?.fc_ramp_until ?? getDefaultFlashcrowdRampUntil(config?.period ?? 20_000_000_000),
    fc_decay_rate: config?.fc_decay_rate ?? 4.0,
    square_low: config?.square_low ?? 0,
    square_high_until: config?.square_high_until ?? ((config?.period ?? 20_000_000_000) / 2),
});

const PatternModal = ({
    show,
    hide,
    data,
    disabled,
    set_data
}: {
    show: boolean,
    hide: () => void,
    data: GenerationPatternConfig,
    disabled: boolean,
    set_data: (updated: GenerationPatternConfig) => void,
}) => {

    const [tmp_data, set_tmp_data] = useState<GenerationPatternConfig>(defaultPatternConfig(data));
    const [alertMessage, setAlertMessage] = useState<string | null>(null);
    const [periodUnit, setPeriodUnit] = useState<string>("s");
    const [squareHighUntilUnit, setSquareHighUntilUnit] = useState<string>("s");
    const [flashcrowdQuietUntilUnit, setFlashcrowdQuietUntilUnit] = useState<string>("s");
    const [flashcrowdRampUntilUnit, setFlashcrowdRampUntilUnit] = useState<string>("s");
    const [unitsReady, setUnitsReady] = useState<boolean>(false);
    const getPeriodMultiplier = (unit: string) => unitOptions.find(u => u.label === unit)?.multiplier || 1;

    useEffect(() => {
        if (typeof window === "undefined") {
            setUnitsReady(true);
            return;
        }

        const storedPeriodUnit = window.localStorage.getItem("p4tg.pattern.period.unit");
        const storedSquareHighUntilUnit = window.localStorage.getItem("p4tg.pattern.square_high_until.unit");
        const storedFlashcrowdQuietUntilUnit = window.localStorage.getItem("p4tg.pattern.fc_quiet_until.unit");
        const storedFlashcrowdRampUntilUnit = window.localStorage.getItem("p4tg.pattern.fc_ramp_until.unit");

        if (storedPeriodUnit && unitOptions.some(u => u.label === storedPeriodUnit)) {
            setPeriodUnit(storedPeriodUnit);
        }
        if (storedSquareHighUntilUnit && unitOptions.some(u => u.label === storedSquareHighUntilUnit)) {
            setSquareHighUntilUnit(storedSquareHighUntilUnit);
        }
        if (storedFlashcrowdQuietUntilUnit && unitOptions.some(u => u.label === storedFlashcrowdQuietUntilUnit)) {
            setFlashcrowdQuietUntilUnit(storedFlashcrowdQuietUntilUnit);
        }
        if (storedFlashcrowdRampUntilUnit && unitOptions.some(u => u.label === storedFlashcrowdRampUntilUnit)) {
            setFlashcrowdRampUntilUnit(storedFlashcrowdRampUntilUnit);
        }

        setUnitsReady(true);
    }, []);

    useEffect(() => {
        if (!unitsReady) {
            return;
        }
        if (show) {
            const baseConfig = defaultPatternConfig(data);
            set_tmp_data({
                ...baseConfig,
                period: baseConfig.period / getPeriodMultiplier(periodUnit),
                fc_quiet_until: (baseConfig.fc_quiet_until ?? 0) / getPeriodMultiplier(flashcrowdQuietUntilUnit),
                fc_ramp_until: (baseConfig.fc_ramp_until ?? 0) / getPeriodMultiplier(flashcrowdRampUntilUnit),
                square_high_until: (baseConfig.square_high_until ?? 0) / getPeriodMultiplier(squareHighUntilUnit),
            });
            setAlertMessage(null);
        }
    }, [show, data, unitsReady]);

    const hideRestore = () => {
        const baseConfig = defaultPatternConfig(data);
        set_tmp_data({
            ...baseConfig,
            period: baseConfig.period / getPeriodMultiplier(periodUnit),
            fc_quiet_until: (baseConfig.fc_quiet_until ?? 0) / getPeriodMultiplier(flashcrowdQuietUntilUnit),
            fc_ramp_until: (baseConfig.fc_ramp_until ?? 0) / getPeriodMultiplier(flashcrowdRampUntilUnit),
            square_high_until: (baseConfig.square_high_until ?? 0) / getPeriodMultiplier(squareHighUntilUnit),
        });
        setAlertMessage(null);
        hide();
    };

    const handleNumberChange = (field: keyof GenerationPatternConfig, value: string) => {
        set_tmp_data(prev => ({ ...prev, [field]: Number(value) }));
    };

    const handlePatternTypeChange = (value: string) => {
        set_tmp_data(prev => ({
            ...prev,
            pattern_type: value as GenerationPattern,
            inverted: value === GenerationPattern.Square || value === GenerationPattern.Sawtooth
                ? (prev.inverted ?? false)
                : null,
            fc_quiet_until: value === GenerationPattern.Flashcrowd && prev.pattern_type !== GenerationPattern.Flashcrowd
                ? getDefaultFlashcrowdQuietUntil(Number(prev.period) * getPeriodMultiplier(periodUnit)) / getPeriodMultiplier(flashcrowdQuietUntilUnit)
                : prev.fc_quiet_until,
            fc_ramp_until: value === GenerationPattern.Flashcrowd && prev.pattern_type !== GenerationPattern.Flashcrowd
                ? getDefaultFlashcrowdRampUntil(Number(prev.period) * getPeriodMultiplier(periodUnit)) / getPeriodMultiplier(flashcrowdRampUntilUnit)
                : prev.fc_ramp_until,
            fc_decay_rate: value === GenerationPattern.Flashcrowd && prev.pattern_type !== GenerationPattern.Flashcrowd
                ? (prev.fc_decay_rate ?? 4.0)
                : prev.fc_decay_rate,
        }));
    };

    const handlePeriodUnitChange = (newUnit: string) => {
        const currentFactor = getPeriodMultiplier(periodUnit);
        const newFactor = getPeriodMultiplier(newUnit);
        const factor = currentFactor / newFactor;

        set_tmp_data(prev => ({
            ...prev,
            period: prev.period * factor,
        }));
        setPeriodUnit(newUnit);
        if (typeof window !== "undefined") {
            window.localStorage.setItem("p4tg.pattern.period.unit", newUnit);
        }
    };

    const handleInvertedChange = (checked: boolean) => {
        set_tmp_data(prev => ({
            ...prev,
            inverted: checked,
        }));
    };

    const handleSquareHighUntilUnitChange = (newUnit: string) => {
        const currentFactor = getPeriodMultiplier(squareHighUntilUnit);
        const newFactor = getPeriodMultiplier(newUnit);
        const factor = currentFactor / newFactor;

        set_tmp_data(prev => ({
            ...prev,
            square_high_until: (prev.square_high_until ?? 0) * factor,
        }));
        setSquareHighUntilUnit(newUnit);
        if (typeof window !== "undefined") {
            window.localStorage.setItem("p4tg.pattern.square_high_until.unit", newUnit);
        }
    };

    const handleFlashcrowdQuietUntilUnitChange = (newUnit: string) => {
        const currentFactor = getPeriodMultiplier(flashcrowdQuietUntilUnit);
        const newFactor = getPeriodMultiplier(newUnit);
        const factor = currentFactor / newFactor;

        set_tmp_data(prev => ({
            ...prev,
            fc_quiet_until: (prev.fc_quiet_until ?? 0) * factor,
        }));
        setFlashcrowdQuietUntilUnit(newUnit);
        if (typeof window !== "undefined") {
            window.localStorage.setItem("p4tg.pattern.fc_quiet_until.unit", newUnit);
        }
    };

    const handleFlashcrowdRampUntilUnitChange = (newUnit: string) => {
        const currentFactor = getPeriodMultiplier(flashcrowdRampUntilUnit);
        const newFactor = getPeriodMultiplier(newUnit);
        const factor = currentFactor / newFactor;

        set_tmp_data(prev => ({
            ...prev,
            fc_ramp_until: (prev.fc_ramp_until ?? 0) * factor,
        }));
        setFlashcrowdRampUntilUnit(newUnit);
        if (typeof window !== "undefined") {
            window.localStorage.setItem("p4tg.pattern.fc_ramp_until.unit", newUnit);
        }
    };

    const submit = () => {
        const period = Number(tmp_data.period) * getPeriodMultiplier(periodUnit);
        const sampleRate = Number(tmp_data.sample_rate);

        if (!Number.isFinite(period)) {
            setAlertMessage("Pattern period must be a valid number.");
            return;
        }

        if (tmp_data.pattern_type === GenerationPattern.Flashcrowd) {
            const quietUntil = Number(tmp_data.fc_quiet_until ?? 0) * getPeriodMultiplier(flashcrowdQuietUntilUnit);
            const rampUntil = Number(tmp_data.fc_ramp_until ?? 0) * getPeriodMultiplier(flashcrowdRampUntilUnit);
            const decayRate = tmp_data.fc_decay_rate ?? 4.0;

            if (!Number.isFinite(quietUntil)) {
                setAlertMessage("Quiet until must be a valid number.");
                return;
            }
            if (!Number.isFinite(rampUntil)) {
                setAlertMessage("Ramp until must be a valid number.");
                return;
            }
            if (quietUntil < 0) {
                setAlertMessage("Quiet until must be zero or greater.");
                return;
            }
            if (rampUntil < 0) {
                setAlertMessage("Ramp until must be zero or greater.");
                return;
            }
            if (quietUntil > rampUntil) {
                setAlertMessage("Ramp until must be larger than or equal to quiet until.");
                return;
            }
            if (rampUntil >= period) {
                setAlertMessage("Ramp until must be smaller than the period.");
                return;
            }
            if (decayRate < 0) {
                setAlertMessage("Decay rate must be zero or greater.");
                return;
            }

            set_data({
                ...tmp_data,
                period,
                sample_rate: sampleRate,
                inverted: null,
                fc_quiet_until: quietUntil,
                fc_ramp_until: rampUntil,
                fc_decay_rate: decayRate,
                square_low: null,
                square_high_until: null,
            });
        } else if (tmp_data.pattern_type === GenerationPattern.Square) {
            const squareLow = tmp_data.square_low ?? 0;
            const squareHighUntil = Number(tmp_data.square_high_until ?? 0) * getPeriodMultiplier(squareHighUntilUnit);
            const squarePhaseName = (tmp_data.inverted ?? false) ? "Square low-until" : "Square high-until";

            if (squareLow < 0 || squareLow > 1) {
                setAlertMessage("Square low must be within [0, 1].");
                return;
            }
            if (squareHighUntil < 0) {
                setAlertMessage(`${squarePhaseName} must be zero or greater.`);
                return;
            }
            if (squareHighUntil > period) {
                setAlertMessage(`${squarePhaseName} must be smaller than or equal to the period.`);
                return;
            }

            set_data({
                ...tmp_data,
                period,
                sample_rate: sampleRate,
                inverted: tmp_data.inverted ?? false,
                square_low: squareLow,
                square_high_until: squareHighUntil,
                fc_quiet_until: null,
                fc_ramp_until: null,
                fc_decay_rate: null,
            });
        } else if (tmp_data.pattern_type === GenerationPattern.Sawtooth) {
            set_data({
                ...tmp_data,
                period,
                sample_rate: sampleRate,
                inverted: tmp_data.inverted ?? false,
                fc_quiet_until: null,
                fc_ramp_until: null,
                fc_decay_rate: null,
                square_low: null,
                square_high_until: null,
            });
        } else {
            set_data({
                ...tmp_data,
                period,
                sample_rate: sampleRate,
                inverted: null,
                fc_quiet_until: null,
                fc_ramp_until: null,
                fc_decay_rate: null,
                square_low: null,
                square_high_until: null,
            });
        }

        setAlertMessage(null);
        hide();
    };

    const isFlashcrowd = tmp_data.pattern_type === GenerationPattern.Flashcrowd;
    const isSquare = tmp_data.pattern_type === GenerationPattern.Square;
    const isSawtooth = tmp_data.pattern_type === GenerationPattern.Sawtooth;
    const supportsInverted = isSquare || isSawtooth;
    const squarePhaseLabel = (tmp_data.inverted ?? false) ? "Low until" : "High until";
    const squarePhaseDescription = (tmp_data.inverted ?? false)
        ? "Time within the period where the low phase ends."
        : "Time within the period where the high phase ends.";
    const periodInBaseUnit = Number(tmp_data.period) * getPeriodMultiplier(periodUnit);
    const flashcrowdQuietUntilMax = periodInBaseUnit / getPeriodMultiplier(flashcrowdQuietUntilUnit);
    const flashcrowdRampUntilMax = periodInBaseUnit / getPeriodMultiplier(flashcrowdRampUntilUnit);
    const squareHighUntilInBaseUnit = Number(tmp_data.square_high_until ?? 0) * getPeriodMultiplier(squareHighUntilUnit);
    const sampleRateValue = Number(tmp_data.sample_rate);
    const squareHighMinInBaseUnit = Number.isFinite(periodInBaseUnit) && Number.isFinite(sampleRateValue) && sampleRateValue > 0
        ? (periodInBaseUnit / sampleRateValue)
        : NaN;
    const squareHighWarning = isSquare
        && Number.isFinite(squareHighUntilInBaseUnit)
        && Number.isFinite(squareHighMinInBaseUnit)
        && squareHighUntilInBaseUnit < squareHighMinInBaseUnit;
    const squareHighMinLabel = Number.isFinite(squareHighMinInBaseUnit)
        ? formatNanoSeconds(squareHighMinInBaseUnit, 2)
        : "N/A";

    return <Modal show={show} size="lg" onHide={hideRestore}>
        <Modal.Header closeButton>
            <Modal.Title>Configure traffic pattern</Modal.Title>
        </Modal.Header>
        <form onSubmit={(e) => { e.preventDefault(); submit(); }}>
            <Modal.Body>
                <p className="mb-3">
                    Define the shape of the generated traffic. Set the base period, sampling, and choose a pattern.
                </p>

                {alertMessage && (
                    <Alert variant="danger" onClose={() => setAlertMessage(null)} dismissible>
                        {alertMessage}
                    </Alert>
                )}

                <Form.Group as={Row} className="mb-3 align-items-center">
                    <Form.Label column sm={3}>Pattern type</Form.Label>
                    <Col sm={9}>
                        <Form.Select
                            disabled={disabled}
                            value={tmp_data.pattern_type}
                            onChange={(e) => handlePatternTypeChange(e.target.value)}
                            required
                        >
                            <option value={GenerationPattern.Sine}>Sine</option>
                            <option value={GenerationPattern.Square}>Square</option>
                            <option value={GenerationPattern.Triangle}>Triangle</option>
                            <option value={GenerationPattern.Sawtooth}>Sawtooth</option>
                            <option value={GenerationPattern.Flashcrowd}>Flashcrowd</option>
                        </Form.Select>
                    </Col>
                </Form.Group>

                <Form.Group as={Row} className="mb-3 align-items-center">
                    <Form.Label column sm={3}>Period</Form.Label>
                    <Col sm={6}>
                        <Form.Control
                            type="number"
                            min={0}
                            step={"any"}
                            value={tmp_data.period}
                            onChange={(e) => handleNumberChange("period", e.target.value)}
                            required
                            disabled={disabled}
                        />
                    </Col>
                    <Col sm={3}>
                        <Form.Select
                            disabled={disabled}
                            value={periodUnit}
                            onChange={(e) => handlePeriodUnitChange(e.target.value)}
                        >
                            {unitOptions.map(u => (
                                <option key={u.label} value={u.label}>{u.label}</option>
                            ))}
                        </Form.Select>
                    </Col>
                </Form.Group>

                <Form.Group as={Row} className="mb-3 align-items-center">
                    <Form.Label column sm={3}>Sample factor</Form.Label>
                    <Col sm={9}>
                        <Form.Control
                            type="number"
                            min={1}
                            max={1000}
                            step={1}
                            value={tmp_data.sample_rate}
                            onChange={(e) => handleNumberChange("sample_rate", e.target.value)}
                            required
                            disabled={disabled}
                        />
                        <Form.Text className="text-muted">Samples per period.</Form.Text>
                    </Col>
                </Form.Group>

                {supportsInverted && (
                    <Form.Group as={Row} className="mb-3 align-items-center">
                        <Form.Label column sm={3}>
                            <span className="d-inline-flex align-items-center gap-1">
                                Inverted
                                <InfoBox>
                                    <>
                                        <h5>Inverted</h5>
                                        <p>For square waves, inverted means the period starts in the low phase and then switches to the high phase.</p>
                                        <p>For sawtooth, inverted means the period starts high and then linearly decreases.</p>
                                    </>
                                </InfoBox>
                            </span>
                        </Form.Label>
                        <Col sm={9}>
                            <Form.Check
                                type="switch"
                                checked={tmp_data.inverted ?? false}
                                onChange={(e) => handleInvertedChange(e.target.checked)}
                                disabled={disabled}
                            />
                        </Col>
                    </Form.Group>
                )}

                {isSquare && (
                    <Form.Group as={Row} className="mb-3 align-items-center">
                        <Form.Label column sm={3}>Square low</Form.Label>
                        <Col sm={9}>
                            <Form.Control
                                type="number"
                                min={0}
                                max={1}
                                step={"any"}
                                value={tmp_data.square_low ?? 0}
                                onChange={(e) => handleNumberChange("square_low", e.target.value)}
                                required
                                disabled={disabled}
                            />
                            <Form.Text className="text-muted">Relative amplitude during the low phase [0,1].</Form.Text>
                        </Col>
                    </Form.Group>
                )}
                {isSquare && (
                    <Form.Group as={Row} className="mb-3 align-items-start">
                        <Form.Label column sm={3} className="pt-2">{squarePhaseLabel}</Form.Label>
                        <Col sm={6}>
                            <Form.Control
                                type="number"
                                min={0}
                                max={(tmp_data.period * getPeriodMultiplier(periodUnit)) / getPeriodMultiplier(squareHighUntilUnit)}
                                step={"any"}
                                value={tmp_data.square_high_until ?? 0}
                                onChange={(e) => handleNumberChange("square_high_until", e.target.value)}
                                required
                                disabled={disabled}
                            />
                            <Form.Text className="text-muted">{squarePhaseDescription}</Form.Text>
                        </Col>
                        <Col sm={3}>
                            <Form.Select
                                disabled={disabled}
                                value={squareHighUntilUnit}
                                onChange={(e) => handleSquareHighUntilUnitChange(e.target.value)}
                            >
                                {unitOptions.map(u => (
                                    <option key={u.label} value={u.label}>{u.label}</option>
                                ))}
                            </Form.Select>
                        </Col>
                    </Form.Group>
                )}
                {isSquare && squareHighWarning && (
                    <Form.Group as={Row} className="mb-3">
                        <Col sm={3}></Col>
                        <Col sm={9}>
                            <Form.Text className="text-warning">
                                ⚠️ Value is too low for the sampling interval (min {squareHighMinLabel}).
                            </Form.Text>
                        </Col>
                    </Form.Group>
                )}

                {isFlashcrowd && (
                    <>
                        <Form.Group as={Row} className="mb-3 align-items-start">
                            <Form.Label column sm={3} className="pt-2">Quiet until</Form.Label>
                            <Col sm={6}>
                                <Form.Control
                                    type="number"
                                    min={0}
                                    max={flashcrowdQuietUntilMax}
                                    step={"any"}
                                    value={tmp_data.fc_quiet_until ?? 0}
                                    onChange={(e) => handleNumberChange("fc_quiet_until", e.target.value)}
                                    required
                                    disabled={disabled}
                                />
                                <Form.Text className="text-muted">Time within the period where the quiet phase ends.</Form.Text>
                            </Col>
                            <Col sm={3}>
                                <Form.Select
                                    disabled={disabled}
                                    value={flashcrowdQuietUntilUnit}
                                    onChange={(e) => handleFlashcrowdQuietUntilUnitChange(e.target.value)}
                                >
                                    {unitOptions.map(u => (
                                        <option key={u.label} value={u.label}>{u.label}</option>
                                    ))}
                                </Form.Select>
                            </Col>
                        </Form.Group>

                        <Form.Group as={Row} className="mb-3 align-items-start">
                            <Form.Label column sm={3} className="pt-2">Ramp until</Form.Label>
                            <Col sm={6}>
                                <Form.Control
                                    type="number"
                                    min={0}
                                    max={flashcrowdRampUntilMax}
                                    step={"any"}
                                    value={tmp_data.fc_ramp_until ?? 0}
                                    onChange={(e) => handleNumberChange("fc_ramp_until", e.target.value)}
                                    required
                                    disabled={disabled}
                                />
                                <Form.Text className="text-muted">Time within the period where the ramp phase reaches peak load.</Form.Text>
                            </Col>
                            <Col sm={3}>
                                <Form.Select
                                    disabled={disabled}
                                    value={flashcrowdRampUntilUnit}
                                    onChange={(e) => handleFlashcrowdRampUntilUnitChange(e.target.value)}
                                >
                                    {unitOptions.map(u => (
                                        <option key={u.label} value={u.label}>{u.label}</option>
                                    ))}
                                </Form.Select>
                            </Col>
                        </Form.Group>

                        <Form.Group as={Row} className="mb-3 align-items-center">
                            <Form.Label column sm={3}>Decay rate</Form.Label>
                            <Col sm={9}>
                                <Form.Control
                                    type="number"
                                    min={0}
                                    step={"any"}
                                    value={tmp_data.fc_decay_rate ?? 0}
                                    onChange={(e) => handleNumberChange("fc_decay_rate", e.target.value)}
                                    required
                                    disabled={disabled}
                                />
                                <Form.Text className="text-muted">Higher values decay faster after the peak.</Form.Text>
                            </Col>
                        </Form.Group>
                    </>
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
    </Modal>;

};

export default PatternModal;
