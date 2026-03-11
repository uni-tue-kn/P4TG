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

import React, { useEffect, useState } from 'react'
import Loader from "../components/Loader";
import { get, post } from '../common/API'
import { Button, Col, Dropdown, Form, OverlayTrigger, Row, Table, Tooltip } from "react-bootstrap";
import styled from "styled-components";
import InfoBox from "../components/InfoBox";
import { ASIC, FEC, P4TGConfig, P4TGInfos, SPEED } from "../common/Interfaces";
import { auto_neg_mapping, fec_mapping, loopback_mapping, speed_mapping } from "../common/Definitions";
import { validateMAC } from "../common/Validators";
import { GitHub } from "./Home";

const StyledCol = styled.td`
    vertical-align: middle;
    display: table-cell;
    text-indent: 5px;
`

const renderTooltip = (props: any, message: string) => (
    <Tooltip id="tooltip-disabled" {...props}>
        {message}
    </Tooltip>
);

export const PortStat = styled.span<{ active: boolean }>`
    color: ${props => (props.active ? 'var(--color-okay)' : 'var(--color-primary)')};
`

export const PortStatus = ({ active }: { active: boolean }) => {
    return <PortStat active={active}>
        {active ?
            <i className="bi bi-arrow-up-circle-fill" />
            :
            <i className="bi bi-arrow-down-circle-fill" />
        }
    </PortStat>
}

const Ports = ({ p4tg_infos }: { p4tg_infos: P4TGInfos }) => {
    const [loaded, set_loaded] = useState(false)
    const [ports, set_ports] = useState([])
    const [config, set_config] = useState<P4TGConfig>({ tg_ports: [] })
    const [macInput, setMacInput] = useState<Record<string, string>>({})


    const loadPorts = async () => {
        let stats = await get({ route: "/ports" })
        let config = await get({ route: "/config" })

        if (stats?.status === 200) {
            set_ports(stats.data)
            set_config(config?.data)
            set_loaded(true)
        }
    }

    const updatePort = async (front_panel_port: number, speed: string, fec: string, auto_neg: string, channel_count: number | null, channel: number) => {
        let update = await post({
            route: "/ports", body: {
                front_panel_port: front_panel_port,
                speed: speed,
                fec: fec,
                auto_neg: auto_neg,
                channel_count: channel_count,
                channel: channel
            }
        })

        if (update?.status === 201) {
            refresh()
        }
    }

    const updateArp = async (
        front_panel_port: number,
        state: boolean,
        mac?: string,
        channel?: number
    ) => {
        let update = await post({
            route: "/ports/arp", body: {
                front_panel_port: front_panel_port,
                arp_reply: state,
                mac: mac,
                channel: channel,
            }
        })

        if (update.status === 201) {
            refresh()
        }
    }

    const toPortChannelKey = (port: number, channel: number) => `${port}/${channel}`

    const getMac = (port: number, channel: number) => {
        let mac = "Unknown"

        config.tg_ports.forEach(p => {
            if (p.port == port) {
                mac = p.channel_mac?.[channel.toString()] ?? p.mac
            }
        })

        return mac
    }

    const getChannelCount = (port: number): number | null => {
        let channel_count: number | null = null

        config.tg_ports.forEach(p => {
            if (p.port == port) {
                channel_count = p.channel_count ?? null
            }
        })

        return channel_count
    }

    const getActiveSpeeds = (port: number): string[] =>
        ports
            .filter((portInfo: any) => portInfo.port === port)
            .map((portInfo: any) => portInfo.speed)

    const getActiveChannels = (port: number): number[] =>
        ports
            .filter((portInfo: any) => portInfo.port === port)
            .map((portInfo: any) => portInfo.channel)
            .sort((a: number, b: number) => a - b)

    const hasMixedBreakoutRates = (port: number): boolean => {
        if (getChannelCount(port) == null) {
            return false
        }

        const speeds = new Set(getActiveSpeeds(port))
        return speeds.size > 1
    }

    const getBreakoutTooltip = (): string =>
        "Configure `channel_count` in config.json and restart the controller to split a port into 4 or 8 channels."

    const getMixedBreakoutWarningTooltip = (): string =>
        "Warning: Mixed breakout rates on a single front-panel port may link up but can cause packet loss under load. Prefer homogeneous breakout operation."

    const getTargetChannels = (speed: string, channelCount: number | null): number[] => {
        if (channelCount === 8) {
            return [0, 1, 2, 3, 4, 5, 6, 7]
        }

        if (channelCount === 4) {
            if (speed === SPEED.BF_SPEED_100G) {
                return [0, 2, 4, 6]
            }

            return [0, 1, 2, 3]
        }

        return [0]
    }

    const hasCompatibleRuntimeLayout = (port: number, speed: string, channelCount: number | null): boolean => {
        const currentChannels = getActiveChannels(port)
        const targetChannels = getTargetChannels(speed, channelCount)

        if (currentChannels.length === 0) {
            return true
        }

        return JSON.stringify(currentChannels) === JSON.stringify(targetChannels)
    }

    const isSpeedAllowed = (speed: string, channelCount: number | null): boolean => {
        if (channelCount === 8) {
            return (
                speed == SPEED.BF_SPEED_10G ||
                speed == SPEED.BF_SPEED_25G ||
                speed == SPEED.BF_SPEED_50G
            )
        }

        if (channelCount === 4) {
            if (speed == SPEED.BF_SPEED_10G || speed == SPEED.BF_SPEED_25G) {
                return true
            }

            return p4tg_infos.asic == ASIC.Tofino2 && speed == SPEED.BF_SPEED_100G
        }

        if (speed == SPEED.BF_SPEED_400G && p4tg_infos.asic != ASIC.Tofino2) {
            return false
        }

        return true
    }

    const getSpeedTooltip = (port: number, speed: string, channelCount: number | null): string => {
        if (!hasCompatibleRuntimeLayout(port, speed, channelCount)) {
            return "This speed cannot be applied at runtime because it requires a different channel layout. Update config.json and restart the controller."
        }

        if (channelCount === 8) {
            return "Only 10G, 25G, and 50G are available with channel_count 8."
        }

        if (channelCount === 4) {
            if (p4tg_infos.asic == ASIC.Tofino2) {
                return "Only 10G, 25G, and 100G are available with channel_count 4 on Tofino2."
            }

            return "Only 10G and 25G are available with channel_count 4 on Tofino1."
        }

        if (speed == SPEED.BF_SPEED_400G) {
            return "400G is only available on Tofino2."
        }

        return "This speed is not available for the current port mode."
    }

    const mustUseRsFec = (speed: string, channelCount: number | null): boolean =>
        speed == SPEED.BF_SPEED_400G ||
        (speed == SPEED.BF_SPEED_50G && channelCount !== 4) ||
        (channelCount === 4 && speed == SPEED.BF_SPEED_100G)

    const getArpReply = (port: number, channel: number) => {
        let reply = false

        config.tg_ports.forEach(p => {
            if (p.port == port) {
                reply = p.channel_arp_reply?.[channel.toString()] ?? p.arp_reply ?? false
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

    useEffect(() => {
        const values: Record<string, string> = {}
        ports.forEach((portInfo: any) => {
            const key = toPortChannelKey(portInfo.port, portInfo.channel)
            values[key] = getMac(portInfo.port, portInfo.channel)
        })
        setMacInput(values)
    }, [config, ports])


    return <Loader loaded={loaded}>
        <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
            <thead className={"table-dark"}>
                <tr>
                    <th>PID</th>
                    <th>Port/Channel</th>
                    <th>Breakout &nbsp; <InfoBox>
                        <p>In channelized mode, the port is split across multiple channels, e.g., 4x25G, 4x100G, or 8x50G. Configure `channel_count` in config.json and restart the controller.</p>
                    </InfoBox>
                    </th>
                    <th>Speed</th>
                    <th>Auto Negotiation</th>
                    <th>FEC</th>
                    <th>MAC &nbsp; <InfoBox>
                        <p>MAC address used for ARP replies (if enabled). It can be changed here at runtime; the value from config.json is used as default on startup.</p>
                    </InfoBox>
                    </th>
                    <th>ARP Reply &nbsp;
                        <InfoBox>
                            <p>If enabled, the port will answer all received ARP requests.</p></InfoBox>
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
                            <StyledCol className={"col-1 align-items-center"}>
                                {getChannelCount(v.port) != null
                                    ? <span>
                                        <OverlayTrigger
                                            placement="top"
                                            overlay={
                                                (props) => renderTooltip(props, getBreakoutTooltip())
                                            }
                                        >
                                            <span>{`${getChannelCount(v.port)}x`}</span>
                                        </OverlayTrigger>
                                        {hasMixedBreakoutRates(v.port) &&
                                            <OverlayTrigger
                                                placement="top"
                                                overlay={
                                                    (props) => renderTooltip(props, getMixedBreakoutWarningTooltip())
                                                }
                                            >
                                                <span className="ms-1 text-warning">
                                                    <i className="bi bi-exclamation-triangle-fill" />
                                                </span>
                                            </OverlayTrigger>
                                        }
                                    </span>
                                    : <i className="bi bi-dash" />
                                }
                            </StyledCol>
                            <StyledCol className={"col-1"}>
                                <Dropdown>
                                    <Dropdown.Toggle
                                        as="div"
                                        id={`speed-${v.pid}`}
                                        className="form-select text-start"
                                        style={{ cursor: "pointer" }}
                                    >
                                        {speed_mapping[v.speed]}
                                    </Dropdown.Toggle>

                                    <Dropdown.Menu className="w-100">
                                        {Object.keys(speed_mapping)
                                            .filter(f => {
                                                return true
                                            })
                                            .map(f => {
                                                const channelCount = getChannelCount(v.port)
                                                const disabled =
                                                    !isSpeedAllowed(f, channelCount) ||
                                                    !hasCompatibleRuntimeLayout(v.port, f, channelCount)
                                                const tooltip = getSpeedTooltip(v.port, f, channelCount)

                                                const handleClick = async () => {
                                                    if (disabled) return

                                                    let fec = v.fec

                                                    if (mustUseRsFec(f, channelCount)) {
                                                        fec = FEC.BF_FEC_TYP_REED_SOLOMON
                                                    }

                                                    // 10G & 40G do not allow RS
                                                    if (
                                                        (f == SPEED.BF_SPEED_10G || f == SPEED.BF_SPEED_40G) &&
                                                        v.fec == FEC.BF_FEC_TYP_REED_SOLOMON
                                                    ) {
                                                        fec = FEC.BF_FEC_TYP_NONE
                                                    }

                                                    // 100G does not allow FC
                                                    if (f == SPEED.BF_SPEED_100G && v.fec == FEC.BF_FEC_TYP_FC) {
                                                        fec = FEC.BF_FEC_TYP_NONE
                                                    }

                                                    await updatePort(
                                                        v.port,
                                                        f,
                                                        fec,
                                                        v.auto_neg,
                                                        getChannelCount(v.port),
                                                        v.channel
                                                    )
                                                }

                                                const item = (
                                                    <Dropdown.Item
                                                        as="button"
                                                        key={f}
                                                        eventKey={f}
                                                        active={f == v.speed}
                                                        disabled={disabled}
                                                        onClick={handleClick}
                                                        style={{
                                                            cursor: disabled ? "not-allowed" : "pointer",
                                                            opacity: disabled ? 0.4 : 1,
                                                        }}
                                                    >
                                                        {speed_mapping[f]}
                                                    </Dropdown.Item>
                                                )

                                                if (!disabled) return item

                                                // Disabled → wrap with tooltip
                                                return (
                                                    <OverlayTrigger
                                                        key={f}
                                                        placement="right"
                                                        overlay={props =>
                                                            renderTooltip(
                                                                props,
                                                                tooltip || "Configure `channel_count` in config.json and restart the controller."
                                                            )
                                                        }
                                                    >
                                                        <span className="d-inline-block">{item}</span>
                                                    </OverlayTrigger>
                                                )
                                            })}
                                    </Dropdown.Menu>
                                </Dropdown>


                            </StyledCol>
                            <StyledCol className={"col-1"}>
                                <Dropdown>
                                    <Dropdown.Toggle
                                        as="div"
                                        id={`autoneg-${v.pid}`}
                                        className="form-select text-start"
                                        style={{ cursor: "pointer" }}
                                    >
                                        {auto_neg_mapping[v.auto_neg]}
                                    </Dropdown.Toggle>

                                    <Dropdown.Menu className="w-100">
                                        {Object.keys(auto_neg_mapping).map(f => {
                                            const handleClick = async () => {
                                                await updatePort(
                                                    v.port,
                                                    v.speed,
                                                    v.fec,
                                                    f, // this is the new auto-neg value
                                                    getChannelCount(v.port),
                                                    v.channel
                                                )
                                            }

                                            return (
                                                <Dropdown.Item
                                                    as="button"
                                                    key={f}
                                                    eventKey={f}
                                                    active={f == v.auto_neg}
                                                    onClick={handleClick}
                                                >
                                                    {auto_neg_mapping[f]}
                                                </Dropdown.Item>
                                            )
                                        })}
                                    </Dropdown.Menu>
                                </Dropdown>

                            </StyledCol>
                            <StyledCol className={"col-1"}>
                                <Dropdown>
                                    <Dropdown.Toggle
                                        as="div"
                                        id={`fec-${v.pid}`}
                                        className="form-select text-start"
                                        style={{ cursor: "pointer" }}
                                    >
                                        {fec_mapping[v.fec]}
                                    </Dropdown.Toggle>

                                    <Dropdown.Menu className="w-100">
                                        {Object.keys(fec_mapping).map(f => {
                                            const channelCount = getChannelCount(v.port)

                                            // 400G, 8x50G and 4x100G breakout -> only RS allowed
                                            if (f != FEC.BF_FEC_TYP_REED_SOLOMON &&
                                                mustUseRsFec(v.speed, channelCount)) {
                                                return null
                                            }

                                            // 10G/40G → RS not allowed
                                            if (f == FEC.BF_FEC_TYP_REED_SOLOMON &&
                                                (v.speed == SPEED.BF_SPEED_10G || v.speed == SPEED.BF_SPEED_40G)) {
                                                return null
                                            }

                                            // 100G → FC not allowed
                                            if (f == FEC.BF_FEC_TYP_FC && v.speed == SPEED.BF_SPEED_100G) {
                                                return null
                                            }

                                            const handleClick = async () => {
                                                await updatePort(
                                                    v.port,
                                                    v.speed,
                                                    f, // <-- new fec value
                                                    v.auto_neg,
                                                    getChannelCount(v.port),
                                                    v.channel
                                                )
                                            }

                                            return (
                                                <Dropdown.Item
                                                    as="button"
                                                    key={f}
                                                    eventKey={f}
                                                    active={f == v.fec}
                                                    onClick={handleClick}
                                                >
                                                    {fec_mapping[f]}
                                                </Dropdown.Item>
                                            )
                                        })}
                                    </Dropdown.Menu>
                                </Dropdown>

                            </StyledCol>
                            <StyledCol className={"col-1"}>
                                <Form.Control
                                    size="sm"
                                    type="text"
                                    value={macInput[toPortChannelKey(v.port, v.channel)] ?? getMac(v.port, v.channel)}
                                    isInvalid={
                                        (macInput[toPortChannelKey(v.port, v.channel)] ?? getMac(v.port, v.channel)).length > 0 &&
                                        !validateMAC((macInput[toPortChannelKey(v.port, v.channel)] ?? getMac(v.port, v.channel)).trim())
                                    }
                                    onChange={(event: any) => {
                                        const value = event.target.value
                                        setMacInput(prev => ({ ...prev, [toPortChannelKey(v.port, v.channel)]: value }))
                                    }}
                                    onBlur={async () => {
                                        const current = (macInput[toPortChannelKey(v.port, v.channel)] ?? getMac(v.port, v.channel)).trim()
                                        const configured = getMac(v.port, v.channel).trim()

                                        if (current == configured || !validateMAC(current)) {
                                            return
                                        }

                                        await updateArp(
                                            v.port,
                                            getArpReply(v.port, v.channel),
                                            current,
                                            v.channel
                                        )
                                    }}
                                    onKeyDown={async (event: any) => {
                                        if (event.key != "Enter") {
                                            return
                                        }

                                        const current = (macInput[toPortChannelKey(v.port, v.channel)] ?? getMac(v.port, v.channel)).trim()
                                        const configured = getMac(v.port, v.channel).trim()

                                        if (current == configured || !validateMAC(current)) {
                                            return
                                        }

                                        await updateArp(
                                            v.port,
                                            getArpReply(v.port, v.channel),
                                            current,
                                            v.channel
                                        )
                                    }}
                                />
                            </StyledCol>
                            <StyledCol className={"col-1"}>
                                <Form.Check
                                    checked={getArpReply(v.port, v.channel)}
                                    onChange={async (event: any) => {
                                        const mac = (macInput[toPortChannelKey(v.port, v.channel)] ?? getMac(v.port, v.channel)).trim()
                                        await updateArp(
                                            v["port"],
                                            event.target.checked,
                                            validateMAC(mac) ? mac : getMac(v.port, v.channel),
                                            v.channel
                                        )
                                    }}
                                    type={"switch"}
                                >
                                </Form.Check>
                            </StyledCol>
                            <StyledCol className={"col-1"}><PortStatus active={v['status']} /></StyledCol>
                        </tr>
                    }
                })
                }
            </tbody>
        </Table>

        <Row>
            <Col>
                <Button onClick={refresh} className={"ml-3"}><i className="bi bi-arrow-clockwise" /> Refresh</Button>
            </Col>
        </Row>

        <GitHub />

    </Loader>
}

export default Ports
