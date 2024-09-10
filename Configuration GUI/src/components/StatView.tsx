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

import { useEffect, useState } from "react";
import { Col, Row, Table } from "react-bootstrap";
import {
  GenerationMode,
  Statistics,
  TimeStatistics,
} from "../common/Interfaces";
import { formatBits } from "./SendReceiveMonitor";

import styled from "styled-components";
import Visuals from "./Visuals";

import {
  get_frame_stats,
  get_frame_types,
  get_lost_packets,
  get_out_of_order_packets,
  formatFrameCount,
  formatNanoSeconds,
  calculateWeightedRTTs,
  calculateWeightedIATs,
  addRates,
} from "../common/utils/StatisticUtils";
import translate from "./translation/Translate";

const Overline = styled.span`
  text-decoration: overline;
`;

const StatView = ({
  stats,
  time_stats,
  port_mapping,
  mode,
  visual,
}: {
  stats: Statistics;
  time_stats: TimeStatistics;
  port_mapping: { [name: number]: number };
  mode: GenerationMode;
  visual: boolean;
}) => {
  const [total_tx, set_total_tx] = useState(0);
  const [total_rx, set_total_rx] = useState(0);
  const [iat_tx, set_iat_tx] = useState({ mean: 0, std: 0, n: 0, mae: 0 });
  const [iat_rx, set_iat_rx] = useState({ mean: 0, std: 0, n: 0, mae: 0 });
  const [rtt, set_rtt] = useState({
    mean: 0,
    max: 0,
    min: 0,
    jitter: 0,
    n: 0,
    current: 0,
  });
  const [lost_packets, set_lost_packets] = useState(0);
  const [out_of_order_packets, set_out_of_order_packets] = useState(0);

  useEffect(() => {
    let ret_tx = 0;
    let ret_rx = 0;

    Object.keys(stats.frame_size).forEach((v) => {
      if (Object.keys(port_mapping).includes(v)) {
        stats.frame_size[v]["tx"].forEach((f) => {
          ret_tx += f.packets;
        });
      }

      if (Object.values(port_mapping).map(Number).includes(parseInt(v))) {
        stats.frame_size[v]["rx"].forEach((f) => {
          ret_rx += f.packets;
        });
      }
    });

    set_iat_tx(calculateWeightedIATs("tx", stats, port_mapping));
    set_iat_rx(calculateWeightedIATs("rx", stats, port_mapping));
    set_rtt(calculateWeightedRTTs(stats, port_mapping));
    set_total_tx(ret_tx);
    set_total_rx(ret_rx);
    set_lost_packets(get_lost_packets(stats, port_mapping));
    set_out_of_order_packets(get_out_of_order_packets(stats, port_mapping));
  }, [stats]);

  const [currentLanguage, setCurrentLanguage] = useState(
    localStorage.getItem("language") || "en-US"
  );

  useEffect(() => {
    const interval = setInterval(() => {
      const storedLanguage = localStorage.getItem("language") || "en-US";
      if (storedLanguage != currentLanguage) {
        setCurrentLanguage(storedLanguage);
      }
    }, 100);
    return () => clearInterval(interval);
  }, [currentLanguage]);

  const tx_rate_l1 = addRates(stats.tx_rate_l1, Object.keys(port_mapping));
  const tx_rate_l2 = addRates(stats.tx_rate_l2, Object.keys(port_mapping));
  const rx_rate_l1 = addRates(
    stats.rx_rate_l1,
    Object.values(port_mapping).map(Number)
  );
  const rx_rate_l2 = addRates(
    stats.rx_rate_l2,
    Object.values(port_mapping).map(Number)
  );

  return (
    <>
      {visual ? (
        <Visuals data={time_stats} stats={stats} port_mapping={port_mapping} />
      ) : null}
      <Row className={"mb-3"}>
        <Col className={"col-12 col-md-6 col-sm-12"}>
          <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
              <tr>
                <th className={"col-3"}>TX L1</th>
                <th className={"col-3"}>RX L1</th>
                <th className={"col-3"}>TX L2</th>
                <th className={"col-3"}>RX L2</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatBits(tx_rate_l1)}</td>
                <td>{formatBits(rx_rate_l1)}</td>
                <td>{formatBits(tx_rate_l2)}</td>
                <td>{formatBits(rx_rate_l2)}</td>
              </tr>
            </tbody>
          </Table>
        </Col>
        <Col className={"col-12 col-sm-12 col-md-3"}>
          <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
              <tr>
                <th className={"col-4"}>
                  <Overline>TX IAT</Overline>
                </th>
                {stats.sample_mode ? (
                  <>
                    <th className={"col-4"}>&#963;(TX IAT)</th>
                    <th className={"col-4"}>#TX IAT</th>
                  </>
                ) : (
                  <th className="col-4">MAE(TX IAT)</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatNanoSeconds(iat_tx.mean)}</td>

                {stats.sample_mode ? (
                  <>
                    <td>{formatNanoSeconds(iat_tx.std)}</td>
                    <td>{iat_tx.n}</td>
                  </>
                ) : (
                  <td>{formatNanoSeconds(iat_tx.mae)}</td>
                )}
              </tr>
            </tbody>
          </Table>
        </Col>
        <Col className={"col-12 col-sm-12 col-md-3"}>
          <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
              <tr>
                <th className={"col-4"}>
                  <Overline>RX IAT</Overline>
                </th>
                {stats.sample_mode ? (
                  <>
                    <th className={"col-4"}>&#963;(RX IAT)</th>
                    <th className={"col-4"}>#RX IAT</th>
                  </>
                ) : (
                  <th className="col-4">MAE(RX IAT)</th>
                )}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatNanoSeconds(iat_rx.mean)}</td>
                {stats.sample_mode ? (
                  <>
                    <td>{formatNanoSeconds(iat_rx.std)}</td>
                    <td>{iat_rx.n}</td>
                  </>
                ) : (
                  <td>{formatNanoSeconds(iat_rx.mae)}</td>
                )}
              </tr>
            </tbody>
          </Table>
        </Col>
      </Row>
      <Row>
        <Col className={"col-12 col-sm-12 col-md-4"}>
          <Table
            striped
            bordered
            hover
            size="sm"
            className={`mt-3 mb-3 ${mode == GenerationMode.ANALYZE ? "opacity-50" : ""
              }`}
          >
            <thead className={"table-dark"}>
              <tr>
                <th>{translate("statistics.lostFrames", currentLanguage)}</th>
                <th>{translate("statistics.lossRate", currentLanguage)}</th>
                <th>{translate("statistics.outOfOrder", currentLanguage)}</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatFrameCount(lost_packets)}</td>
                <td>
                  {lost_packets > 0
                    ? (
                      (lost_packets * 100) /
                      (lost_packets + total_rx)
                    ).toFixed(2) + " %"
                    : "0.00 %"}
                </td>
                <td>{formatFrameCount(out_of_order_packets)}</td>
              </tr>
            </tbody>
          </Table>
        </Col>
        <Col className={"col-12 col-md-8"}>
          <Table
            striped
            bordered
            hover
            size="sm"
            className={`mt-3 mb-3 ${mode == GenerationMode.ANALYZE ? "opacity-50" : ""
              }`}
          >
            <thead className={"table-dark"}>
              <tr>
                <th className={"col-2"}>
                  {translate("statistics.current", currentLanguage)} RTT
                </th>
                <th className={"col-2"}>
                  <Overline>RTT</Overline>
                </th>
                <th className={"col-2"}>
                  {translate("statistics.minimum", currentLanguage)} RTT
                </th>
                <th className={"col-2"}>
                  {translate("statistics.maximum", currentLanguage)} RTT
                </th>
                <th className={"col-2"}>Jitter</th>
                <th className={"col-2"}>#Rtts</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{formatNanoSeconds(rtt.current)}</td>
                <td>{formatNanoSeconds(rtt.mean)}</td>
                <td>{formatNanoSeconds(rtt.min)}</td>
                <td>{formatNanoSeconds(rtt.max)}</td>
                <td>{formatNanoSeconds(rtt.jitter)}</td>
                <td>{rtt.n}</td>
              </tr>
            </tbody>
          </Table>
        </Col>
      </Row>
      <Row>
        <Col className={"col-12 col-md-6"}>
          <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
              <tr>
                <th className={"col-4"}>
                  {translate("statistics.frameType", currentLanguage)}
                </th>
                <th className={"col-4"}>#TX Count</th>
                <th className={"col-4"}>#RX Count</th>
              </tr>
            </thead>
            <tbody>
              {[
                "Multicast",
                "Broadcast",
                "Unicast",
                "VxLAN",
                "Non-Unicast",
                " ",
                "Total",
              ].map((v, i) => {
                let key = v.toLowerCase();
                let data = get_frame_types(stats, port_mapping, key);

                if (key == "total") {
                  data.tx = [
                    "multicast",
                    "broadcast",
                    "unicast",
                    "vxlan",
                  ].reduce((acc, curr) => {
                    acc += get_frame_types(stats, port_mapping, curr).tx;

                    return acc;
                  }, 0);

                  data.rx = [
                    "multicast",
                    "broadcast",
                    "unicast",
                    "vxlan",
                  ].reduce((acc, curr) => {
                    acc += get_frame_types(stats, port_mapping, curr).rx;

                    return acc;
                  }, 0);
                }

                if (key == "non-unicast") {
                  data.tx = ["multicast", "broadcast"].reduce((acc, curr) => {
                    acc += get_frame_types(stats, port_mapping, curr).tx;

                    return acc;
                  }, 0);

                  data.rx = ["multicast", "broadcast"].reduce((acc, curr) => {
                    acc += get_frame_types(stats, port_mapping, curr).rx;

                    return acc;
                  }, 0);
                }
                return (
                  <tr>
                    <td>{v != " " ? v : "\u00A0"}</td>{" "}
                    {/* Quick hack for empty row */}
                    <td>{v != " " ? formatFrameCount(data.tx) : null}</td>
                    <td>{v != " " ? formatFrameCount(data.rx) : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Col>
        <Col className={"col-12 col-md-6"}>
          <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
              <tr>
                <th className={"col-4"}>
                  {translate("statistics.ethernetType", currentLanguage)}
                </th>
                <th className={"col-4"}>#TX Count</th>
                <th className={"col-4"}>#RX Count</th>
              </tr>
            </thead>
            <tbody>
              {["VLAN", "QinQ", "IPv4", "IPv6", "MPLS", "ARP", "Unknown"].map(
                (v, i) => {
                  let key = v.toLowerCase();
                  let data = get_frame_types(stats, port_mapping, key);

                  return (
                    <tr>
                      <td>{v}</td>
                      <td>{formatFrameCount(data.tx)}</td>
                      <td>{formatFrameCount(data.rx)}</td>
                    </tr>
                  );
                }
              )}
            </tbody>
          </Table>
        </Col>
      </Row>

      <Row>
        <Col className={"col-12 col-md-6"}>
          <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
              <tr>
                <th>{translate("statistics.frameSize", currentLanguage)}</th>
                <th>#TX Count</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {[
                [0, 63],
                [64, 64],
                [65, 127],
                [128, 255],
                [256, 511],
                [512, 1023],
                [1024, 1518],
                [1519, 21519],
              ].map((v, i) => {
                let stats_tx = get_frame_stats(
                  stats,
                  port_mapping,
                  "tx",
                  v[0],
                  v[1]
                );
                return (
                  <tr key={i}>
                    {v[0] !== v[1] ? (
                      v[1] > 2000 ? (
                        <td className={"col-4"}> &gt; {v[0] - 1}</td>
                      ) : (
                        <td className={"col-4"}>
                          {v[0]} - {v[1]}
                        </td>
                      )
                    ) : (
                      <td className={"col-4"}>{v[0]}</td>
                    )}
                    <td>{formatFrameCount(stats_tx)}</td>
                    <td className={"col-4"}>
                      {stats_tx > 0
                        ? ((100 * stats_tx) / total_tx).toFixed(2)
                        : 0}
                      %
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>Total</td>
                <td>{formatFrameCount(total_tx)}</td>
              </tr>
            </tbody>
          </Table>
        </Col>
        <Col className={"col-12 col-md-6"}>
          <Table striped bordered hover size="sm" className={"mt-3 mb-3"}>
            <thead className={"table-dark"}>
              <tr>
                <th>{translate("statistics.frameSize", currentLanguage)}</th>
                <th>#RX Count</th>
                <th>%</th>
              </tr>
            </thead>
            <tbody>
              {[
                [0, 63],
                [64, 64],
                [65, 127],
                [128, 255],
                [256, 511],
                [512, 1023],
                [1024, 1518],
                [1519, 21519],
              ].map((v, i) => {
                let stats_rx = get_frame_stats(
                  stats,
                  port_mapping,
                  "rx",
                  v[0],
                  v[1]
                );
                return (
                  <tr key={i}>
                    {v[0] !== v[1] ? (
                      v[1] > 2000 ? (
                        <td className={"col-4"}> &gt; {v[0] - 1}</td>
                      ) : (
                        <td className={"col-4"}>
                          {v[0]} - {v[1]}
                        </td>
                      )
                    ) : (
                      <td className={"col-4"}>{v[0]}</td>
                    )}
                    <td>{formatFrameCount(stats_rx)}</td>
                    <td className={"col-4"}>
                      {stats_rx > 0
                        ? ((100 * stats_rx) / total_rx).toFixed(2)
                        : 0}
                      %
                    </td>
                  </tr>
                );
              })}
              <tr>
                <td>Total</td>
                <td>{formatFrameCount(total_rx)}</td>
              </tr>
            </tbody>
          </Table>
        </Col>
      </Row>
    </>
  );
};

export default StatView;
