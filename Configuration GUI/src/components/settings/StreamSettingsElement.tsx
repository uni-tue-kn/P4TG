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

import { Stream, StreamSettings } from "../../common/Interfaces";
import { useEffect, useState } from "react";
import SettingsModal from "./SettingsModal";
import { Form } from "react-bootstrap";
import { StyledCol } from "../../sites/Settings";

const StreamSettingsElement = ({
  running,
  port_status,
  stream,
  stream_data,
  onActivateStream,
}: {
  running: boolean;
  port_status: boolean;
  stream: StreamSettings;
  stream_data: Stream;
  onActivateStream: (stream_id: number, active: boolean) => void;
}) => {
  const [show, set_show] = useState(false);

  // Needed to update the view immediately
  const [isActive, setIsActive] = useState(stream.active);

  useEffect(() => {
    setIsActive(stream.active);
  }, [stream.active]);

  return (
    <>
      <SettingsModal
        running={running || !port_status}
        data={stream}
        stream={stream_data}
        show={show}
        hide={() => set_show(false)}
      />
      <StyledCol>
        <Form.Check
          className={"d-inline"}
          disabled={!isActive && (running || !port_status)}
          // checked needed instead of defaultChecked to correctly display the switch for multiple tests.
          checked={isActive}
          type={"switch"}
          onChange={() => {
            const newActive = !isActive;
            setIsActive(newActive);
            stream.active = newActive;
            onActivateStream(stream.stream_id, newActive);
          }}
        />

        <i
          role={"button"}
          onClick={() => set_show(true)}
          className="bi bi-gear-wide-connected ms-3"
        />
      </StyledCol>
    </>
  );
};

export default StreamSettingsElement;
