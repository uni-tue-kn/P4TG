import { useState } from "react";
import { Col, Row } from "react-bootstrap";
import Dropdown from "react-bootstrap/Dropdown";
import ReactCountryFlag from "react-country-flag";

export const userLangToCountryCode = (userLang: string): string => {
  return userLang.substring(3, 5).toUpperCase();
};

export const userLangToTranslateCode = (userLang: string): string => {
  return userLang.substring(0, 2).toUpperCase();
};

const Selector: React.FC = () => {
  const userLang = navigator.language;

  localStorage.getItem("language") ??
    localStorage.setItem("language", userLang);

  const defaultLanguage = (
    <span>
      <ReactCountryFlag
        countryCode={userLangToCountryCode(
          localStorage.getItem("language") ?? userLang
        )}
        style={{ fontSize: "1.7em" }}
      />
    </span>
  );
  const [toggleContents, setToggleContents] =
    useState<React.ReactNode>(defaultLanguage);
  const [isOpen, setIsOpen] = useState(false);

  const handleSelect = (eventKey: string | null) => {
    if (eventKey) {
      setToggleContents(
        <ReactCountryFlag
          countryCode={userLangToCountryCode(eventKey)}
          style={{
            fontSize: "1.7em",
          }}
        />
      );
      setIsOpen(false);
      localStorage.setItem("language", eventKey);
    }
  };

  return (
    <Row className="mb-3">
      <Col className="text-center col-12 mt-1">
        <Dropdown
          show={isOpen}
          onToggle={() => setIsOpen(!isOpen)}
          onSelect={handleSelect}
          drop="end"
        >
          <Dropdown.Toggle variant="light" id="dropdown-basic">
            {toggleContents}
          </Dropdown.Toggle>
          <Dropdown.Menu popperConfig={{ strategy: "fixed" }} renderOnMount>
            <Dropdown.Item eventKey={"de-DE"}>
              <ReactCountryFlag
                countryCode="DE"
                style={{
                  fontSize: "1.7em",
                }}
              />{" "}
              Deutsch
            </Dropdown.Item>
            <Dropdown.Item eventKey={"en-US"}>
              <ReactCountryFlag
                countryCode="US"
                style={{
                  fontSize: "1.7em",
                }}
              />{" "}
              English
            </Dropdown.Item>
          </Dropdown.Menu>
        </Dropdown>
      </Col>
    </Row>
  );
};

export default Selector;
