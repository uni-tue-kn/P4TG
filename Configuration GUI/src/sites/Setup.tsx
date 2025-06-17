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

import React, { useState } from 'react'
import styled from 'styled-components'
import { Button, Container, Form } from "react-bootstrap";
import { GitHub } from "./Home"

import P4TGLogo from "../assets/p4tg_logo_white.png"

const StyledImg = styled.img`
    width: 150px;
`

const StyledContainer = styled(Container)`
  background: linear-gradient(180deg, var(--color-secondary) 40%, 40%, #FFF 10%);
  max-width: 400px;
  border-radius: 10px;
  padding: 20px;
  padding-top: 15px;
  box-shadow: rgba(0, 0, 0, 0.1) 0px 4px 12px;
  border: 1px solid #e8e8e8;

  input {
    border: 1px solid var(--color-primary);
  }
`

const Wrapper = styled.div`
  min-height: 100vh;
  width: 100%;
  display: flex;
  align-items: center;
`

const Setup = () => {
    const [server, set_server] = useState("")
    const onSubmit = (event: any) => {
        event.preventDefault()
        localStorage.setItem("server", server)
        window.location.reload();
    }
    return <>
        <Wrapper>
            <StyledContainer>
                <h3 className={"mb-4 text-center"}><StyledImg src={P4TGLogo} alt="P4TG log" /></h3>
                <form onSubmit={onSubmit}>
                    <Form.Control
                        required
                        onChange={(event) => set_server(event.target.value)}
                        type={"text"}
                        className={"mb-3"}
                        placeholder="https://mycontroller.net"
                    />
                    <Button className="col-12" type={"submit"} variant="danger">Connect</Button>
                </form>
                <GitHub />
            </StyledContainer>
        </Wrapper>

    </>


}

export default Setup