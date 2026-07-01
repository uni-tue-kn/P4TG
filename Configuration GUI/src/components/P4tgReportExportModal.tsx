import React, { useState } from "react";
import { Button, Col, Form, Modal, Row } from "react-bootstrap";
import api from "../common/API";
import { ToastVariant } from "../common/Interfaces";

type P4tgReportRequest = {
    title: string,
    tester: string,
    organization: string,
    test_location: string,
    dut_name: string,
    dut_vendor: string,
    dut_model: string,
    dut_software_version: string,
    dut_configuration: string,
    media_type: string,
    protocol: string,
    data_stream_format: string,
    notes: string,
}

const defaultMetadata = (): P4tgReportRequest => ({
    title: "P4TG Test Report",
    tester: "n/a",
    organization: "n/a",
    test_location: "n/a",
    dut_name: "n/a",
    dut_vendor: "n/a",
    dut_model: "n/a",
    dut_software_version: "n/a",
    dut_configuration: "n/a",
    media_type: "n/a",
    protocol: "n/a",
    data_stream_format: "n/a",
    notes: "n/a",
});

const fields: Array<{ key: keyof P4tgReportRequest, label: string, multiline?: boolean }> = [
    { key: "title", label: "Report title" },
    { key: "tester", label: "Tester" },
    { key: "organization", label: "Organization" },
    { key: "test_location", label: "Test location" },
    { key: "dut_name", label: "DUT name" },
    { key: "dut_vendor", label: "DUT vendor" },
    { key: "dut_model", label: "DUT model" },
    { key: "dut_software_version", label: "DUT software version" },
    { key: "media_type", label: "Media type" },
    { key: "protocol", label: "Protocol" },
    { key: "data_stream_format", label: "Data stream format" },
    { key: "dut_configuration", label: "DUT configuration", multiline: true },
    { key: "notes", label: "Notes", multiline: true },
];

const filenameFromDisposition = (disposition: string | undefined): string => {
    const match = disposition?.match(/filename="?([^"]+)"?/i);
    return match?.[1] ?? "p4tg_report.pdf";
};

const P4tgReportExportModal = ({ disabled, showToast }: { disabled?: boolean, showToast: (msg: string, bg: ToastVariant) => void }) => {
    const [show, setShow] = useState(false);
    const [metadata, setMetadata] = useState<P4tgReportRequest>(defaultMetadata());
    const [exporting, setExporting] = useState(false);

    const updateField = (key: keyof P4tgReportRequest, value: string) => {
        setMetadata((prev) => ({ ...prev, [key]: value }));
    };

    const exportReport = async () => {
        setExporting(true);
        try {
            const response = await api.post("/report", metadata, { responseType: "blob" });
            const blob = new Blob([response.data], { type: "application/pdf" });
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = filenameFromDisposition(response.headers["content-disposition"]);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            setShow(false);
            showToast("PDF report exported.", "success");
        } catch (error: any) {
            const responseData = error?.response?.data;
            if (responseData instanceof Blob) {
                showToast("PDF report export failed.", "danger");
            } else {
                showToast(responseData?.message ?? "PDF report export failed.", "danger");
            }
        } finally {
            setExporting(false);
        }
    };

    return <>
        <Button disabled={disabled} onClick={() => setShow(true)} className="mb-1" variant="dark">
            <i className="bi bi-file-earmark-pdf-fill" /> Export PDF
        </Button>
        <Modal show={show} onHide={() => setShow(false)} size="lg" centered scrollable>
            <Modal.Header closeButton>
                <Modal.Title>Report metadata</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                <Row className="g-2">
                    {fields.map((field) => (
                        <Col key={field.key} className={field.multiline ? "col-12" : "col-12 col-md-6"}>
                            <Form.Label className="small mb-1">{field.label}</Form.Label>
                            {field.multiline ?
                                <Form.Control
                                    as="textarea"
                                    rows={3}
                                    value={metadata[field.key]}
                                    disabled={exporting}
                                    onChange={(event) => updateField(field.key, event.target.value)}
                                />
                                :
                                <Form.Control
                                    value={metadata[field.key]}
                                    disabled={exporting}
                                    onChange={(event) => updateField(field.key, event.target.value)}
                                />
                            }
                        </Col>
                    ))}
                </Row>
            </Modal.Body>
            <Modal.Footer>
                <Button variant="outline-secondary" disabled={exporting} onClick={() => setMetadata(defaultMetadata())}>
                    Reset
                </Button>
                <Button variant="secondary" disabled={exporting} onClick={() => setShow(false)}>
                    Cancel
                </Button>
                <Button variant="primary" disabled={exporting} onClick={exportReport}>
                    {exporting ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-download" />} Export PDF
                </Button>
            </Modal.Footer>
        </Modal>
    </>;
};

export default P4tgReportExportModal;
