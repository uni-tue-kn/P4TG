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
import {CNavItem, CNavTitle, CSidebar, CSidebarBrand, CSidebarNav} from "@coreui/react";

const StyledLink = styled(Link)<{ active?: boolean }>`
  text-decoration: none;
  margin-right: 15px;
  color: var(--cui-nav-link-color);
  padding: 10px;
  width: 100%;

  :hover {
    background: #5c636a;
  }
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

    // return <>
    //     {overlay ?
    //         <OverlayTrigger
    //             key={"bottom"}
    //             placement={"bottom"}
    //             overlay={
    //                 <Tooltip id={`tooltip-bottom`}>
    //                     {text}
    //                 </Tooltip>
    //             }
    //         >
    //             <StyledLink active={location.pathname == to} to={to}>{icon ? <i className={icon}/> : null}</StyledLink>
    //         </OverlayTrigger>
    //         :
    //         <StyledLink active={location.pathname == to} to={to}>{icon ? <i className={icon}/> : null} {text ? text : null}</StyledLink>
    //     }
    // </>
}


const Navbar = () => {
    const [online, set_online] = useState(false)

    const setup = () => {
        localStorage.clear()
        window.location.reload()
    }


    useEffect(() => {
        const loadStatus = async () => {
            let stats = await get({route: "/online"})

            if (stats.status !== 200) {
                return
            }

            set_online(true)
        }

        loadStatus()


    }, [])

    return <CSidebar className={"h-100"} position={"fixed"}>
        <CSidebarBrand><i className="bi bi-ethernet me-2"/>P4TG</CSidebarBrand>
        <CSidebarNav>
            <NavLink to={"/home"} text={"Dashboard"} icon={"bi bi-speedometer me-2"}/>
            <CNavTitle>Settings</CNavTitle>
            <NavLink to={"/ports"} text={"Ports"} icon={"bi bi-ethernet me-2"}/>
            <NavLink to={"/tables"} text={"Tables"} icon={"bi bi-table me-2"}/>
            <NavLink to={"/settings"} text={"Traffic Gen"} icon={"bi bi-sliders2-vertical me-2"}/>
            <CNavItem className={"fixed-bottom col-2"}>
                <a href={"#"} onClick={() => setup()} className={"nav-link"}>
                    <i className="bi bi-box-arrow-left me-2"></i> Logout</a>
            </CNavItem>
        </CSidebarNav>
    </CSidebar>
}

export default Navbar