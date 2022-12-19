import React, {useState} from 'react'
import Config from "./config"
import {BrowserRouter as Router, Link, Route, Routes} from "react-router-dom"
import {Col, Container, Row} from "react-bootstrap"
import {AxiosInterceptor} from "./common/API"
import styled from "styled-components"
import ErrorView from "./components/ErrorView"
import Navbar, {NavLink} from "./components/Navbar"

import Home from "./sites/Home"
import Setup from "./sites/Setup";
import Ports from "./sites/Ports";
import Settings from "./sites/Settings";

import {
    CBadge,
    CNavGroup,
    CNavItem,
    CNavTitle,
    CSidebar,
    CSidebarBrand,
    CSidebarNav,
    CSidebarToggler
} from "@coreui/react";
import Tables from "./sites/Tables";

const App = () => {
    const [error, set_error] = useState(false)
    const [message, set_message] = useState("")
    const [time, set_time] = useState("00:00")

    const setError = (msg: string) => {
        set_error(true)
        set_message(msg)

        let now = new Date()

        set_time(now.getHours() + ":" + now.getMinutes())
    }

    const Wrapper = styled.div`

    `
    return <>

        {localStorage.getItem("server") == null ?
            <Container fluid={"lg"} className={"pb-2"}>
                <Setup/>
            </Container>
            :
            <Router basename={Config.BASE_PATH}>
                <Row>
                    <Col className={'col-2 d-flex'}>
                        <Navbar />
                    </Col>
                    <Col className={"col-10 p-5"}>
                        <ErrorView error={error} message={message} time={time} close={() => set_error(false)}/>
                        <AxiosInterceptor onError={setError}>
                            <Container fluid className={"pb-2"}>
                                <Wrapper>
                                    {//<h2>P4TG: 100 Gbps traffic generation for Ethernet/IP networks</h2>
                                      //  <Navbar/>
                                    }

                                    <Routes>
                                        <Route path={""} element={<Home/>}/>
                                        <Route path={"/home"} element={<Home/>}/>
                                        <Route path={"/ports"} element={<Ports/>}/>
                                        <Route path={"/tables"} element={<Tables />} />
                                        <Route path={"/settings"} element={<Settings/>}/>
                                    </Routes>
                                </Wrapper>
                            </Container>
                        </AxiosInterceptor>
                    </Col>
                </Row>
            </Router>
        }


    </>


}

export default App;
