import React, { useEffect, useState } from "react";
import { Alert, Button, Form, InputGroup, Modal } from "react-bootstrap";
import { GenerationUnit } from "../../common/Interfaces";
import { IMIXConfig, IMIX_DESCRIPTION } from "../../common/IMIX";

const defaultIMIXConfig = (): IMIXConfig => ({
    totalRate: 1,
    unit: GenerationUnit.Gbps,
    ipVersion: 4,
});

const IMIXModal = ({
    show,
    hide,
    onConfirm,
}: {
    show: boolean,
    hide: () => void,
    onConfirm: (config: IMIXConfig) => void,
}) => {
    const [tmpData, setTmpData] = useState<IMIXConfig>(defaultIMIXConfig());
    const [alertMessage, setAlertMessage] = useState<string | null>(null);

    useEffect(() => {
        if (show) {
            setTmpData(defaultIMIXConfig());
            setAlertMessage(null);
        }
    }, [show]);

    const hideRestore = () => {
        setTmpData(defaultIMIXConfig());
        setAlertMessage(null);
        hide();
    };

    const submit = () => {
        if (!Number.isFinite(tmpData.totalRate) || tmpData.totalRate <= 0) {
            setAlertMessage("Total rate must be greater than zero.");
            return;
        }

        setAlertMessage(null);
        onConfirm(tmpData);
        hide();
    };

    return <Modal show={show} onHide={hideRestore}>
        <Modal.Header closeButton>
            <Modal.Title>Add IMIX Streams</Modal.Title>
        </Modal.Header>
        <Form onSubmit={(event) => {
            event.preventDefault();
            submit();
        }}>
            <Modal.Body>
                <p className="mb-3">
                    Create three streams using the built-in IMIX approximation <code>{IMIX_DESCRIPTION}</code>.
                </p>
                {alertMessage && (
                    <Alert variant="danger" onClose={() => setAlertMessage(null)} dismissible>
                        {alertMessage}
                    </Alert>
                )}
                <Form.Group className="mb-3">
                    <Form.Label>Total rate</Form.Label>
                    <InputGroup>
                        <Form.Control
                            type="number"
                            min="0"
                            step="any"
                            value={tmpData.totalRate}
                            onChange={(event) => setTmpData((prev) => ({
                                ...prev,
                                totalRate: parseFloat(event.target.value),
                            }))}
                        />
                        <Form.Select
                            value={tmpData.unit}
                            onChange={(event) => setTmpData((prev) => ({
                                ...prev,
                                unit: parseInt(event.target.value),
                            }))}
                            style={{ maxWidth: "110px" }}
                        >
                            <option value={GenerationUnit.Gbps}>Gbps</option>
                            <option value={GenerationUnit.Mpps}>Mpps</option>
                        </Form.Select>
                    </InputGroup>
                </Form.Group>
                <Form.Group>
                    <Form.Label>IP version</Form.Label>
                    <Form.Select
                        value={tmpData.ipVersion}
                        onChange={(event) => setTmpData((prev) => ({
                            ...prev,
                            ipVersion: parseInt(event.target.value) as 4 | 6,
                        }))}
                    >
                        <option value={4}>IPv4</option>
                        <option value={6}>IPv6</option>
                    </Form.Select>
                </Form.Group>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={hideRestore}>Cancel</Button>
                <Button variant="primary" type="submit">Create</Button>
            </Modal.Footer>
        </Form>
    </Modal>
}

export default IMIXModal
