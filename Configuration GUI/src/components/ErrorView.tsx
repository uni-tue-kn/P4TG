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

import {Toast, ToastContainer} from "react-bootstrap";

import styled from 'styled-components'

const StyledToastContainer = styled(ToastContainer)`
    margin-top: 20px;
    margin-right: 20px;
`

interface ErrorProps {
    error: boolean,
    time: string,
    message: string,
    close: () => void
}

const ErrorView = ({error, time, message, close}: ErrorProps) => {

    return <StyledToastContainer position={"top-end"}>
        <Toast show={error} onClose={close} delay={3000} autohide>
            <Toast.Header>
                <strong className="me-auto">Error</strong>
                <small>{time}</small>
            </Toast.Header>
            <Toast.Body>{message}</Toast.Body>
        </Toast>
    </StyledToastContainer>
}

export default ErrorView