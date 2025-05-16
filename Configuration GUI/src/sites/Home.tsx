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

import React, { useEffect, useState } from 'react'
import { Button, Col, Form, Nav, Row, Tab, Tabs } from 'react-bootstrap'
import { del, get, post } from "../common/API";
import SendReceiveMonitor from "../components/SendReceiveMonitor";
import Loader from "../components/Loader";

import {
    ASIC,
    GenerationMode,
    P4TGInfos,
    Statistics as StatInterface,
    StatisticsObject,
    Stream,
    StreamSettings,
    TimeStatistics,
    TimeStatisticsObject,
    TrafficGenData
} from '../common/Interfaces'
import styled from "styled-components";
import SummaryView from '../components/SummaryView';

styled(Row)`
    display: flex;
    align-items: center;
`;
styled(Col)`
    padding-left: 0;
`;
const StyledLink = styled.a`
    color: var(--color-text);
    text-decoration: none;
    opacity: 0.5;

    :hover {
        opacity: 1;
        color: var(--color-primary);
    }
`

const TestNumber = styled.span`
    margin-right: 10px;
    min-width: 140px;
    max-width: 140px;
    text-align: center;
    margin-bottom: 10px;
    background: var(--color-secondary);
    padding: 10px 5px 10px 5px;
    color: #FFF;
    border-radius: 10px;
    display: inline-block;
`

export const GitHub = () => {
    return <Row className="mt-2">
        <Col className="text-center col-12 mt-3">
            <StyledLink href="https://github.com/uni-tue-kn/P4TG" target="_blank">P4TG @ <i
                className="bi bi-github"></i></StyledLink>
        </Col>
    </Row>
}

const Home = ({ p4tg_infos }: { p4tg_infos: P4TGInfos }) => {
    const [loaded, set_loaded] = useState(false)
    const [overlay, set_overlay] = useState(false)
    const [running, set_running] = useState(false)
    const [visual, set_visual] = useState(true)

    // @ts-ignore
    const [streams, set_streams] = useState<Stream[]>(JSON.parse(localStorage.getItem("streams")) || [])
    // @ts-ignore
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(JSON.parse(localStorage.getItem("streamSettings")) || [])
    const [mode, set_mode] = useState(parseInt(localStorage.getItem("gen-mode") || String(GenerationMode.NONE)))
    const [duration, set_duration] = useState(parseInt(localStorage.getItem("duration") || String(0)))
    // @ts-ignore
    const [histogram_settings, set_histogram_settings] = useState<Record<string, RttHistogramConfig>>(JSON.parse(localStorage.getItem("histogram_config")) || {})

    const [savedConfigs, setSavedConfigs] = useState<Record<string, TrafficGenData>>(
        JSON.parse(localStorage.getItem("saved_configs") || '{}') as Record<string, TrafficGenData>
    );
    const [activeTab, setActiveTab] = useState(running ? "current" : Object.keys(savedConfigs)[0]);


    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<{ [name: number]: number }>(JSON.parse(localStorage.getItem("port_tx_rx_mapping")) || {})
    const [statistics, set_statistics] = useState<StatInterface>(StatisticsObject)
    const [time_statistics, set_time_statistics] = useState<TimeStatistics>(TimeStatisticsObject)

    const NumTests = ({ running }: { running: boolean }) => {
        const total_tests = Object.keys(savedConfigs).length;
        const num_avail_stats = Math.min(Object.keys(statistics.previous_statistics || {}).length + 1, total_tests);

        return (
            <TestNumber>
                {running && num_avail_stats !== total_tests ? (
                    <span
                        className="spinner-border spinner-border-sm"
                        role="status"
                        aria-hidden="true"
                        style={{
                            verticalAlign: 'middle',
                            animationDuration: '0.5s' // Make spinner slower
                        }}
                    />
                ) : !running && num_avail_stats !== total_tests ? (
                    <i className="bi bi-pause-circle-fill" />
                ) : (
                    <i className="bi bi-check-circle-fill" />
                )} &nbsp;
                Test {num_avail_stats} / {total_tests}
            </TestNumber>
        );
    }

    useEffect(() => {
        const refresh = async () => {
            await loadGen()
            await loadStatistics()
            set_loaded(true)
        }

        refresh()

        const interval_stats = setInterval(async () => await Promise.all([loadStatistics()]), 500);
        const interval_loadgen = setInterval(async () => await Promise.all([loadGen()]), 5000);
        const inverval_timestats = setInterval(async () => await Promise.all([loadTimeStatistics()]), 2000);

        return () => {
            clearInterval(interval_stats)
            clearInterval(interval_loadgen)
            clearInterval(inverval_timestats)
        }

    }, [])

    useEffect(() => {
        // Only hide overlay if it was shown for starting a test (mode 0 means "starting")
        console.log(mode)
        if (running && overlay && mode !== 0) {
            set_overlay(false);
        }
    }, [mode]);

    // Update activeTab when `running` changes
    useEffect(() => {
        // Either switch to the first tab, or stay at the active tab if its not the "Running" one 
        setActiveTab(running ? "current" : activeTab === "current" ? Object.keys(savedConfigs)[0] : activeTab);
    }, [running]);

    const serializeSavedConfigs = () => {
        if (Object.keys(savedConfigs).length === 1) {
            // If there is only one config, return it as an object
            // This triggers the singleTest behaviour in the backend
            return Object.values(savedConfigs)[0];
        } else {
            // Set the name of each config to the key
            // and return an array of objects
            // with the name and the config
            return Object.entries(savedConfigs).map(([key, config]) => {
                return { ...config, name: key };
            });
        }
    }

    const onSubmit = async (event: any) => {
        event.preventDefault()

        let max_rate = 100;

        if (p4tg_infos.asic === ASIC.Tofino2) {
            max_rate = 400;
        }

        set_overlay(true)

        if (running) {
            await del({ route: "/trafficgen" })
            set_running(false)
            set_overlay(false)
        } else {
            for (const [name, config] of Object.entries(savedConfigs)) {
                let overall_rate = 0
                config.streams.forEach((v) => {
                    if (config.stream_settings.some((setting) => v.stream_id == setting.stream_id && setting.active)) {
                        overall_rate += v.traffic_rate
                    }
                })
                if (config.mode !== GenerationMode.MPPS && overall_rate > max_rate) {
                    alert("Sum of stream rates > " + max_rate + " Gbps for test " + name + "!")
                    set_overlay(false)
                    return;
                }
                if (config.streams.length === 0 && config.mode !== GenerationMode.ANALYZE) {
                    alert("You need to define at least one traffic configuration for " + name + ".");
                    set_overlay(false)
                    return;
                }
                if (!config.stream_settings.some(s => s.active) && config.mode !== GenerationMode.ANALYZE) {
                    alert("You need to have at least one active stream setting for " + name + ".");
                    set_overlay(false);
                    return;
                }
            }

            // Delete all previous statistics in local state
            set_statistics(StatisticsObject)
            set_time_statistics(TimeStatisticsObject)
            // Reset the mode to 0 to detect when traffic generation actually starts
            set_mode(0)

            await post({
                route: "/trafficgen",
                body: serializeSavedConfigs()
            });

            set_running(true)

            // Overlay will be hidden in the loadGen function
            // This is because the POST does immediately return if a list of tests is given
        }
    }

    const loadStatistics = async () => {
        let stats = await get({ route: "/statistics" })

        if (stats !== undefined && stats.status === 200) {
            set_statistics(stats.data)
        }
    }

    const loadTimeStatistics = async () => {
        let stats = await get({ route: "/time_statistics?limit=100" })

        if (stats !== undefined && stats.status === 200) {
            set_time_statistics(stats.data)
        }
    }


    const loadGen = async () => {
        let stats = await get({ route: "/trafficgen" })

        if (stats !== undefined && Object.keys(stats.data).length > 1) {
            set_mode(stats.data.mode)
            set_duration(stats.data.duration)
            set_port_tx_rx_mapping(stats.data.port_tx_rx_mapping)
            set_stream_settings(stats.data.stream_settings)
            set_streams(stats.data.streams)
            set_histogram_settings(stats.data.histogram_config)

            localStorage.setItem("streams", JSON.stringify(stats.data.streams))
            localStorage.setItem("gen-mode", String(stats.data.mode))
            localStorage.setItem("duration", String(stats.data.duration))
            localStorage.setItem("streamSettings", JSON.stringify(stats.data.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(stats.data.port_tx_rx_mapping))
            localStorage.setItem("histogram_config", JSON.stringify(stats.data.histogram_config))

            set_running(true)
        } else {
            set_running(false)
        }
    }


    const reset = async () => {
        set_overlay(true)
        await get({ route: "/reset" })
        set_overlay(false)
    }

    const skip = async () => {
        set_overlay(true)
        await del({ route: "/trafficgen?skip=true" })
        set_overlay(false)
    }

    const restart = async () => {
        set_overlay(true)
        await get({ route: "/restart" })
        set_overlay(false)
    }

    return <Loader loaded={loaded} overlay={overlay}>
        <form onSubmit={onSubmit}>
            <Row className={"mb-3"}>
                <SendReceiveMonitor stats={statistics} running={running} />
                <Col className={"text-end col-4"}>
                    {savedConfigs && Object.keys(savedConfigs).length > 0 &&
                        <>
                            {running &&
                                <Button onClick={skip} className="mb-1" variant="warning"><i
                                    className="bi bi-skip-forward-fill" /> Skip </Button>
                            }
                            {" "}
                            <NumTests running={running} />

                        </>
                    }
                    {running ?
                        <>
                            <Button type={"submit"} className="mb-1" variant="danger"><i
                                className="bi bi-stop-fill" /> Stop</Button>
                            {" "}
                            <Button onClick={restart} className="mb-1" variant="primary"><i
                                className="bi bi-arrow-clockwise" /> Restart </Button>
                        </>
                        :
                        <>
                            <Button type={"submit"} className="mb-1" variant="primary"><i
                                className="bi bi-play-circle-fill" /> Start </Button>
                            {" "}
                            <Button onClick={reset} className="mb-1" variant="warning"><i
                                className="bi bi-trash-fill" /> Reset </Button>
                        </>
                    }
                </Col>

            </Row>
        </form>

        <Form>
            <Form.Check
                type="switch"
                id="custom-switch"
                checked={visual}
                onClick={() => set_visual(!visual)}
                label="Visualization"
            />
        </Form>

        {statistics.previous_statistics && Object.keys(statistics.previous_statistics).length > 0 ? (
            (() => {
                const savedConfigKeys = Object.keys(savedConfigs);

                return (
                    <Tab.Container activeKey={activeTab} onSelect={(key) => key && setActiveTab(key)}>
                        <Nav variant="tabs" className="mt-3">

                            {running &&
                                <Nav.Item key={"current"}>
                                    <Nav.Link eventKey={"current"}>Running</Nav.Link>
                                </Nav.Item>
                            }
                            {savedConfigKeys.map((name) => (
                                <Nav.Item key={name}>
                                    <Nav.Link eventKey={name}>{name}</Nav.Link>
                                </Nav.Item>
                            ))}
                        </Nav>

                        <Tab.Content className="mt-3">
                            {running &&
                                <Tab.Pane eventKey="current" key="current">
                                    <SummaryView
                                        statistics={statistics}
                                        time_statistics={time_statistics}
                                        port_tx_rx_mapping={port_tx_rx_mapping}
                                        visual={visual}
                                        mode={mode}
                                        stream_settings={stream_settings}
                                        streams={streams}
                                    />
                                </Tab.Pane>
                            }

                            {savedConfigKeys.map((name) => {
                                /// Find the statistics for the current test identified by the name field
                                const statData = Object.values(statistics.previous_statistics || {}).find(
                                    (stat: any) => stat.name === name
                                ) ?? StatisticsObject;
                                const timeStatsData = Object.values(time_statistics.previous_statistics || {}).find(
                                    (stat: any) => stat.name === name
                                ) ?? TimeStatisticsObject;
                                const config = savedConfigs[name];

                                return (
                                    <Tab.Pane eventKey={name} key={name}>
                                        <>
                                            <SummaryView
                                                statistics={statData}
                                                time_statistics={timeStatsData}
                                                port_tx_rx_mapping={config.port_tx_rx_mapping}
                                                visual={visual}
                                                mode={config.mode}
                                                stream_settings={config.stream_settings}
                                                streams={config.streams}
                                            />
                                        </>
                                    </Tab.Pane>
                                );
                            })}
                        </Tab.Content>
                    </Tab.Container>
                );
            })()
        ) : (
            // OLD VIEW here — no previous_statistics present. Rendered when only a single test is applied.
            <>
                <SummaryView
                    statistics={statistics}
                    time_statistics={time_statistics}
                    port_tx_rx_mapping={port_tx_rx_mapping}
                    visual={visual}
                    mode={mode}
                    stream_settings={stream_settings}
                    streams={streams}
                />
            </>

        )}
        <GitHub />


    </Loader>
}

export default Home