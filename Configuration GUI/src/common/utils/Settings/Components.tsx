import { Button, Col, Row } from "react-bootstrap";
import { GenerationMode, TrafficGenData } from "../../Interfaces";
import translate from "../../../components/translation/Translate";

const SaveResetButtons = ({
  onSave,
  onReset,
  running,
  currentLanguage,
}: {
  onSave: () => void;
  onReset: () => void;
  running: boolean;
  currentLanguage: string;
}) => {
  return (
    <>
      <Button onClick={onSave} disabled={running} variant="primary">
        <i className="bi bi-check" />{" "}
        {translate("buttons.save", currentLanguage)}
      </Button>{" "}
      <Button onClick={onReset} disabled={running} variant="danger">
        <i className="bi bi-x-octagon-fill" />{" "}
        {translate("buttons.reset", currentLanguage)}
      </Button>
    </>
  );
};

const AddStreamButton = ({
  addStream,
  running,
  currentTest,
  currentLanguage,
}: {
  addStream: () => void;
  running: boolean;
  currentTest: TrafficGenData | null;
  currentLanguage: string;
}) => {
  return (
    <Row className={"mb-3"}>
      <Col className={"text-start"}>
        {running || !currentTest ? null : currentTest.mode ===
            GenerationMode.CBR || currentTest.mode === GenerationMode.MPPS ? (
          <Button onClick={addStream} variant="primary">
            <i className="bi bi-plus" />{" "}
            {translate("buttons.addStream", currentLanguage)}
          </Button>
        ) : null}
      </Col>
    </Row>
  );
};

const TotalDuration = ({ currentLanguage, totalDuration }: any) => (
  <Button variant="secondary" disabled={true}>
    <i className="bi bi-clock-history" />{" "}
    {translate("buttons.totalDuration", currentLanguage)}: {totalDuration}{" "}
    {translate("units.seconds", currentLanguage)}
  </Button>
);

const ImportExport = ({
  handleImport,
  handleExport,
  running,
  currentLanguage,
}: {
  handleImport: (e: any) => void;
  handleExport: () => void;
  running: boolean;
  currentLanguage: string;
}) => {
  return (
    <>
      <Button onClick={handleImport} disabled={running} variant={"primary"}>
        <i className="bi bi-cloud-arrow-down-fill" />{" "}
        {translate("buttons.import", currentLanguage)}
      </Button>{" "}
      <Button onClick={handleExport} disabled={running} variant={"danger"}>
        <i className="bi bi-cloud-arrow-up-fill" />{" "}
        {translate("buttons.export", currentLanguage)}
      </Button>
    </>
  );
};

export { SaveResetButtons, AddStreamButton, TotalDuration, ImportExport };
