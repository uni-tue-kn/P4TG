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