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
import StreamSettingsElement from "./StreamSettingsElement";
import React from "react";

const StreamSettingsList = ({stream_settings, streams, running, port}: {
    stream_settings: StreamSettings[],
    streams: Stream[],
    running: boolean,
    port: { pid: number, port: number, channel: number, loopback: string, status: boolean }
}) => {
    return <>
        {stream_settings.map((s: StreamSettings, i: number) => {
            let stream = null;

            streams.forEach((st: Stream) => {
                if (st.stream_id == s.stream_id) {
                    stream = st;
                }
            })

            if (stream == null) {
                console.log(s, streams)
            }
            if (s.port == port.pid && stream != null) {
                return <StreamSettingsElement key={i} running={running} port_status={port.status} stream_data={stream}
                                              stream={s}/>
            }

        })}
    </>
}

export default StreamSettingsList