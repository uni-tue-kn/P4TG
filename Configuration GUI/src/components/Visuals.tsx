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
 * Steffen Lindner (steffen.lindner@uni-tuebingen.de)
 */

import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend,
  ArcElement,
} from "chart.js";

import { Doughnut, Line } from "react-chartjs-2";
import { Statistics, TimeStatistics } from "../common/Interfaces";
import { useEffect, useState } from "react";
import { Col, Form, Row } from "react-bootstrap";

import {
  get_rate_data,
  get_loss_data,
  get_rtt_data,
  get_frame_type_data,
  get_ethernet_type_data,
  get_frame_size_data,
  get_rate_options,
  get_loss_options,
  get_rtt_options,
  get_frame_options,
} from "../common/utils/VisualUtils";

import translate from "./translation/Translate";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  ArcElement,
  LineElement,
  Title,
  Tooltip,
  Filler,
  Legend
);

const Visuals = ({
  data,
  stats,
  port_mapping,
}: {
  data: TimeStatistics;
  stats: Statistics;
  port_mapping: { [name: number]: number };
}) => {
  const [currentLanguage, setCurrentLanguage] = useState(
    localStorage.getItem("language") || "en-US"
  );

  const [theme, setTheme] = useState(localStorage.getItem("theme") || "light");

  useEffect(() => {
    const interval = setInterval(() => {
      const storedLanguage = localStorage.getItem("language") || "en-US";
      if (storedLanguage !== currentLanguage) {
        setCurrentLanguage(storedLanguage);
      }

      const storedTheme = localStorage.getItem("theme") || "light";
      if (storedTheme !== theme) {
        setTheme(storedTheme);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [currentLanguage, theme]);

  const [visual_select, set_visual_select] = useState("rate");

  const rate_data = get_rate_data(data, port_mapping, theme);

  const rate_options = get_rate_options(theme);

  const loss_data = get_loss_data(data, port_mapping, theme);

  const loss_options = get_loss_options(theme);

  const rtt_data = get_rtt_data(data, port_mapping);

  const rtt_options = get_rtt_options(theme);

  const frame_type_data = get_frame_type_data(stats, port_mapping);

  const ethernet_type_data = get_ethernet_type_data(stats, port_mapping);

  const frame_size_data = get_frame_size_data(stats, port_mapping);

  const frame_options = get_frame_options(theme);

  // @ts-ignore
  return (
    <>
      {visual_select === "rate" ? (
        <Line options={rate_options} data={rate_data} />
      ) : null}

      {visual_select === "loss" ? (
        <Line options={loss_options} data={loss_data} />
      ) : null}

      {visual_select === "frame" ? (
        <Row>
          <Col className={"col-4"}>
            <Doughnut
              data={frame_type_data}
              options={frame_options}
              title={"Frame types"}
            />
          </Col>
          <Col className={"col-4"}>
            <Doughnut data={ethernet_type_data} options={frame_options} />
          </Col>
          <Col className={"col-4"}>
            <Doughnut data={frame_size_data} options={frame_options} />
          </Col>
        </Row>
      ) : null}

      {visual_select === "rtt" ? (
        <Line options={rtt_options} data={rtt_data} />
      ) : null}

      <Row className={"text-center mb-3 mt-3"}>
        <Form onChange={(event: any) => set_visual_select(event.target.id)}>
          <Form.Check
            inline
            label={translate("visualization.trafficRates", currentLanguage)}
            type="radio"
            name={"visuals"}
            checked={visual_select === "rate"}
            id={`rate`}
          />
          <Form.Check
            inline
            label={translate(
              "visualization.packetLoss/OutOfOrder",
              currentLanguage
            )}
            type="radio"
            name={"visuals"}
            checked={visual_select === "loss"}
            id={`loss`}
          />
          <Form.Check
            inline
            label="RTT"
            type="radio"
            name={"visuals"}
            checked={visual_select === "rtt"}
            id={`rtt`}
          />
          <Form.Check
            inline
            label="Frames"
            type="radio"
            name={"visuals"}
            checked={visual_select === "frame"}
            id={`frame`}
          />
        </Form>
      </Row>
    </>
  );
};

export default Visuals;
