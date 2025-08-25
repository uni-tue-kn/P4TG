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

import React, { useEffect } from 'react'
import styled from 'styled-components'
import { Row } from "react-bootstrap";
import { get } from "../common/API";
import { ASIC } from '../common/Interfaces';

const StyledIcon = styled.i`
    font-size: 100px;
    margin-top: calc(30vh);
`


const Offline = ({ setP4TGInfos }: { setP4TGInfos: (arg0: any) => void }) => {
    useEffect(() => {
        const loadStatus = async () => {
            let stats = await get({ route: "/online" })

            if (stats != undefined && stats.status !== 200) {
                return
            }

            if (stats !== undefined && stats.status === 200) {
                setP4TGInfos(stats.data)
            } else {
                setP4TGInfos({ status: "", version: "", asic: ASIC.Tofino1, loopback: false })
            }
        }

        const interval = setInterval(loadStatus, 2000)

        return () => {
            clearInterval(interval)
        }

    }, [])

    return <Row className={"text-center"}>
        <StyledIcon className="bi bi-wifi-off" />
        <p>P4TG device not reachable</p>
    </Row>
}

export default Offline