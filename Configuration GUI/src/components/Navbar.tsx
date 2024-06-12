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

import React, {useEffect, useState} from 'react'
import styled from "styled-components";
import {Link, useLocation} from "react-router-dom";
import {get} from "../common/API";
import {CNavItem, CSidebar, CSidebarBrand, CSidebarNav} from "@coreui/react";
import {Row} from 'react-bootstrap'

import P4TGLogo from "../assets/p4tg_logo_white.png"
import config from "../config";
import {P4TGInfos} from "../common/Interfaces";
styled(Link) <{ active?: boolean }>`
    text-decoration: none;
    margin-right: 15px;
    color: var(--cui-nav-link-color);
    padding: 10px;
    width: 100%;

    :hover {
        background: #5c636a;
    }
`;
const StyledImg = styled.img`
    width: 80px;
`


interface Props {
    to: string,
    icon?: string
    text?: string,
    overlay?: boolean
}

const StatusIndicator = styled.span<{ online?: boolean }>`
    color: ${props => (props.online ? 'green' : 'red')};
`

const Status = ({online}: { online?: boolean }) => {
    return <StatusIndicator online={online}>{online ? 'online' : 'offline'}</StatusIndicator>
}

export const NavLink = ({to, icon, text, overlay}: Props) => {
    const location = useLocation()

    return <CNavItem>
        <Link to={to} className={`nav-link ${location.pathname == to ? 'active' : ''}`}>
            <i className={icon}/> {text}
        </Link>
    </CNavItem>
}


const Navbar = ({p4tg_infos}: {p4tg_infos: P4TGInfos}) => {
    const [online, set_online] = useState(false)

    const setup = () => {
        localStorage.clear()
        window.location.reload()
    }


    useEffect(() => {
        const loadStatus = async () => {
            let stats = await get({route: "/online"})

            if (stats != undefined && stats.status !== 200) {
                return
            }

            set_online(true)
        }

        loadStatus()


    }, [])

    return <CSidebar className={"h-100"}>
        <CSidebarNav className="h-100">
            <CSidebarBrand className="mb-0"><StyledImg src={P4TGLogo} alt="P4TG log"/></CSidebarBrand>
            <NavLink to={"/"} text={""} icon={"bi bi-speedometer"}/>
            <NavLink to={"/ports"} text={""} icon={"bi bi-ethernet"}/>
            <NavLink to={"/tables"} text={""} icon={"bi bi-table"}/>
            <NavLink to={"/settings"} text={""} icon={"bi bi-gear-wide-connected"}/>
            <Row className="flex-grow-1">
            </Row>
            <Row>
                <CNavItem className="flex-grow-1 mb-2">
                    <span>v{p4tg_infos.version}</span>
                </CNavItem>
            </Row>
        </CSidebarNav>
    </CSidebar>
}

export default Navbar