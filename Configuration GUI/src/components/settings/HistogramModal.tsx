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

import { RttHistogramConfig } from "../../common/Interfaces";
import React, { useEffect, useState } from "react";
import { Alert, Button, Col, Form, Modal, Row } from "react-bootstrap";
import { post } from "../../common/API";

const units = [
    { label: "ns", multiplier: 1 },
    { label: "µs", multiplier: 1_000 },
    { label: "ms", multiplier: 1_000_000 },
];

const HistogramModal = ({
    show,
    hide,
    data,
    disabled,
    pid,
    set_data
}: {
    show: boolean,
    hide: () => void,
    data: RttHistogramConfig,
    disabled: boolean,
    pid: number
    set_data: (pid: number, updated: RttHistogramConfig) => void,
}) => {

    const [tmp_data, set_tmp_data] = useState(data || [])
    const [alertMessage, setAlertMessage] = useState<string | null>(null);

    const [unit, setUnit] = useState("ns");
    const getMultiplier = (unit: string) => units.find(u => u.label === unit)?.multiplier || 1;

    // useEffect to reset tmp_data when data changes
    useEffect(() => {
        if (show){ 
            set_tmp_data({
                min: data?.min ?? 1500,
                max: data?.max ?? 2500,
                num_bins: data?.num_bins ?? 10,
            });
            setUnit("ns");
            setAlertMessage(null);
        }
    }, [show]); // This will run whenever `data` prop changes

    const hideRestore = () => {
        set_tmp_data({ ...data });
        setUnit("ns");
        setAlertMessage(null);
        hide();
    };


    const handleUnit = (newUnit: string) => {
        // Changes the displayed value for min and max if the unit is changed in the dropdown, e.g., 2500 ns -> 2.5 us
        const unitMap = Object.fromEntries(units.map(u => [u.label, u.multiplier]));

        const currentFactor = unitMap[unit];
        const newFactor = unitMap[newUnit];
        const factor = currentFactor / newFactor;

        setUnit(newUnit);
        tmp_data.min *= factor;
        tmp_data.max *= factor;
    };

    const submit = () => {
        const min = tmp_data.min * getMultiplier(unit);
        const max = tmp_data.max * getMultiplier(unit);

        if (min >= max) {
            setAlertMessage("Minimum value must be less than maximum value of range.");
            return;
        }
        if (tmp_data.num_bins > 500) {
            setAlertMessage("500 bins per port are supported at maximum.");
            return;
        }
        if (tmp_data.num_bins > (max - min)) {
            setAlertMessage("Too many bins for too less of range. Increase range, or decrease number of bins.");
            return;            
        }
        if (min > 2 ** 32 - 1) {
            setAlertMessage("Minimum range exceeds range of 32-bit.");
            return;            
        }
        if (max > 2 ** 32 - 1) {
            setAlertMessage("Maximum range exceeds range of 32-bit.");
            return;            
        }

        setAlertMessage(null);

        set_data(pid, {
            num_bins: tmp_data.num_bins,
            min,
            max
        });
        
        hide();

        //updateConfig(pid, min, max, tmp_data.num_bins)
    }

    const handleChange = (field: keyof RttHistogramConfig, value: string) => {
        set_tmp_data(prev => ({ ...prev, [field]: Number(value) }));
    };

    return <Modal show={show} size="lg" onHide={hideRestore}>
        <Modal.Header closeButton>
            <Modal.Title>Configure histogram options on RX port {pid}</Modal.Title>
        </Modal.Header>
        <form onSubmit={submit}>
            <Modal.Body>
                <p className="mb-3">
                    Configure how the incoming data on this RX port will be processed in the RTT histogram. Adjust the range, unit, and bin count to tailor the output.
                </p>

                {alertMessage && (
                    <Alert variant="danger" onClose={() => setAlertMessage(null)} dismissible>
                        {alertMessage}
                    </Alert>
                )}



                <Form.Group as={Row} className=" mb-3 align-items-center">
                    <Form.Label className={"col-3 text-start"} column sm={2}>Range</Form.Label>

                    <Col sm={3}>
                        <Form.Control
                            type="number"
                            value={tmp_data.min}
                            onChange={(e) => handleChange("min", e.target.value)}
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
                            value={tmp_data.max}
                            onChange={(e) => handleChange("max", e.target.value)}
                            required
                            disabled={disabled}
                        />
                    </Col>
                    <Col sm={3}>
                        <Form.Select value={unit} disabled={disabled}
                            onChange={(e) => handleUnit(e.target.value)}>
                            {units.map(u => (
                                <option key={u.label} value={u.label}>{u.label}</option>
                            ))}
                        </Form.Select>
                    </Col>
                </Form.Group>

                <Form.Group as={Row} className="mb-3">
                    <Form.Label column sm={2}>Number of bins</Form.Label>
                    <Col sm={8}>
                        <Form.Control
                            type="number"
                            value={tmp_data.num_bins}
                            onChange={(e) => handleChange("num_bins", e.target.value)}
                            min={1}
                            required
                            disabled={disabled}
                        />
                    </Col>
                </Form.Group>
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