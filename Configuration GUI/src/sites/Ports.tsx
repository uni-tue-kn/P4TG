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

import React, { useEffect, useState } from "react";
import Loader from "../components/Loader";
import { get, post } from "../common/API";
import { Button, Col, Form, Row, Table } from "react-bootstrap";
import styled from "styled-components";
import InfoBox from "../components/InfoBox";
import {ASIC, FEC, P4TGConfig, P4TGInfos, SPEED} from "../common/Interfaces";
import {auto_neg_mapping, fec_mapping, loopback_mapping, speed_mapping} from "../common/Definitions";
import {GitHub} from "./Home";
import translate from "../components/translation/Translate";

const StyledCol = styled.td`
  vertical-align: middle;
  display: table-cell;
  text-indent: 5px;
`;

export const PortStat = styled.span<{ active: boolean }>`
  color: ${(props) =>
    props.active ? "var(--color-okay)" : "var(--color-primary)"};
`;

export const PortStatus = ({ active }: { active: boolean }) => {
  return (
    <PortStat active={active}>
      {active ? (
        <i className="bi bi-arrow-up-circle-fill" />
      ) : (
        <i className="bi bi-arrow-down-circle-fill" />
      )}
    </PortStat>
  );
};

const Ports = ({p4tg_infos}: {p4tg_infos: P4TGInfos}) => {
    const [loaded, set_loaded] = useState(false)
    const [ports, set_ports] = useState([])
    const [config, set_config] = useState<P4TGConfig>({tg_ports: []})

  const loadPorts = async () => {
    let stats = await get({ route: "/ports" });
    let config = await get({ route: "/config" });

    if (stats.status === 200) {
      set_ports(stats.data);
      set_config(config.data);
      set_loaded(true);
    }
  };

  const updatePort = async (
    pid: number,
    speed: string,
    fec: string,
    auto_neg: string
  ) => {
    let update = await post({
      route: "/ports",
      body: {
        pid: pid,
        speed: speed,
        fec: fec,
        auto_neg: auto_neg,
      },
    });

    if (update.status === 201) {
      refresh()
  }
}

const updateArp = async (pid: number, state: boolean) => {
  console.log(state)
  let update = await post({
      route: "/ports/arp", body: {
          pid: pid,
          arp_reply: state
      }
  })

  if (update.status === 201) {
      refresh()
  }
}

const getMac = (port: number) => {
  let mac = "Unknown"

  config.tg_ports.forEach(p => {
      if(p.port == port) {
          mac = p.mac
      }
  })

  return mac
}

const getArpReply = (port: number) => {
  let reply = false

  config.tg_ports.forEach(p => {
      if(p.port == port) {
          reply = p.arp_reply ?? false
      }
  })

  return reply
}

const refresh = () => {
  set_loaded(false)
  loadPorts()
}

useEffect(() => {
  loadPorts()

}, [])

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

  return (
    <Loader loaded={loaded}>
      <Table
        striped
        bordered
        hover
        size="sm"
        className={"mt-3 mb-3 text-center"}
      >
        <thead className={"table-dark"}>
          <tr>
            <th>PID</th>
            <th>Port</th>
            <th>
              MAC &nbsp;{" "}
              <InfoBox>
                <p>{translate("infoBoxes.mac", currentLanguage)}</p>
              </InfoBox>
            </th>
            <th>{translate("other.speed", currentLanguage)}</th>
            <th>Auto Negotiation</th>
            <th>FEC</th>
            <th>
              {translate("other.arpReply", currentLanguage)} &nbsp;
              <InfoBox>
                <p>{translate("infoBoxes.arp", currentLanguage)}</p>
              </InfoBox>
            </th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
        {ports.map((v: any, i: number) => {
                if (loopback_mapping[v["loopback"]] != "On" || p4tg_infos.loopback) {
                    return <tr key={i}>
                        <StyledCol className={"col-1"}>{v["pid"]}</StyledCol>
                        <StyledCol className={"col-1"}>{v['port']}/{v["channel"]}</StyledCol>
                        <StyledCol className={"col-2"}>{getMac(v['port'])}</StyledCol>
                        <StyledCol className={"col-2"}>
                            <Form.Select onChange={async (event: any) => {
                                let fec = v.fec

                                // 400G requires RS
                                if(event.target.value == SPEED.BF_SPEED_400G) {
                                    fec = FEC.BF_FEC_TYP_REED_SOLOMON
                                }

                                // 10G & 40G does not allow RS
                                if((event.target.value == SPEED.BF_SPEED_10G || event.target.value == SPEED.BF_SPEED_40G) && v.fec == FEC.BF_FEC_TYP_REED_SOLOMON) {
                                    fec = FEC.BF_FEC_TYP_NONE
                                }

                                // 100G does not allow FC
                                if(event.target.value == SPEED.BF_SPEED_100G && v.fec == FEC.BF_FEC_TYP_FC) {
                                    fec = FEC.BF_FEC_TYP_NONE
                                }

                                await updatePort(v.pid, event.target.value, fec, v.auto_neg)
                            }}>
                                {Object.keys(speed_mapping).map(f => {
                                    if(f == SPEED.BF_SPEED_400G && p4tg_infos.asic != ASIC.Tofino2) {
                                        return
                                    }

                                    return <option selected={f == v.speed}
                                                   value={f}>{speed_mapping[f]}</option>
                                })}
                            </Form.Select>
                        </StyledCol>
                        <StyledCol className={"col-2"}>
                            <Form.Select onChange={async (event: any) => {
                                await updatePort(v["pid"], v["speed"], v["fec"], event.target.value)
                            }}>
                                {Object.keys(auto_neg_mapping).map(f => {
                                    return <option selected={f == v["auto_neg"]}
                                                   value={f}>{auto_neg_mapping[f]}</option>
                                })}
                            </Form.Select></StyledCol>
                        <StyledCol className={"col-2"}><Form.Select onChange={async (event: any) => {
                            await updatePort(v["pid"], v["speed"], event.target.value, v["auto_neg"])
                        }}>
                            {Object.keys(fec_mapping).map(f => {
                                if(f != FEC.BF_FEC_TYP_REED_SOLOMON && v.speed == SPEED.BF_SPEED_400G) {
                                    return
                                }

                                if(f == FEC.BF_FEC_TYP_REED_SOLOMON && (v.speed == SPEED.BF_SPEED_10G ||v.speed == SPEED.BF_SPEED_40G)) {
                                    return
                                }

                                if (f != FEC.BF_FEC_TYP_FC || v.speed!= SPEED.BF_SPEED_100G) {
                                    return <option selected={f == v["fec"]} value={f}>{fec_mapping[f]}</option>
                                }
                            })}
                        </Form.Select>
                        </StyledCol>
                        <StyledCol className={"col-1"}>
                            <Form.Check
                                defaultChecked={getArpReply(v['port'])}
                                onChange={async (event: any) => {
                                    await updateArp(v["pid"], event.target.checked)
                                }}
                                type={"switch"}
                                >
                            </Form.Check>
                        </StyledCol>
                        <StyledCol className={"col-1"}><PortStatus active={v['status']}/></StyledCol>
                    </tr>
                }
            })
            }
            </tbody>
        </Table>

        <Row>
            <Col>
                <Button onClick={refresh} className={"ml-3"}><i className="bi bi-arrow-clockwise"/> Refresh</Button>
            </Col>
        </Row>

      <GitHub />
    </Loader>
  );
};

export default Ports;
