import React from "react";
import styled from "styled-components"
import {Spinner} from "react-bootstrap";

interface WrapperProps {
    center?: boolean
}

const Wrapper = styled.div<WrapperProps>`
    display: flex;
    flex-grow: 1;
    flex-direction: column;
  
    ${props => props.center ? "justify-content: center; align-items:center;" : ""}
`

const LoadWrapper = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-grow: 1;
  font-size: 2em;
`

const StyledSpinner = styled(Spinner)`
      margin-top: 50px;
`

interface Props {
    children: React.ReactNode,
    loaded?: boolean
    center?: boolean
}

export default ({children, loaded = true, center = false}: Props) => {
    return <>{loaded ?
        children
        :
        <LoadWrapper>
            <StyledSpinner animation="border" />
        </LoadWrapper>
    }
    </>
}