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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import { HistogramConfig, HistogramConfigMap, P4TGInfos, PortInfo, RxMappingMode, RxTarget, Stream, StreamSettings } from "../../common/Interfaces";
import React, { useEffect, useState } from "react";
import SettingsModal from "./SettingsModal";
import { Form, OverlayTrigger, Tooltip } from "react-bootstrap";
import { StyledCol } from "../../sites/Settings";
import HistogramSettings from "./HistogramSettings";

const StreamSettingsElement = ({
    running,
    port_status,
    stream,
    stream_data,
    p4tg_infos,
    ports,
    rx_mapping_mode,
    onActiveChange,
    onRxTargetChange,
    rtt_histogram_settings,
    iat_histogram_settings,
    set_rtt_histogram_settings,
    set_iat_histogram_settings,
}: {
    running: boolean,
    port_status: boolean,
    stream: StreamSettings,
    stream_data: Stream,
    p4tg_infos: P4TGInfos,
    ports: PortInfo[],
    rx_mapping_mode: RxMappingMode,
    onActiveChange: (active: boolean) => void,
    onRxTargetChange: (target: RxTarget | undefined) => void,
    rtt_histogram_settings: HistogramConfigMap,
    iat_histogram_settings: HistogramConfigMap,
    set_rtt_histogram_settings: (pid: number, channel: number, updated: HistogramConfig) => void,
    set_iat_histogram_settings: (pid: number, channel: number, updated: HistogramConfig) => void,
}) => {
    const [show, set_show] = useState(false)

    // Needed to update the view immediately
    const [isActive, setIsActive] = useState(stream.active);

    useEffect(() => {
        setIsActive(stream.active);
    }, [stream.active, stream.stream_id, stream.port, stream.channel]);

    return <>
        <SettingsModal running={running || !port_status} data={stream} stream={stream_data} show={show} hide={() => set_show(false)} p4tg_infos={p4tg_infos} />
        <StyledCol>
            <div className="d-inline-flex align-items-center">
                <Form.Check
                    className={"d-inline"}
                    disabled={running || !isActive && (running || !port_status)}
                    checked={isActive}
                    type={"switch"}
                    onChange={(event) => {
                        setIsActive(event.target.checked);
                        onActiveChange(event.target.checked)
                    }}
                />

                {rx_mapping_mode === RxMappingMode.PerStream ?
                    <>
                        <Form.Select
                            className="d-inline-block ms-2"
                            style={{ width: "auto", minWidth: 130 }}
                            size="sm"
                            aria-label={`RX target for stream ${stream_data.app_id}`}
                            disabled={running || !port_status || !isActive}
                            isInvalid={isActive && !stream.rx_target}
                            value={stream.rx_target ? `${stream.rx_target.port}/${stream.rx_target.channel}` : ""}
                            onChange={(event) => {
                                if (!event.target.value) {
                                    onRxTargetChange(undefined);
                                    return;
                                }
                                const [port, channel] = event.target.value.split("/").map(Number);
                                onRxTargetChange({ port, channel });
                            }}
                        >
                            <option value="">Select RX</option>
                            {ports.map((port) =>
                                <option key={port.pid} value={`${port.port}/${port.channel}`}>
                                    {port.port}/{port.channel} ({port.pid})
                                </option>
                            )}
                        </Form.Select>
                        <span className="d-inline-block ms-2">
                            <HistogramSettings
                                compact
                                target={stream.rx_target}
                                disabled={running || !port_status || !isActive}
                                rtt_data={rtt_histogram_settings}
                                iat_data={iat_histogram_settings}
                                set_rtt_data={set_rtt_histogram_settings}
                                set_iat_data={set_iat_histogram_settings}
                            />
                        </span>
                    </>
                    : null}

                <OverlayTrigger
                    placement="top"
                    overlay={<Tooltip id="tooltip-stream-settings">Stream settings</Tooltip>}
                >
                    <button
                        type="button"
                        onClick={() => set_show(true)}
                        className="btn btn-config border-0 p-0 ms-3"
                        aria-label="Stream settings"
                    >
                        <i className="bi bi-gear-wide-connected" />
                    </button>
                </OverlayTrigger>
            </div>
        </StyledCol>

    </>
}

export default StreamSettingsElement
