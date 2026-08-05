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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import React, { useEffect, useState } from 'react'
import { Button, Col, Form, Nav, Row, Tab } from 'react-bootstrap'
import { del, get, post } from "../common/API";
import SendReceiveMonitor from "../components/SendReceiveMonitor";
import Loader from "../components/Loader";
import P4tgReportExportModal from "../components/P4tgReportExportModal";

import {
    ASIC,
    GenerationMode,
    P4TGInfos,
    Statistics,
    StatisticsObject,
    Stream,
    StreamSettings,
    TimeStatistics,
    TimeStatisticsObject,
    ToastVariant,
    TrafficGenData,
    HistogramConfig
    , RxMappingMode
} from '../common/Interfaces'
import styled from "styled-components";
import SummaryView from '../components/SummaryView';
import { loadFromStorage } from '../common/Helper';
import { startPolling } from '../common/Polling';

const RUN_NAME_SUFFIX = /\s*\[\d+\/\d+\]$/;
const baseConfigName = (name: string) => name.replace(RUN_NAME_SUFFIX, "");

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
    min-width: 180px;
    max-width: 180px;
    text-align: center;
    margin-bottom: 10px;
    background: var(--color-secondary);
    padding: 10px 5px 10px 5px;
    color: #FFF;
    border-radius: 10px;
    display: inline-block;
`

const Rfc2544StatusLabel = styled.div`
    font-size: 0.75rem;
    font-weight: 700;
    letter-spacing: 0.02em;
    margin-bottom: 0.15rem;
    text-transform: uppercase;
`

const Rfc2544StatusText = styled.div`
    display: inline-block;
    overflow-wrap: anywhere;
    white-space: normal;
`

const Rfc2544StatusMeta = styled.div`
    font-size: 0.85rem;
    margin-top: 0.25rem;
    opacity: 0.85;
`

const Rfc2544StatusBar = styled.div<{ $attention: boolean }>`
    align-items: flex-start;
    background: ${props => props.$attention ? 'var(--color-mna-warning-bg)' : 'var(--color-background)'};
    border: 1px solid ${props => props.$attention ? 'var(--color-mna-warning-border)' : 'var(--color-secondary)'};
    border-left-width: 4px;
    border-radius: 6px;
    color: ${props => props.$attention ? 'var(--color-mna-warning-text)' : 'var(--color-text)'};
    display: flex;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    min-height: 38px;
    padding: 0.65rem 0.9rem;
    width: 100%;
`

export const GitHub = () => {
    return <Row className="mt-2">
        <Col className="text-center col-12 mt-3">
            <StyledLink href="https://github.com/uni-tue-kn/P4TG" target="_blank">P4TG @ <i
                className="bi bi-github"></i></StyledLink>
        </Col>
    </Row>
}

const Home = ({ p4tg_infos, showToast }: { p4tg_infos: P4TGInfos, showToast: (msg: string, bg: ToastVariant) => void }) => {
    const [loaded, set_loaded] = useState(false)
    const [overlay, set_overlay] = useState(false)
    const [running, set_running] = useState(false)
    const [cooldown, set_cooldown] = useState(false)
    const [visual, set_visual] = useState(true)
    const [rfc2544_runtime_countdown, set_rfc2544_runtime_countdown] = useState<number | null>(null)

    const [streams, set_streams] = useState<Stream[]>(loadFromStorage<Stream[]>("streams", []))
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(loadFromStorage<StreamSettings[]>("streamSettings", []))
    const [mode, set_mode] = useState(parseInt(localStorage.getItem("gen-mode") || String(GenerationMode.NONE)))
    const [rx_mapping_mode, set_rx_mapping_mode] = useState<RxMappingMode>(
        loadFromStorage<RxMappingMode>("rx_mapping_mode", RxMappingMode.PerTxPort)
    )
    const [duration, set_duration] = useState(parseInt(localStorage.getItem("duration") || String(0)))
    const [rtt_histogram_settings, set_rtt_histogram_settings] = useState<Record<string, HistogramConfig>>(loadFromStorage<Record<string, HistogramConfig>>("rtt_histogram_config", {}))
    const [iat_histogram_settings, set_iat_histogram_settings] = useState<Record<string, HistogramConfig>>(loadFromStorage<Record<string, HistogramConfig>>("iat_histogram_config", {}))

    const [savedConfigs, setSavedConfigs] = useState<Record<string, TrafficGenData>>(() => {
        const configs = loadFromStorage<Record<string, TrafficGenData>>("saved_configs", {});
        const filteredConfigs = Object.fromEntries(
            Object.entries(configs).filter(([name, config]) =>
                !RUN_NAME_SUFFIX.test(name)
                && !(config.mode === GenerationMode.RFC2544 && /^RFC2544 \d+B$/.test(name))
            )
        ) as Record<string, TrafficGenData>;

        if (Object.keys(filteredConfigs).length !== Object.keys(configs).length) {
            localStorage.setItem("saved_configs", JSON.stringify(filteredConfigs));
        }

        return filteredConfigs;
    });
    const [activeTab, setActiveTab] = useState(running ? "current" : Object.keys(savedConfigs)[0]);


    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<PortTxRxMap>(
        () => loadFromStorage("port_tx_rx_mapping", {})
    );
    const [statistics, set_statistics] = useState<Statistics>([StatisticsObject])
    const [time_statistics, set_time_statistics] = useState<TimeStatistics>([TimeStatisticsObject])
    const resultStatistics = running
        ? statistics.slice(1)
        : [...statistics.slice(1), statistics[0]];
    const resultNames = Array.from(new Set(
        resultStatistics
            .map(entry => entry?.name)
            .filter((name): name is string => Boolean(name))
    ));
    const totalPlannedRuns = Object.values(savedConfigs).reduce(
        (total, config) => total + (
            config.mode === GenerationMode.RFC2544 ? 1 : Math.max(1, config.repetitions ?? 1)
        ),
        0
    );

    const NumTests = ({ running }: { running: boolean }) => {
        const num_avail_stats = Math.min(Object.keys(statistics || {}).length, totalPlannedRuns);

        return (
            <TestNumber>
                {cooldown ? (
                    <i className="bi bi-pause-circle-fill" />
                ) : running ? (
                    <span
                        className="spinner-border spinner-border-sm"
                        role="status"
                        aria-hidden="true"
                        style={{
                            verticalAlign: 'middle',
                            animationDuration: '0.5s'
                        }}
                    />
                ) : !running && (num_avail_stats !== totalPlannedRuns) ? (
                    <i className="bi bi-pause-circle-fill" />
                ) : !running && num_avail_stats === totalPlannedRuns ? (
                    <i className="bi bi-check-circle-fill" />
                )
                    : null}
                &nbsp;
                {cooldown ? "Cooldown · " : null}
                Run {num_avail_stats} / {totalPlannedRuns}
            </TestNumber>
        );
    }

    useEffect(() => {
        const refresh = async () => {
            await loadGen()
            await loadStatistics()
            set_loaded(true)
        }

        let disposed = false;
        let stopStatisticsPolling = () => { };
        let stopLoadGenPolling = () => { };
        let stopTimeStatisticsPolling = () => { };

        const initialize = async () => {
            await refresh();
            if (!disposed) {
                stopStatisticsPolling = startPolling(loadStatistics, 500);
                // The between-run cooldown is short, so poll often enough for
                // its explicit paused state to remain visible in the UI.
                stopLoadGenPolling = startPolling(loadGen, 500);
                stopTimeStatisticsPolling = startPolling(loadTimeStatistics, 2000);
            }
        };
        void initialize();

        return () => {
            disposed = true;
            stopStatisticsPolling()
            stopLoadGenPolling()
            stopTimeStatisticsPolling()
        }

    }, [])

    useEffect(() => {
        // Only hide overlay if it was shown for starting a test (mode 0 means "starting")
        // Only apply this logic if there are multiple tests
        if (Object.keys(savedConfigs).length > 1 && running && overlay && mode !== 0) {
            set_overlay(false);
        }
    }, [mode]);

    // Keep the live tab selected while running and select the first returned
    // result when orchestration finishes.
    useEffect(() => {
        if (running) {
            setActiveTab("current");
        } else if (!resultNames.includes(activeTab)) {
            setActiveTab(resultNames[0] ?? Object.keys(savedConfigs)[0]);
        }
    }, [running, resultNames.join("\u0000")]);

    useEffect(() => {
        const rfc = statistics?.[0]?.rfc2544;
        if (!rfc) {
            set_rfc2544_runtime_countdown(null);
            return;
        }
        set_rfc2544_runtime_countdown(rfc.estimated_remaining_runtime_secs);
    }, [statistics?.[0]?.rfc2544?.estimated_remaining_runtime_secs]);

    useEffect(() => {
        const interval = setInterval(() => {
            set_rfc2544_runtime_countdown((prev) => {
                if (prev === null || prev <= 0 || !statistics?.[0]?.rfc2544?.running) {
                    return prev;
                }
                return prev - 1;
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [statistics?.[0]?.rfc2544?.running]);

    const serializeSavedConfigs = () => {
        const withRfc2544ThroughputDependencies = (config: TrafficGenData): TrafficGenData => {
            const rfc2544 = config.rfc2544;
            if (config.mode !== GenerationMode.RFC2544 || !rfc2544 || !(rfc2544.latency || rfc2544.reset || rfc2544.system_recovery)) {
                return config;
            }

            return {
                ...config,
                rfc2544: {
                    ...rfc2544,
                    throughput: true,
                },
            };
        };
        const withActiveStreamSettingsOnly = (config: TrafficGenData) => ({
            ...withRfc2544ThroughputDependencies(config),
            stream_settings: config.stream_settings.filter((setting) => setting.active),
        });
        if (Object.keys(savedConfigs).length === 1) {
            // If there is only one config, return it as an object
            // This triggers the singleTest behaviour in the backend
            const [name, config] = Object.entries(savedConfigs)[0];
            return { ...withActiveStreamSettingsOnly(config), name };
        } else {
            // Set the name of each config to the key
            // and return an array of objects
            // with the name and the config
            return Object.entries(savedConfigs).map(([key, config]) => {
                return { ...withActiveStreamSettingsOnly(config), name: key };
            });
        }
    }

    const onSubmit = async (event: any) => {
        event.preventDefault()

        const maxRate = p4tg_infos.asic === ASIC.Tofino1 ? 100 : 400;

        set_overlay(true)

        if (running) {
            await del({ route: "/trafficgen" })
            set_cooldown(false)
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
                if (config.mode === GenerationMode.RFC2544) {
                    const rfc2544 = config.rfc2544;
                    if (!rfc2544) {
                        showToast("RFC2544 settings missing for test " + name + ".", "danger")
                        set_overlay(false)
                        return;
                    }
                    if (!rfc2544.throughput && !rfc2544.latency && !rfc2544.frame_loss && !rfc2544.reset && !rfc2544.system_recovery) {
                        showToast("Select at least one RFC2544 test for " + name + ".", "danger")
                        set_overlay(false)
                        return;
                    }
                    if (rfc2544.frame_sizes.length === 0) {
                        showToast("Select at least one RFC2544 frame size for " + name + ".", "danger")
                        set_overlay(false)
                        return;
                    }
                    if (rfc2544.line_rate_gbps > maxRate) {
                        showToast("RFC2544 line rate > " + maxRate + " Gbit/s for test " + name + "!", "danger")
                        set_overlay(false)
                        return;
                    }
                } else {
                    if (!Number.isInteger(config.repetitions) || config.repetitions < 1) {
                        showToast("Repetitions must be at least 1 for test " + name + ".", "danger")
                        set_overlay(false)
                        return;
                    }
                    if (config.repetitions > 1 && config.duration <= 0) {
                        showToast("Repeated test " + name + " requires a finite test duration.", "danger")
                        set_overlay(false)
                        return;
                    }
                    if (overall_rate > maxRate) {
                        showToast("Sum of active stream rates > " + maxRate + " Gbit/s for test " + name + "!", "danger")
                        set_overlay(false)
                        return;
                    }
                }
                if (config.streams.length === 0 && config.mode !== GenerationMode.ANALYZE) {
                    showToast("You need to define at least one traffic configuration for " + name + ".", "danger")
                    set_overlay(false)
                    return;
                }
                if (!config.stream_settings.some(s => s.active) && config.mode !== GenerationMode.ANALYZE) {
                    showToast("You need to have at least one active stream setting for " + name + ".", "danger")
                    set_overlay(false);
                    return;
                }
            }

            // Delete all previous statistics in local state
            set_statistics([StatisticsObject])
            set_time_statistics([TimeStatisticsObject])
            // Reset the mode to 0 to detect when traffic generation actually starts
            set_mode(0)

            const response = await post({
                route: "/trafficgen",
                body: serializeSavedConfigs()
            });

            // Failed requests resolve to undefined (handled by the axios
            // interceptor); don't show the running state for a rejected start.
            if (response?.status !== 200) {
                set_overlay(false)
                return;
            }

            set_cooldown(false)
            set_running(true)

            // For multiple tests, overlay will be hidden in the loadGen function
            // This is because the POST does immediately return if a list of tests is given.
            // For a single test, the overlay can be hidden here, as the POST call returns when traffic gen is configured
            if (Object.keys(savedConfigs).length == 1) {
                set_overlay(false)
            }
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
            set_rx_mapping_mode(stats.data.rx_mapping_mode ?? RxMappingMode.PerTxPort)
            set_duration(stats.data.duration)
            set_port_tx_rx_mapping(stats.data.port_tx_rx_mapping)
            set_stream_settings(stats.data.stream_settings)
            set_streams(stats.data.streams)
            set_rtt_histogram_settings(stats.data.rtt_histogram_config)
            set_iat_histogram_settings(stats.data.iat_histogram_config)
            set_cooldown(Boolean(stats.data.cooldown))

            localStorage.setItem("streams", JSON.stringify(stats.data.streams))
            localStorage.setItem("gen-mode", String(stats.data.mode))
            localStorage.setItem("rx_mapping_mode", JSON.stringify(stats.data.rx_mapping_mode ?? RxMappingMode.PerTxPort))
            localStorage.setItem("duration", String(stats.data.duration))
            localStorage.setItem("streamSettings", JSON.stringify(stats.data.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(stats.data.port_tx_rx_mapping))
            localStorage.setItem("rtt_histogram_config", JSON.stringify(stats.data.rtt_histogram_config))
            localStorage.setItem("iat_histogram_config", JSON.stringify(stats.data.iat_histogram_config))
            localStorage.setItem("rfc2544_config", JSON.stringify(stats.data.rfc2544 ?? {}))

            // This copies TrafficGenData from the GET response into localStorage and config.
            // It's needed to keep the state consistent if multiple tests were started directly via the REST API
            if (
                stats.data.name
                && stats.data.mode !== GenerationMode.RFC2544
                && !RUN_NAME_SUFFIX.test(stats.data.name)
            ) {
                setSavedConfigs(prev => {
                    const updatedConfigs = {
                        ...prev,
                        // @ts-ignore
                        [stats.data.name]: {
                            ...stats.data,
                            cooldown: undefined,
                        },
                    };
                    localStorage.setItem("saved_configs", JSON.stringify(updatedConfigs));
                    return updatedConfigs;
                });
            }

            set_running(true)
        } else {
            set_cooldown(false)
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

    const export_json = async () => {
        const [statisticsResponse, timeStatisticsResponse] = await Promise.all([
            get({ route: "/statistics" }),
            get({ route: "/time_statistics" }),
        ]);

        if (statisticsResponse?.status !== 200 || timeStatisticsResponse?.status !== 200) {
            showToast("JSON export failed.", "danger");
            return;
        }

        const exportData = {
            statistics: statisticsResponse.data,
            time_statistics: timeStatisticsResponse.data,
        };
        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
        const url = window.URL.createObjectURL(blob);
        const downloadAnchorNode = document.createElement('a');
        downloadAnchorNode.setAttribute("href", url);
        downloadAnchorNode.setAttribute("download", "p4tg_results.json");
        document.body.appendChild(downloadAnchorNode);
        downloadAnchorNode.click();
        downloadAnchorNode.remove();
        window.URL.revokeObjectURL(url);
    }

    const rfc2544Status = statistics?.[0]?.rfc2544;
    const hasReportData = Object.values(time_statistics || {}).some((entry) =>
        Boolean(entry?.tx_rate_l1 && Object.keys(entry.tx_rate_l1).length > 0)
        || Boolean(entry?.rx_rate_l1 && Object.keys(entry.rx_rate_l1).length > 0)
    ) || Object.values(statistics || {}).some((entry) =>
        Boolean(entry?.rfc2544)
        || Boolean(entry?.frame_size && Object.keys(entry.frame_size).length > 0)
        || Boolean(entry?.tx_rate_l1 && Object.keys(entry.tx_rate_l1).length > 0)
        || Boolean(entry?.rx_rate_l1 && Object.keys(entry.rx_rate_l1).length > 0)
        || Boolean(entry?.frame_type_data && Object.keys(entry.frame_type_data).length > 0)
        || Boolean(entry?.iats && Object.keys(entry.iats).length > 0)
        || Boolean(entry?.rtts && Object.keys(entry.rtts).length > 0)
        || Boolean(entry?.packet_loss && Object.keys(entry.packet_loss).length > 0)
        || Boolean(entry?.out_of_order && Object.keys(entry.out_of_order).length > 0)
    );
    const rfc2544StatusText = rfc2544Status?.status.toLowerCase() ?? "";
    const rfc2544StatusNeedsAttention = rfc2544Status?.running && rfc2544StatusText.includes("waiting for dut");
    const formatRuntime = (seconds: number) => {
        const rounded = Math.max(0, Math.ceil(seconds));
        const hours = Math.floor(rounded / 3600);
        const minutes = Math.floor((rounded % 3600) / 60);
        const secs = rounded % 60;
        if (hours > 0) {
            return `${hours}h ${minutes}m ${secs}s`;
        }
        if (minutes > 0) {
            return `${minutes}m ${secs}s`;
        }
        return `${secs}s`;
    };

    return <Loader loaded={loaded} overlay={overlay}>
        <form onSubmit={onSubmit}>
            <Row className={"mb-3"}>
                <SendReceiveMonitor stats={statistics[0]} running={running && !cooldown} />
                <Col className={"text-end col-4"}>
                    {savedConfigs && totalPlannedRuns > 1 &&
                        <>
                            {running && !cooldown &&
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
                            <Button onClick={restart} disabled={cooldown} className="mb-1" variant="primary"><i
                                className="bi bi-arrow-clockwise" /> Restart </Button>
                        </>
                        :
                        <>
                            {hasReportData ?
                                <Button onClick={export_json} className="mb-1" variant="dark"><i
                                    className="bi bi-file-earmark-arrow-down-fill" /> Export JSON </Button>
                                : null}
                            {" "}
                            {hasReportData ?
                                <>
                                    <P4tgReportExportModal showToast={showToast} />
                                    {" "}
                                </>
                                : null}
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

        {rfc2544Status ?
            <Row>
                <Col className="col-12">
                    <Rfc2544StatusBar
                        $attention={Boolean(rfc2544StatusNeedsAttention)}
                        role="status"
                        aria-live="polite"
                    >
                        <div className="pt-1">
                            {rfc2544Status.running ? <span className="spinner-border spinner-border-sm" /> : <i className="bi bi-info-circle-fill" />}
                        </div>
                        <div>
                            <Rfc2544StatusLabel>RFC2544 status</Rfc2544StatusLabel>
                            <Rfc2544StatusText>{rfc2544Status.status}</Rfc2544StatusText>
                            {rfc2544_runtime_countdown !== null ?
                                <Rfc2544StatusMeta>
                                    Estimated remaining runtime: {formatRuntime(rfc2544_runtime_countdown)}
                                </Rfc2544StatusMeta>
                                : null}
                        </div>
                    </Rfc2544StatusBar>
                </Col>
            </Row>
            : null}

        <Form>
            <Form.Check
                type="switch"
                id="custom-switch"
                checked={visual}
                onClick={() => set_visual(!visual)}
                label="Visualization"
            />
        </Form>

        {statistics && Object.keys(statistics).length > 1 ? (
            (() => {
                return (
                    <Tab.Container activeKey={activeTab} onSelect={(key) => key && setActiveTab(key)}>
                        <Nav variant="tabs" className="mt-3">

                            {running &&
                                <Nav.Item key={"current"}>
                                    <Nav.Link eventKey={"current"}>Running</Nav.Link>
                                </Nav.Item>
                            }
                            {resultNames.map((name) => (
                                <Nav.Item key={name}>
                                    <Nav.Link eventKey={name}>{name}</Nav.Link>
                                </Nav.Item>
                            ))}
                        </Nav>

                        <Tab.Content className="mt-3">
                            {running &&
                                <Tab.Pane eventKey="current" key="current">
                                    <SummaryView
                                        statistics={statistics[0]}
                                        time_statistics={time_statistics[0]}
                                        port_tx_rx_mapping={port_tx_rx_mapping}
                                        rx_mapping_mode={rx_mapping_mode}
                                        visual={visual}
                                        mode={mode}
                                        stream_settings={stream_settings}
                                        streams={streams}
                                    />
                                </Tab.Pane>
                            }

                            {resultNames.map((name) => {
                                const latestRunForName = <T extends { name?: string }>(entries: T[], runName: string): T | undefined => {
                                    if (entries[0]?.name === runName) {
                                        return entries[0];
                                    }
                                    return entries.slice(1).reverse().find((entry) => entry.name === runName);
                                };
                                const statData = latestRunForName(Object.values(statistics || {}), name) ?? StatisticsObject;
                                const timeStatsData = latestRunForName(Object.values(time_statistics || {}), name) ?? TimeStatisticsObject;
                                const config = savedConfigs[baseConfigName(name)] ?? savedConfigs[name];

                                if (!config) {
                                    return null;
                                }

                                return (
                                    <Tab.Pane eventKey={name} key={name}>
                                        <>
                                            <SummaryView
                                                statistics={statData}
                                                time_statistics={timeStatsData}
                                                port_tx_rx_mapping={config.port_tx_rx_mapping}
                                                rx_mapping_mode={config.rx_mapping_mode ?? RxMappingMode.PerTxPort}
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
                    statistics={statistics[0]}
                    time_statistics={time_statistics[0]}
                    port_tx_rx_mapping={port_tx_rx_mapping}
                    rx_mapping_mode={rx_mapping_mode}
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
