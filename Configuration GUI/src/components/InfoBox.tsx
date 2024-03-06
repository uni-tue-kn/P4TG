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

import React, {useState} from "react"
import {Button, Modal} from "react-bootstrap";
import styled from "styled-components";

interface Info {
    children: JSX.Element
}

const Wrapper = styled.div`
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    height: 100%;
`


const InfoBox = ({children}: Info) => {
    const [display, set_display] = useState(false)
    return <Wrapper>
        <Modal aria-labelledby="contained-modal-title-vcenter"
               centered show={display} onHide={() => {
            set_display(false)
        }}>
            <Modal.Header closeButton>
                <Modal.Title>Info</Modal.Title>
            </Modal.Header>
            <Modal.Body>{children}</Modal.Body>
            <Modal.Footer>
                <Button variant="primary" onClick={() => {
                    set_display(false)
                }}>
                    Close
                </Button>
            </Modal.Footer>
        </Modal>
        <i onClick={() => {
            set_display(true)
        }} role="button" className="bi bi-question-circle-fill"/>
    </Wrapper>
}

export default InfoBox