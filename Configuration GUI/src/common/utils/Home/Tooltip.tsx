import React from "react";
import { Col, OverlayTrigger, Tooltip } from "react-bootstrap";
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

export default TestInfoTooltip;
