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
import {Statistics} from "../common/Interfaces";

const StatusIndicator = styled.span<{ error: boolean }>`
    background: ${props => (props.error ? 'var(--color-primary)' : 'var(--color-okay)')};
    padding: 10px 15px 10px 15px;
    border-radius: 10px;
    display: inline-block;
    color: #FFF;
    margin-right: 10px;
`

const hasError = (stats: Statistics) => {
    let loss = 0

    if ("packet_loss" in stats) {
        loss = Object.values(stats.packet_loss).reduce((a, b) => a + b, 0)
    }

    return loss > 0
}
const Status = ({stats, running}: { stats: Statistics, running: boolean }) => {

    return <StatusIndicator error={hasError(stats)}>{hasError(stats) ? "Status: Error" : "Status: Ok"}</StatusIndicator>
}

export default Status