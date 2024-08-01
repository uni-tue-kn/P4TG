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

import {Stream, StreamSettings} from "../../common/Interfaces";
import React, {useState} from "react";
import SettingsModal from "./SettingsModal";
import {Form} from "react-bootstrap";
import {StyledCol} from "../../sites/Settings";

const StreamSettingsElement = ({
                                   running,
                                   port_status,
                                   stream,
                                   stream_data
                               }: { running: boolean, port_status: boolean, stream: StreamSettings, stream_data: Stream }) => {
    const [show, set_show] = useState(false)

    // Needed to update the view immediately
    const [isActive, setIsActive] = useState(stream.active);

    return <>
        <SettingsModal running={running || !port_status} data={stream} stream={stream_data} show={show} hide={() => set_show(false)}/>
        <StyledCol>
            <Form.Check
                className={"d-inline"}
                disabled={!isActive && (running || !port_status)}
                defaultChecked={isActive}
                type={"switch"}
                onChange={(event) => {
                    setIsActive(!isActive);
                    stream.active = !stream.active
                }
                }
            />

            <i role={"button"}
               onClick={() => set_show(true)}
               className="bi bi-gear-wide-connected ms-3"/>
        </StyledCol>

    </>
}

export default StreamSettingsElement