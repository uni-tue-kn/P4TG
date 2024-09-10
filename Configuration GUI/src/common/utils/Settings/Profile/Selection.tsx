import InfoBox from "../../../../components/InfoBox";
import translate from "../../../../components/translation/Translate";
import { ProfileMode, RFCTestSelection } from "../../../Interfaces";
import {
  Form,
  Dropdown,
  DropdownButton,
  ButtonGroup,
  Col,
} from "react-bootstrap";
import { RFC2544Info } from "./InfoText";

const getProfileName = (profile: ProfileMode): string => {
  switch (profile) {
    case ProfileMode.RFC2544:
      return "RFC2544";
    case ProfileMode.IMIX:
      return "IMIX";
    default:
      return "Unknown";
  }
};

const renderProfileDropdown = (
  selected_profile: ProfileMode,
  handleProfileChange: (profile: string | null) => void,
  running: boolean,
  currentLanguage: string
) => {
  return (
    <Col className="col-2">
      <DropdownButton
        as={ButtonGroup}
        className="me-3"
        variant={"secondary"}
        key={"Select Profile"}
        title={getProfileName(selected_profile)}
        onSelect={handleProfileChange}
        disabled={running}
      >
        <Dropdown.Item
          eventKey={ProfileMode.RFC2544.toString()}
          active={ProfileMode.RFC2544 === selected_profile}
          key={"RFC2544"}
        >
          RFC2544
        </Dropdown.Item>
        <Dropdown.Item
          eventKey={ProfileMode.IMIX.toString()}
          active={ProfileMode.IMIX === selected_profile}
          key={"IMIX"}
        >
          IMIX
        </Dropdown.Item>
      </DropdownButton>
      {selected_profile === ProfileMode.RFC2544 && (
        <InfoBox>
          <RFC2544Info currentLanguage={currentLanguage} />
        </InfoBox>
      )}
    </Col>
  );
};

const renderRFCSelect = (
  running: boolean,
  rfc: RFCTestSelection,
  currentLanguage: string,
  handleRFCChange: (event: any) => void
) => {
  return (
    <>
      <Form.Text className="text-muted">
        {translate("input.rfcMode.title", currentLanguage)}
      </Form.Text>
      <Form.Select
        disabled={running}
        required
        onChange={handleRFCChange}
        className="me-3"
        value={rfc}
      >
        <option value={RFCTestSelection.ALL}>
          {translate("input.rfcMode.options.all", currentLanguage)}
        </option>
        <option value={RFCTestSelection.THROUGHPUT}>
          {translate("input.rfcMode.options.throughput", currentLanguage)}
        </option>
        <option value={RFCTestSelection.LATENCY}>
          {translate("input.rfcMode.options.latency", currentLanguage)}
        </option>
        <option value={RFCTestSelection.FRAME_LOSS_RATE}>
          {translate("input.rfcMode.options.frameLoss", currentLanguage)}
        </option>
        <option value={RFCTestSelection.RESET}>
          {translate("input.rfcMode.options.reset", currentLanguage)}
        </option>
      </Form.Select>
    </>
  );
};

export { renderProfileDropdown, renderRFCSelect };
