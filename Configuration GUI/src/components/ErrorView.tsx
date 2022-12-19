import React, {useState} from 'react'

import {Toast, ToastContainer} from "react-bootstrap";

import styled from 'styled-components'

const StyledToastContainer = styled(ToastContainer)`
  margin-top: 20px;
  margin-right:20px;
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