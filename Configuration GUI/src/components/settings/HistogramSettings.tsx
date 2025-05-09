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

import { RttHistogramConfig } from "../../common/Interfaces";
import React, { useState } from "react";
import { StyledCol } from "../../sites/Settings";
import HistogramModal from "./HistogramModal";

const HistogramSettings = ({
    port,
    mapping,
    disabled,
    data,
}: {
    port: { pid: number, port: number, channel: number, loopback: string, status: boolean }
    mapping: { [name: number]: number },
    disabled: boolean
    data: Record<string, RttHistogramConfig>
}) => {
    const [show, set_show] = useState(false)

    const rx_pid = mapping[port.pid]


    return <>
        <HistogramModal disabled={disabled} data={data[String(rx_pid)]} show={show} pid={rx_pid} hide={() => set_show(false)} />
        <StyledCol className="justify-content-center align-items-center">
            <button
                type="button"
                className="btn btn-config border-0 p-0"
                onClick={() => set_show(true)}
                disabled={rx_pid===undefined}
                aria-label="Configure Histogram"
            >
                <i className="bi bi-bar-chart-line-fill" />
            </button>
        </StyledCol>

    </>
}

export default HistogramSettings
