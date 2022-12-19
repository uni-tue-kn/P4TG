import React, {useState} from 'react'
import styled from 'styled-components'
import {Button, Container, Form} from "react-bootstrap";

const StyledContainer = styled(Container)`
  background: #FFF;
  max-width: 400px;
  border-radius: 10px;
  padding: 20px;
  box-shadow: rgba(0, 0, 0, 0.1) 0px 4px 12px;
  border: 1px solid #e8e8e8;
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
    return <Wrapper>
        <StyledContainer>
            <h3 className={"mb-4"}><i className="bi bi-ethernet"/> P4TG: Configuration</h3>
            <form onSubmit={onSubmit}>
                <Form.Control
                    required
                    onChange={(event) => set_server(event.target.value)}
                    type={"text"}
                    className={"mb-3"}
                    placeholder="https://mycontroller.net"
                />
                <Button className="col-12" type={"submit"} variant="primary">Connect</Button>
            </form>
        </StyledContainer>
    </Wrapper>
}

export default Setup