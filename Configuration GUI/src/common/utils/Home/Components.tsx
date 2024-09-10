import React from "react";
import { Alert, Button, Col, OverlayTrigger, Tooltip } from "react-bootstrap";
import translate from "../../../components/translation/Translate";
import { ProfileMode, TestMode } from "../../Interfaces";

type TestInfoProps = {
  running: boolean;
  testMode: TestMode;
  currentTestNumber: number;
  totalTestsNumber: number;
  currentTestDuration: number;
  currentProfileTest: string | null;
  currentLanguage: string;
  profileMode: ProfileMode;
};

const TestInfoTooltip: React.FC<TestInfoProps> = ({
  running,
  testMode,
  currentTestNumber,
  totalTestsNumber,
  currentTestDuration,
  currentProfileTest,
  currentLanguage,
  profileMode,
}) => {
  if (!running) return null;

  return (
    <>
      {testMode === TestMode.MULTI && (
        <Col className="col-auto">
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip id="test-info-tooltip">
                Test {currentTestNumber}{" "}
                {translate("other.of", currentLanguage)} {totalTestsNumber}
                <br />
                {translate("other.duration", currentLanguage)}{" "}
                {currentTestDuration}{" "}
                {translate("units.seconds", currentLanguage)}
              </Tooltip>
            }
          >
            <i className="bi bi-info-circle" style={{ cursor: "pointer" }} />
          </OverlayTrigger>{" "}
          {translate("other.testInfo", currentLanguage)}
        </Col>
      )}

      {testMode === TestMode.PROFILE && (
        <Col className="col-auto">
          <OverlayTrigger
            placement="top"
            overlay={
              <Tooltip id="test-info-tooltip">
                {profileMode === ProfileMode.RFC2544
                  ? translate("tooltip.rfc", currentLanguage)
                  : translate("tooltip.simpleImix", currentLanguage)}
                <br />
                {profileMode === ProfileMode.RFC2544 && currentProfileTest}
              </Tooltip>
            }
          >
            <i className="bi bi-info-circle" style={{ cursor: "pointer" }} />
          </OverlayTrigger>{" "}
          {translate("tooltip.profil", currentLanguage)}
        </Col>
      )}
    </>
  );
};

const ActionButtonsRunning = ({
  restart,
  setOverlay,
  testMode,
  currentLanguage,
  translate,
}: {
  restart: (setOverlay: any) => void;
  setOverlay: any;
  testMode: TestMode;
  currentLanguage: string;
  translate: (key: string, language: string) => string;
}) => {
  return (
    <>
      <Button type="submit" className="mb-1" variant="danger">
        {testMode === TestMode.PROFILE ? (
          <>
            <i className="bi bi-stop-fill" />{" "}
            {translate("buttons.stopProfile", currentLanguage)}
          </>
        ) : testMode === TestMode.MULTI ? (
          <>
            <i className="bi bi-skip-end-circle-fill" />{" "}
            {translate("buttons.skipTest", currentLanguage)}
          </>
        ) : (
          <>
            <i className="bi bi-stop-fill" /> Stop
          </>
        )}
      </Button>{" "}
      {testMode !== TestMode.MULTI && testMode !== TestMode.PROFILE && (
        <Button
          onClick={() => restart(setOverlay)}
          className="mb-1"
          variant="primary"
        >
          <i className="bi bi-arrow-clockwise" />{" "}
          {translate("buttons.restart", currentLanguage)}{" "}
        </Button>
      )}
    </>
  );
};

const ActionButtonsNotRunning = ({
  reset,
  setOverlay,
  testMode,
  currentLanguage,
  translate,
}: {
  reset: (setOverlay: any) => void;
  setOverlay: any;
  testMode: TestMode;
  currentLanguage: string;
  translate: (key: string, language: string) => string;
}) => {
  return (
    <>
      <Button type={"submit"} className="mb-1" variant="primary">
        <i className="bi bi-play-circle-fill" />{" "}
        {testMode === TestMode.MULTI
          ? translate("buttons.runTest", currentLanguage)
          : testMode === TestMode.PROFILE
            ? translate("buttons.runProfile", currentLanguage)
            : "Start"}{" "}
      </Button>{" "}
      <Button
        onClick={() => {
          reset(setOverlay);
        }}
        className="mb-1"
        variant="warning"
      >
        <i className="bi bi-trash-fill" />{" "}
        {translate("buttons.reset", currentLanguage)}{" "}
      </Button>{" "}
    </>
  );
};

const ResetAlert = ({
  running,
  testMode,
  selectedProfile,
  currentProfileTest,
  currentLanguage,
}: {
  running: boolean;
  testMode: TestMode;
  selectedProfile: ProfileMode;
  currentProfileTest: string | null;
  currentLanguage: string;
}) => {
  if (
    running &&
    testMode === TestMode.PROFILE &&
    selectedProfile === ProfileMode.RFC2544 &&
    currentProfileTest === "Reset - 64 Bytes"
  ) {
    return (
      <Col className="col-12">
        <Alert variant={"primary"}>
          {translate("alert.dutReset", currentLanguage)}
        </Alert>
      </Col>
    );
  }
  return null;
};

export {
  TestInfoTooltip,
  ActionButtonsRunning,
  ActionButtonsNotRunning,
  ResetAlert,
};
