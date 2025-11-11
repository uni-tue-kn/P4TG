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

import { useEffect, useState } from 'react'
import Config from "./config"
import { BrowserRouter as Router, Route, Routes } from "react-router-dom"
import { Button, Col, Container, Modal, Row } from "react-bootstrap"
import { AxiosInterceptor, get } from "./common/API"
import styled from "styled-components"
import Navbar from "./components/Navbar"
import ToastMessage from "./components/ToastMessage"

import Home from "./sites/Home"
import Ports from "./sites/Ports";
import Settings from "./sites/Settings";
import Offline from "./sites/Offline"
import Tables from "./sites/Tables";
import { ASIC, P4TGInfos, StreamSettings, ToastVariant } from "./common/Interfaces";
import { Stream } from "./common/Interfaces";
import Loader from "./components/Loader";
import { validateStreams, validateStreamSettings } from "./common/Validators";
import { isUpdateAvailable } from './common/Helper'

const App = () => {
    const [online, set_online] = useState(true)
    const [loaded, set_loaded] = useState(false)
    const [p4tg_infos, set_p4tg_infos] = useState<P4TGInfos>({ status: "", version: "", asic: ASIC.Tofino1, loopback: false })
    const [toast, setToast] = useState({ time: "00:00", show: false, message: "", bg: "success" })
    const [updateAvailable, setUpdateAvailable] = useState(false)
    const [showUpdateModal, setShowUpdateModal] = useState(false)

    useEffect(() => {
        // Validates the stored streams and stream settings in the local storage
        // Clears local storage if some streams/settings are not valid
        // This may be needed if the UI got an update (new stream properties), but the local storage
        // holds "old" streams/settings without the new property
        const validateLocalStorage = () => {
            try {
                let stored_streams: Stream[] = JSON.parse(localStorage.getItem("streams") ?? "[]")
                let stored_settings: StreamSettings[] = JSON.parse(localStorage.getItem("streamSettings") ?? "[]")

                if (!validateStreams(stored_streams) || !validateStreamSettings(stored_settings)) {
                    showToast("Incompatible stream description found. This may be due to an update. Resetting local storage.", "danger")
                    localStorage.clear()
                    window.location.reload()
                    return
                }
            }
            catch {
                showToast("Error in reading local storage. Resetting local storage.", "danger")
                localStorage.clear()
                window.location.reload()
            }
        }

        const loadInfos = async () => {
            let stats = await get({ route: "/online" })

            if (stats !== undefined && stats.status === 200) {
                set_p4tg_infos(stats.data)
                const update = await isUpdateAvailable(stats.data.version)
                setUpdateAvailable(update)
            }

            set_loaded(true)
        }

        validateLocalStorage()
        loadInfos()
    }, [])

    useEffect(() => {
        if (updateAvailable) {
            setShowUpdateModal(true)
        }
    }, [updateAvailable])


    const showToast = (message: string, bg: ToastVariant) => {
        let now = new Date();
        let time = now.getHours() + ":" + now.getMinutes();
        setToast({ time: time, show: true, message, bg })
    }

    const Wrapper = styled.div``

    const ASICVersion = styled.div`
      margin-right: 10px;
      margin-bottom: 10px;
      background: var(--color-primary);
      padding: 5px 25px 5px 25px;
      color: #FFF;
      border-radius: 10px;
      text-align: center;
      display: inline-block;
    `

    return <Loader loaded={loaded}>
        <Router basename={Config.BASE_PATH}>
            <Row>
                <Col className={'col-2 col-sm-2 col-xl-1 fixed-navbar'}>
                    <Navbar p4tg_infos={p4tg_infos} updateAvailable={updateAvailable} />
                </Col>
                <Col className={"col-10 col-sm-10 col-xl-11 offset-xl-1 offset-2 offset-sm-2 p-3"}>
                    <AxiosInterceptor onError={showToast} onOffline={() => set_online(false)}
                        onOnline={() => set_online(true)}>
                        <Container fluid className={"pb-2"}>
                            <Wrapper>
                                <ASICVersion>{p4tg_infos.asic}</ASICVersion>
                                {online ?
                                    <>
                                        <Routes>
                                            <Route path={""} element={<Home p4tg_infos={p4tg_infos} showToast={showToast} />} />
                                            <Route path={"/"} element={<Home p4tg_infos={p4tg_infos} showToast={showToast} />} />
                                            <Route path={"/home"} element={<Home p4tg_infos={p4tg_infos} showToast={showToast} />} />
                                            <Route path={"/ports"} element={<Ports p4tg_infos={p4tg_infos} />} />
                                            <Route path={"/tables"} element={<Tables />} />
                                            <Route path={"/settings"} element={<Settings p4tg_infos={p4tg_infos} showToast={showToast} />} />
                                        </Routes>
                                        <ToastMessage
                                            time={toast.time}
                                            show={toast.show}
                                            message={toast.message}
                                            bg={toast.bg as ToastVariant}
                                        />
                                    </>
                                    :
                                    <Offline setP4TGInfos={set_p4tg_infos} />
                                }
                            </Wrapper>

                        </Container>
                    </AxiosInterceptor>
                </Col>
            </Row>

        </Router>

        <Modal show={showUpdateModal} onHide={() => setShowUpdateModal(false)} centered>
            <Modal.Header closeButton>
                <Modal.Title>Update available</Modal.Title>
            </Modal.Header>
            <Modal.Body>
                A new P4TG release is available. Visit the releases page to download the latest version.
            </Modal.Body>
            <Modal.Footer>
                <Button variant="secondary" onClick={() => setShowUpdateModal(false)}>
                    Dismiss
                </Button>
                <Button variant="primary" href="https://github.com/uni-tue-kn/P4TG/releases" target="_blank" rel="noreferrer">
                    Open releases
                </Button>
            </Modal.Footer>
        </Modal>

    </Loader>
}

export default App;
