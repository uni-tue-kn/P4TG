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