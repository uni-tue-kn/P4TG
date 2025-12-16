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

import React from 'react'

import styled from "styled-components";
import { OverlayTrigger, Tooltip } from "react-bootstrap";
import { StatisticsEntry } from "../common/Interfaces";
import { formatFrameCount } from "../common/Helper";

const StatusIndicator = styled.span<{ error: boolean }>`
    background: ${props => (props.error ? 'var(--color-primary)' : 'var(--color-okay)')};
    padding: 10px 15px 10px 15px;
    border-radius: 10px;
    display: inline-block;
    color: #FFF;
    margin-right: 10px;
`

const hasError = (stats: StatisticsEntry) => {
    const loss = getLostPackets(stats);

    return loss > 0;
};

const getLostPackets = (stats: StatisticsEntry) => (
    "packet_loss" in stats
        ? Object.values(stats.packet_loss).reduce(
            (acc, perCh) => acc + Object.values(perCh).reduce((s, v) => s + (v ?? 0), 0),
            0
        )
        : 0
);

const renderTooltip = (props: any, message: string) => (
    <Tooltip id="tooltip-status" {...props}>
        {message}
    </Tooltip>
);

const Status = ({ stats, running }: { stats: StatisticsEntry, running: boolean }) => {
    const lostFrames = getLostPackets(stats);
    const error = hasError(stats);
    const hasLoss = lostFrames > 0;

    const statusText = error
        ? (hasLoss ? `Status: Error. Lost ${formatFrameCount(lostFrames)} frames.` : "Status: Error")
        : "Status: Ok";

    return (
        <StatusIndicator error={error}>
            {hasLoss ? (
                <OverlayTrigger
                    placement="top"
                    overlay={(props) => renderTooltip(props, `${lostFrames}`)}
                >
                    <span>{statusText}</span>
                </OverlayTrigger>
            ) : (
                statusText
            )}
        </StatusIndicator>
    );
}

export default Status
