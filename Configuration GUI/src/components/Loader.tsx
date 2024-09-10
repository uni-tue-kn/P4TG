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
import styled from "styled-components";
import { Spinner } from "react-bootstrap";

import P4TGLogo from "../assets/p4tg_logo.png";

interface WrapperProps {
  center?: boolean;
}

const Wrapper = styled.div<WrapperProps>`
  display: flex;
  flex-grow: 1;
  flex-direction: column;

  ${(props) =>
    props.center ? "justify-content: center; align-items:center;" : ""}
`;

const LoadWrapper = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  flex-grow: 1;
  font-size: 2em;
  color: var(--color-primary);
  text-align: center;
  height: 100%;
`;

const LoadWrapperAbsolute = styled.div`
  position: absolute;
  top: 0;
  justify-content: center;
  align-items: center;
  flex-grow: 1;
  font-size: 2em;
  color: var(--color-primary);
  text-align: center;
  height: 100%;
  background: var(--color-loader-overlay);
  width: 100%;
  z-index: 1;
  overflow-x: hidden;
`;

const StyledSpinner = styled(Spinner)`
  height: 50px;
  width: 50px;
  margin-bottom: 10px;
`;

const SpinnerWrapper = styled.div`
  margin-top: calc(50vh - 150px);
`;

const ContentWrapper = styled.div`
  position: relative;
`;

const StyledImg = styled.img`
  width: 150px;
`;

interface Props {
  children: React.ReactNode;
  loaded?: boolean;
  overlay?: boolean;
  center?: boolean;
}

export default ({
  children,
  loaded = true,
  overlay = false,
  center = false,
}: Props) => {
  return (
    <ContentWrapper>
      {loaded ? (
        children
      ) : (
        <LoadWrapper>
          <SpinnerWrapper>
            <StyledSpinner animation="border" />

            <p>
              <StyledImg src={P4TGLogo} alt="P4TG Logo" />
            </p>
          </SpinnerWrapper>
        </LoadWrapper>
      )}
      {overlay ? (
        <LoadWrapperAbsolute>
          <SpinnerWrapper>
            <StyledSpinner animation="border" />

            <p>
              <StyledImg src={P4TGLogo} alt="P4TG Logo" />
            </p>
          </SpinnerWrapper>
        </LoadWrapperAbsolute>
      ) : null}
    </ContentWrapper>
  );
};
