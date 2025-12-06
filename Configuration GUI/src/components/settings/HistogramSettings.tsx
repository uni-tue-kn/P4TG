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

import { HistogramConfigMap, PortInfo, PortTxRxMap, HistogramConfig } from "../../common/Interfaces";
import React, { useState } from "react";
import { StyledCol } from "../../sites/Settings";
import HistogramModal from "./HistogramModal";

const HistogramSettings = ({
    port,
    mapping,
    disabled,
    rtt_data,
    iat_data,
    set_rtt_data,
    set_iat_data
}: {
    port: PortInfo,
    mapping: PortTxRxMap,
    disabled: boolean,
    rtt_data: HistogramConfigMap,
    iat_data: HistogramConfigMap,
    set_rtt_data: (pid: number, channel: number, updated: HistogramConfig) => void
    set_iat_data: (pid: number, channel: number, updated: HistogramConfig) => void
}) => {
    const [show, set_show] = useState(false)

    const rx_pid = mapping?.[String(port.port)]?.[String(port.channel)]?.port;
    const rx_channel = mapping?.[String(port.port)]?.[String(port.channel)]?.channel;

    const rtt_cfg = rtt_data?.[String(rx_pid)]?.[String(rx_channel)];
    const iat_cfg = iat_data?.[String(rx_pid)]?.[String(rx_channel)];

    return <>
        {rx_pid !== undefined && rx_channel !== undefined && (
            <>
                <HistogramModal
                    disabled={disabled}
                    rtt_data={rtt_cfg}
                    iat_data={iat_cfg}
                    show={show}
                    pid={rx_pid}
                    channel={rx_channel}
                    hide={() => set_show(false)}
                    set_iat_data={set_iat_data}
                    set_rtt_data={set_rtt_data}
                />
            </>
        )}
        <StyledCol className="justify-content-center align-items-center">
            <button
                type="button"
                className="btn btn-config border-0 p-0"
                onClick={() => set_show(true)}
                disabled={rx_pid === undefined}
                aria-label="Configure Histogram"
            >
                <i className="bi bi-bar-chart-line-fill" />
            </button>
        </StyledCol>
    </>
}

export default HistogramSettings
