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

import React from "react";
import { Col } from "react-bootstrap";
import styled from "styled-components";
import { Statistics } from "../common/Interfaces";
import Status from "../components/Status";

const Stat = styled.span<{ active: boolean }>`
  i {
    color: ${(props) =>
    props.active ? "var(--color-okay)" : "var(--color-yellow)"};
    padding-right: 5px;
  }

  margin-right: 10px;
  margin-bottom: 10px;

  background: var(--color-secondary);
  padding: 10px 15px 10px 15px;
  color: #fff;
  border-radius: 10px;
  min-width: 250px;
  text-align: center;
  display: inline-block;
`;

export const Time = styled.span`
  margin-right: 10px;
  min-width: 140px;
  max-width: 140px;
  text-align: center;
  margin-bottom: 10px;
  background: var(--color-secondary);
  padding: 10px 5px 10px 5px;
  color: #fff;
  border-radius: 10px;
  display: inline-block;
`;

export const formatBits = (bits: number, decimals: number = 2) => {
  if (bits === 0 || bits < 0) return "0 Bit/s";

  const k = 1000;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Bit/s", "Kbit/s", "Mbit/s", "Gbit/s", "Tbit/s"];

  const i = Math.floor(Math.log(bits) / Math.log(k));
  return parseFloat((bits / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

export const formatPacketRate = (packets: number, decimals: number = 2) => {
  if (packets === 0 || packets < 0) return "0 Pps";

  const k = 1000;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ["Pps", "Kpps", "Mpps", "Gpps", "Tpps"];

  const i = Math.floor(Math.log(packets) / Math.log(k));

  return parseFloat((packets / Math.pow(k, i)).toFixed(dm)) + " " + sizes[i];
};

const Speed = ({
  up,
  speed,
  packet,
}: {
  up: boolean;
  speed: number;
  packet: number;
}) => {
  return (
    <Stat active={up}>
      {up ? (
        <i className="bi bi-arrow-up-circle-fill" />
      ) : (
        <i className="bi bi-arrow-down-circle-fill" />
      )}
      {formatBits(speed)} ({formatPacketRate(packet)})
    </Stat>
  );
};

export const secondsToTime = (s: number) => {
  let hours = Math.floor(s / 3600);
  let minutes = Math.floor((s % 3600) / 60);
  let seconds = Math.floor((s % 3600) % 60);

  return hours + "h " + minutes + "m " + seconds + "s";
};

const SendReceiveMonitor = ({
  stats,
  running,
}: {
  stats: Statistics;
  running: boolean;
}) => {
  const tx_rate_l1 = Object.values(stats.tx_rate_l1).reduce((a, b) => a + b, 0);
  const tx_rate_l2 = Object.values(stats.tx_rate_l2).reduce((a, b) => a + b, 0);
  const rx_rate_l1 = Object.values(stats.rx_rate_l1).reduce((a, b) => a + b, 0);
  const rx_rate_l2 = Object.values(stats.rx_rate_l2).reduce((a, b) => a + b, 0);

  const mean_frame_size_tx =
    tx_rate_l1 - tx_rate_l2 <= 0
      ? 0
      : (20 * tx_rate_l2) / (tx_rate_l1 - tx_rate_l2);
  const mean_frame_size_rx =
    rx_rate_l1 - rx_rate_l2 <= 0
      ? 0
      : (20 * rx_rate_l2) / (rx_rate_l1 - rx_rate_l2);
  const packet_rate_tx = tx_rate_l1 / 8 / (mean_frame_size_tx + 20);
  const packet_rate_rx = rx_rate_l1 / 8 / (mean_frame_size_rx + 20);

  return (
    <Col className={"col-8 text-start"}>
      <Speed up={true} speed={tx_rate_l1} packet={packet_rate_tx} />
      <Speed up={false} speed={rx_rate_l1} packet={packet_rate_rx} />
      {running ? <Status stats={stats} running={running} /> : null}

      {stats.elapsed_time > 0 ? (
        <Time>{secondsToTime(stats.elapsed_time)}</Time>
      ) : null}

      {tx_rate_l1 > 0 && 1 - rx_rate_l1 / tx_rate_l1 > 0.001 ? (
        <>
          <i className="bi bi-exclamation-circle-fill text-danger" />{" "}
          {(100 * (1 - rx_rate_l1 / tx_rate_l1)).toFixed(2)} %
        </>
      ) : null}
    </Col>
  );
};

export default SendReceiveMonitor;
