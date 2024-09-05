import { useState, useEffect } from "react";
import { Col, Row } from "react-bootstrap";

const ThemeBtn = () => {
  const [theme, setTheme] = useState(() => {
    let storedTheme = localStorage.getItem("theme");
    if (!storedTheme) {
      const prefersDarkScheme = window.matchMedia(
        "(prefers-color-scheme: dark)"
      ).matches;
      storedTheme = prefersDarkScheme ? "dark" : "light";
      localStorage.setItem("theme", storedTheme);
    }
    return storedTheme;
  });

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    localStorage.setItem("theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
  };

  return (
    <Row className="mb-3">
      <Col className="text-center col-12 mt-1">
        <i
          className={`theme-icon ${
            theme === "light" ? "bi bi-moon-fill" : "bi bi-brightness-high-fill"
          }`}
          style={{
            color: theme === "dark" ? "white" : "black",
            fontSize: "1.1rem",
            fontWeight: "bold",
          }}
          onClick={toggleTheme}
        ></i>
      </Col>
    </Row>
  );
};

export default ThemeBtn;
