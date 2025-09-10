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

import React, { useEffect, useRef, useState } from 'react'
import { Button, Col, Form, Nav, Row, Tab, Table } from "react-bootstrap";
import { get } from "../common/API";
import Loader from "../components/Loader";
import {
    ASIC,
    DefaultMPLSHeader,
    DefaultStream,
    DefaultStreamSettings,
    Encapsulation,
    GenerationMode, HistogramConfigMap, P4TGInfos,
    PortInfo,
    PortTxRxMap,
    RttHistogramConfig,
    Stream,
    StreamSettings, ToastVariant, TrafficGenData,
} from "../common/Interfaces";
import styled from "styled-components";
import InfoBox from "../components/InfoBox";

import { GitHub } from "./Home";
import StreamSettingsList from "../components/settings/StreamSettingsList";
import StreamElement from "../components/settings/StreamElement";
import { validatePorts, validateStreams, validateStreamSettings } from "../common/Validators";
import HistogramSettings from '../components/settings/HistogramSettings';

export const StyledRow = styled.tr`
    display: flex;
    align-items: center;
`

export const StyledCol = styled.td`
    vertical-align: middle;
    display: table-cell;
    text-indent: 5px;
`

const CONFIG_STORAGE_KEY = "saved_configs";
const DEFAULT_CONFIG_NAME = "Test 1";


const Settings = ({ p4tg_infos, showToast }: { p4tg_infos: P4TGInfos, showToast: (msg: string, bg: ToastVariant) => void }) => {
    const [ports, set_ports] = useState<PortInfo[]>([])
    const [running, set_running] = useState(false)
    // @ts-ignore
    const [streams, set_streams] = useState<Stream[]>(JSON.parse(localStorage.getItem("streams")) || [])
    // @ts-ignore
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(JSON.parse(localStorage.getItem("streamSettings")) || [])
    // @ts-ignore
    const [histogram_settings, set_histogram_settings] = useState<HistogramConfigMap>(JSON.parse(localStorage.getItem("histogram_config")) || {})

    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<PortTxRxMap>(JSON.parse(localStorage.getItem("port_tx_rx_mapping")) || {})

    const [mode, set_mode] = useState(parseInt(localStorage.getItem("gen-mode") || String(GenerationMode.NONE)))
    const [duration, set_duration] = useState(parseInt(localStorage.getItem("duration") || String(0)))
    const [loaded, set_loaded] = useState(false)
    const ref = useRef()

    const [savedConfigs, setSavedConfigs] = useState<Record<string, TrafficGenData>>({});
    const [activeConfigName, setActiveConfigName] = useState<string>(DEFAULT_CONFIG_NAME);

    const [renamingTab, setRenamingTab] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState<string>("");

    const loadPorts = async () => {
        let stats = await get({ route: "/ports" })

        if (stats?.status === 200) {
            set_ports(stats.data)
        }
    }

    const refresh = async () => {
        set_loaded(false)
        await loadPorts()
        await loadGen()
        set_loaded(true)
    }

    const loadGen = async () => {

        let stats = await get({ route: "/trafficgen" })
        if (stats !== undefined) {
            if (Object.keys(stats.data).length > 1) {
                let old_streams = JSON.stringify(streams)

                if (old_streams != JSON.stringify(stats.data.streams)) {
                    set_mode(stats.data.mode)
                    set_duration(stats.data.duration)
                    set_port_tx_rx_mapping(stats.data.port_tx_rx_mapping)
                    set_stream_settings(stats.data.stream_settings)
                    set_streams(stats.data.streams)
                    set_histogram_settings(stats.data.histogram_config)

                    localStorage.setItem("streams", JSON.stringify(stats.data.streams))
                    localStorage.setItem("gen-mode", stats.data.mode)
                    localStorage.setItem("duration", stats.data.duration)
                    localStorage.setItem("streamSettings", JSON.stringify(stats.data.stream_settings))
                    localStorage.setItem("port_tx_rx_mapping", JSON.stringify(stats.data.port_tx_rx_mapping))
                    localStorage.setItem("histogram_config", JSON.stringify(stats.data.histogram_config))
                }
                set_running(true)
            } else {
                set_running(false)
            }
        }
    }

    useEffect(() => {
        refresh()

        const interval = setInterval(loadGen, 2000);

        return () => {
            clearInterval(interval)
        }
    }, [streams])

    useEffect(() => {
        let configs = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "{}");

        // If no configs, create default one
        if (Object.keys(configs).length === 0) {
            const defaultConfig: TrafficGenData = {
                mode: GenerationMode.NONE,
                duration: 0,
                streams: [],
                stream_settings: [],
                port_tx_rx_mapping: {},
                histogram_config: {}
            };
            configs = { [DEFAULT_CONFIG_NAME]: defaultConfig };
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configs));
        }

        setSavedConfigs(configs);

        // Load first available config or fallback
        const names = Object.keys(configs);
        if (names.length > 0) {
            setActiveConfigName(names[0]);
            loadConfigToState(configs[names[0]]);
        }
    }, []);

    useEffect(() => {
        if (activeConfigName && savedConfigs[activeConfigName]) {
            loadConfigToState(savedConfigs[activeConfigName]);
        }
    }, [activeConfigName, savedConfigs]);


    const loadConfigToState = (config: TrafficGenData) => {
        set_streams(config.streams || []);
        set_stream_settings(config.stream_settings || []);

        set_mode(config.mode ?? GenerationMode.NONE);
        set_duration(config.duration ?? 0);
        set_port_tx_rx_mapping(config.port_tx_rx_mapping || {});
        set_histogram_settings(config.histogram_config ?? {});
    };

    const deleteConfig = (name: string) => {
        const updated = { ...savedConfigs };
        delete updated[name];
        setSavedConfigs(updated);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));

        if (activeConfigName === name) {
            const first = Object.keys(updated)[0];
            if (first) {
                setActiveConfigName(first);
                loadConfigToState(updated[first]);
            } else {
                set_streams([]);
                set_stream_settings([]);
                set_mode(GenerationMode.NONE);
                set_duration(0);
                set_port_tx_rx_mapping({});
                set_histogram_settings({});
            }
        }
    };


    const save = (do_alert: boolean = false) => {

        // Iterate histogram settings and remove any entry which key (port) is not a value in port_tx_rx_mapping
        // Build allowed (port/channel) set from mapping values
        const allowed = new Set(
            Object.values(port_tx_rx_mapping ?? {}).flatMap(perCh =>
                Object.values(perCh ?? {}).map((t: any) => `${t.port}/${t.channel}`)
            )
        );

        // Filter histogram_settings: keep only allowed (port,channel) pairs
        const filteredHistogramSettings: HistogramConfigMap = {};
        for (const [rxPort, perCh] of Object.entries(histogram_settings ?? {})) {
            for (const [rxCh, cfg] of Object.entries(perCh ?? {})) {
                if (allowed.has(`${rxPort}/${rxCh}`)) {
                    (filteredHistogramSettings[rxPort] ??= {})[rxCh] = cfg;
                }
            }
        }

        localStorage.setItem("streams", JSON.stringify(streams))
        localStorage.setItem("gen-mode", String(mode))
        localStorage.setItem("duration", String(duration))
        localStorage.setItem("streamSettings", JSON.stringify(stream_settings))
        localStorage.setItem("histogram_config", JSON.stringify(filteredHistogramSettings))
        localStorage.setItem("port_tx_rx_mapping", JSON.stringify(port_tx_rx_mapping))

        const newConfig: TrafficGenData = {
            streams: streams,
            mode: mode,
            duration: duration,
            stream_settings: stream_settings,
            histogram_config: filteredHistogramSettings,
            port_tx_rx_mapping: port_tx_rx_mapping,
        };

        // Update the savedConfigs object with new config for activeConfigName
        const updatedSavedConfigs = {
            ...savedConfigs,
            [activeConfigName]: newConfig,
        };

        // Update state and localStorage
        setSavedConfigs(updatedSavedConfigs);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedSavedConfigs));

        if (do_alert) {
            showToast("Settings saved successfully.", "success");
        }
    }

    const reset = () => {
        localStorage.clear()

        set_streams([])
        set_stream_settings([])
        set_histogram_settings({})
        set_mode(GenerationMode.NONE)
        set_duration(0)
        set_port_tx_rx_mapping({})

        const defaultConfig: TrafficGenData = {
            mode: GenerationMode.NONE,
            duration: 0,
            streams: [],
            stream_settings: [],
            port_tx_rx_mapping: {},
            histogram_config: {}
        };
        setSavedConfigs({ [DEFAULT_CONFIG_NAME]: defaultConfig })
        setActiveConfigName(DEFAULT_CONFIG_NAME)

        showToast("Settings reset successfully.", "success")
    }

    const addStream = () => {
        if (p4tg_infos.asic == ASIC.Tofino1 && streams.length > 6) {
            showToast("Only 7 different streams allowed.", "warning")
        } else if (p4tg_infos.asic == ASIC.Tofino2 && streams.length > 14) {
            showToast("Only 15 different streams allowed.", "warning")
        } else {
            let id = 0

            if (streams.length > 0) {
                id = Math.max(...streams.map(s => s.stream_id))
            }

            set_streams(old => [...old, DefaultStream(id + 1)])

            ports.map((v, i) => {
                if (v.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback) {
                    set_stream_settings(old => [...old, DefaultStreamSettings(id + 1, v.port, v.channel)])
                }
            })
        }
    }

    const getCloneName = (baseName: string): string => {
        let copyName = `${baseName}_copy`;
        let counter = 2;

        while (savedConfigs[copyName]) {
            copyName = `${baseName}_copy${counter}`;
            counter++;
        }
        return copyName;
    };


    const cloneConfig = (name: string) => {
        const original = savedConfigs[name];
        if (!original) return;

        const clonedName = getCloneName(name);

        const newConfig = {
            ...original,
            name: clonedName,
        };

        const updatedConfigs = {
            ...savedConfigs,
            [clonedName]: newConfig,
        };

        setSavedConfigs(updatedConfigs);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedConfigs));
        showToast(`Cloned "${name}" to "${clonedName}"`, "success");
    };

    // Update a single (rx_port, rx_channel)
    const updateHistogramSettings = (
        front_panel_port: number,
        channel: number,
        updated: RttHistogramConfig
    ) => {
        set_histogram_settings((prev: { [x: string]: any; }) => {
            const p = String(front_panel_port);
            const c = String(channel);
            const next: HistogramConfigMap = {
                ...prev,
                [p]: { ...(prev[p] ?? {}), [c]: updated },
            };
            localStorage.setItem("histogram_config", JSON.stringify(next));
            return next;
        });
    };

    const removeStream = (id: number) => {
        set_streams(streams.filter(v => v.stream_id != id))
        set_stream_settings(stream_settings.filter(v => v.stream_id != id))
    }

    const exportSettings = () => {
        const settings = savedConfigs


        const flattened_settings = Object.entries(settings).map(([key, value]) => {
            // Filter stream_settings to only include active ones
            const filteredStreamSettings = value.stream_settings.filter(
                (setting) => setting.active
            );

            return {
                ...value,
                name: key,
                stream_settings: filteredStreamSettings,
            };
        });


        const json = `data:text/json;charset=utf-8,${encodeURIComponent(
            JSON.stringify(flattened_settings, null, "\t")
        )}`

        const link = document.createElement("a");
        link.href = json
        link.download = "settings.json"

        link.click()
    }

    const importSettings = (e: any) => {
        // @ts-ignore
        ref.current.click()
    }

    const fillPortsOnMissingSetting = (streams: Stream[], stream_settings: StreamSettings[]) => {
        // Take first 10 device (port,channel) pairs
        const availablePairs: Array<[number, number]> = ports.map(p => [p.port, p.channel]);

        streams.forEach((s) => {
            const existing = new Set(
                stream_settings
                    .filter(st => st.stream_id === s.stream_id && st.port != null && st.channel != null)
                    .map(st => `${st.port}/${st.channel}`)
            );

            for (const [p, ch] of availablePairs) {
                const key = `${p}/${ch}`;
                if (existing.has(key)) continue;

                const def = DefaultStreamSettings(s.stream_id, p, ch);
                if (s.encapsulation === Encapsulation.MPLS) {
                    for (let i = 0; i < s.number_of_lse; i++) def.mpls_stack.push(DefaultMPLSHeader());
                } else if (s.encapsulation === Encapsulation.SRv6) {
                    for (let i = 0; i < s.number_of_srv6_sids; i++) def.sid_list.push("::");
                }
                stream_settings.push(def);
            }
        });

        // Sort by stream, then port, then channel for stable rendering
        stream_settings.sort((a, b) =>
            a.stream_id - b.stream_id || a.port - b.port || a.channel - b.channel
        );
    };


    function migrateImportedConfig(
        cfg: Record<string, any>
    ): Record<string, TrafficGenData> {

        const isLegacyTest = (t: any) => {
            const pm = t?.port_tx_rx_mapping;
            const hc = t?.histogram_config;
            const ss = Array.isArray(t?.stream_settings) ? (t.stream_settings as Array<{ channel?: number }>) : [];
            const pmSample = pm && typeof pm === "object" ? Object.values(pm)[0] : undefined;
            const hcSample = hc && typeof hc === "object" ? Object.values(hc)[0] : undefined;

            return (
                typeof pmSample === "number" ||                       // tx->rx (number)
                (hcSample && typeof hcSample === "object" && "min" in hcSample) || // flat histogram
                ss.some(s => s?.channel == null)                      // missing channel
            );
        };

        const out: Record<string, TrafficGenData> = {};
        for (const [k, v] of Object.entries(cfg)) {
            if (isLegacyTest(v)) {
                const port_tx_rx_mapping: PortTxRxMap = Object.fromEntries(
                    Object.entries(v.port_tx_rx_mapping ?? {}).map(([tx, rx]) => [
                        String(tx),
                        { "0": { port: Number(rx), channel: 0 } },
                    ])
                );
                const histogram_config = Object.fromEntries(
                    Object.entries(v.histogram_config ?? {}).map(([rp, cfg]) => [String(rp), { "0": cfg }])
                );
                const stream_settings: StreamSettings[] = (v.stream_settings ?? []).map((s: any) => ({
                    ...s, channel: s.channel ?? 0,
                }));
                out[k] = { ...v, port_tx_rx_mapping, histogram_config, stream_settings };
            } else {
                out[k] = v as TrafficGenData; // already new shape
            }
        }
        return out;
    }

    function isSingleTrafficGenData(val: unknown): val is TrafficGenData {
        return typeof val === 'object' && val !== null
            && 'streams' in val
            && 'stream_settings' in val
    }

    const loadSettings = (e: any) => {
        e.preventDefault()

        const fileReader = new FileReader();
        fileReader.readAsText(e.target.files[0], "UTF-8");

        fileReader.onload = (e: any) => {
            const data = JSON.parse(e.target.result);
            let new_config: Record<string, TrafficGenData> = {};

            if (typeof data === 'object' && data !== null) {
                if (Object.values(data).every(isSingleTrafficGenData)) {
                    // It's Record<string, TrafficGenData>, old format
                    const typedData = data as Record<string, TrafficGenData>;
                    for (let [key, value] of Object.entries(typedData)) {
                        // Use the name in the test object as a key.
                        // This deflates the POST:/api/trafficgen format back to the savedConfig format.
                        if (value.name && typeof value.name === "string") {
                            if (key !== value.name) {
                                new_config[value.name] = value;
                            } else {
                                new_config[key] = value;
                            }
                        } else {
                            // fallback if no name property
                            new_config[key] = value;
                        }
                    }

                } else if (isSingleTrafficGenData(data)) {
                    // It's a single TrafficGenData
                    new_config = { [DEFAULT_CONFIG_NAME]: data }
                } else {
                    showToast("Could not serialize file content. Please check the file.", "danger")
                    return;
                }
            }

            for (const [name, config] of Object.entries(new_config)) {
                if (!validateStreams(config.streams) || !validateStreamSettings(config.stream_settings)) {
                    showToast("Settings not valid for config " + name + ". Please check the file.", "danger")
                    // @ts-ignore
                    ref.current.value = ""
                    return;
                } else if (!validatePorts(config.port_tx_rx_mapping, ports, p4tg_infos)) {
                    showToast("Settings not valid for config " + name + ". Configured front panel ports are not available on this device.", "danger")
                    return;
                }
            };

            const migrated_config = migrateImportedConfig(new_config)

            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(migrated_config))

            const first_test = Object.values(migrated_config)[0];

            localStorage.setItem("streams", JSON.stringify(first_test.streams))
            localStorage.setItem("gen-mode", String(first_test.mode))
            localStorage.setItem("duration", first_test.duration ? String(first_test.duration) : "0")
            localStorage.setItem("streamSettings", JSON.stringify(first_test.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(first_test.port_tx_rx_mapping))
            localStorage.setItem("histogram_config", first_test.histogram_config ? JSON.stringify(first_test.histogram_config) : "{}")

            showToast("Settings imported successfully.", "success")

        }
    }

    fillPortsOnMissingSetting(streams, stream_settings);

    const handleRenameTab = (oldName: string, newName: string) => {
        if (!newName || newName === oldName || savedConfigs[newName]) {
            // Invalid name or name already exists
            setRenamingTab(null);
            setRenameValue("");
            showToast("Name already exists or is invalid.", "warning");
            return;
        }
        // Rename in savedConfigs
        const updatedConfigs: Record<string, TrafficGenData> = {};
        Object.entries(savedConfigs).forEach(([k, v]) => {
            if (k === oldName) {
                updatedConfigs[newName] = v;
            } else {
                updatedConfigs[k] = v;
            }
        });
        setSavedConfigs(updatedConfigs);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedConfigs));
        setActiveConfigName(newName);
        setRenamingTab(null);
        setRenameValue("");
    };

    // @ts-ignore
    return <Loader loaded={loaded}>

        <Tab.Container activeKey={activeConfigName} onSelect={(k) => {
            save();
            if (k) setActiveConfigName(k);
        }}>
            <Nav variant="tabs">
                {Object.keys(savedConfigs).map((name) => (
                    <Nav.Item key={name}>
                        <Nav.Link
                            eventKey={name}
                            active={activeConfigName === name}
                            disabled={running}
                            onDoubleClick={() => {
                                if (running) return;
                                setRenamingTab(name);
                                setRenameValue(name);
                            }}
                            style={{ userSelect: "none" }}
                        >
                            {renamingTab === name ? (
                                // Double clicked on tab --> open rename input field
                                <Form
                                    style={{ display: "inline-flex", alignItems: "center" }}
                                    onSubmit={e => {
                                        e.preventDefault();
                                        if (renameValue.length > 20) {
                                            showToast("Name too long (max 20 characters).", "warning");
                                            return;
                                        }
                                        handleRenameTab(name, renameValue);
                                    }}
                                >
                                    <Form.Control
                                        size="sm"
                                        autoFocus
                                        value={renameValue}
                                        maxLength={20}
                                        onChange={e => setRenameValue(e.target.value.slice(0, 20))}
                                        onBlur={() => handleRenameTab(name, renameValue)}
                                        style={{ width: "90px", display: "inline-block", marginRight: "4px", padding: "0px 4px" }}
                                        disabled={running}
                                        // This line is required to enable spaces in input
                                        onKeyDown={e => e.stopPropagation()}
                                    />
                                </Form>
                            ) : (
                                <>
                                    {name}
                                    <div style={{ display: "inline-flex", alignItems: "center", marginLeft: "5px", gap: "4px" }}>
                                        {/* Clone Button */}
                                        <Button
                                            size="sm"
                                            disabled={running}
                                            variant="outline-secondary"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                cloneConfig(name);
                                            }}
                                            style={{
                                                padding: "0px",
                                                borderWidth: "1px",
                                                width: "20px",
                                                height: "20px",
                                                display: "flex",
                                                justifyContent: "center",
                                                alignItems: "center",
                                            }}
                                            title="Clone Test"
                                        >
                                            <i className="bi bi-files" />
                                        </Button>

                                        {/* Delete Button */}
                                        {Object.keys(savedConfigs).length > 1 && (
                                            <Button
                                                size="sm"
                                                disabled={running}
                                                variant="outline-primary"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    deleteConfig(name);
                                                }}
                                                style={{
                                                    padding: "0px",
                                                    borderWidth: "1px",
                                                    width: "20px",
                                                    height: "20px",
                                                    display: "flex",
                                                    justifyContent: "center",
                                                    alignItems: "center",
                                                }}
                                                title="Delete Test"
                                            >
                                                <i className="bi bi-x" />
                                            </Button>
                                        )}
                                    </div>
                                </>
                            )}
                        </Nav.Link>
                    </Nav.Item>
                ))}
                <Nav.Item>
                    <Button
                        size="sm"
                        onClick={() => {
                            // Save current settings before adding a new tab
                            save();

                            const nextIndex = Object.keys(savedConfigs).length > 0 ? Object.keys(savedConfigs).length + 1 : 1;
                            let newName = `Test ${nextIndex}`;
                            if (savedConfigs[newName]) {
                                // This breaks if two tests in the middle are deleted and a new one is added. Fix this in the future
                                newName = `Test ${nextIndex + 1}`;
                            }

                            if (!savedConfigs[newName]) {
                                // Create new default config for the new tab
                                const defaultConfig: TrafficGenData = {
                                    mode: GenerationMode.NONE,
                                    duration: 0,
                                    streams: [],
                                    stream_settings: [],
                                    port_tx_rx_mapping: {},
                                    histogram_config: {}
                                };
                                const updatedConfigs = { ...savedConfigs, [newName]: defaultConfig };
                                setSavedConfigs(updatedConfigs);
                                localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedConfigs));
                                setActiveConfigName(newName);
                            } else {
                                // Should actually never happen
                                showToast("Name already exists.", "warning");
                            }
                        }}
                        variant="outline-secondary"
                        disabled={running}
                        style={{ marginLeft: "10px", marginTop: "0px" }}
                    >
                        <i className="bi bi-plus-circle-fill" /> Add Test
                    </Button>
                </Nav.Item>
            </Nav>

            <Tab.Content>
                {Object.keys(savedConfigs).map((name) => (
                    <Tab.Pane eventKey={name} key={name}>
                        <Row className={"align-items-center"}>

                            <Col className={"col-2"}>
                                <Form.Select disabled={running} required
                                    onChange={(event: any) => {
                                        set_streams([]);
                                        set_stream_settings([]);
                                        set_histogram_settings({});
                                        if (event.target.value != "" && event.target.value != GenerationMode.ANALYZE) {
                                            addStream();
                                        }
                                        set_mode(parseInt(event.target.value));
                                        set_duration(0);
                                    }}>
                                    <option value={GenerationMode.NONE}>Generation Mode</option>
                                    <option selected={mode === GenerationMode.CBR} value={GenerationMode.CBR}>CBR</option>
                                    <option selected={mode === GenerationMode.POISSON} value={GenerationMode.POISSON}>Poisson</option>
                                    <option selected={mode === GenerationMode.MPPS} value={GenerationMode.MPPS}>Mpps</option>
                                    <option selected={mode === GenerationMode.ANALYZE} value={GenerationMode.ANALYZE}>Monitor</option>
                                </Form.Select>
                            </Col>
                            <Col className={"col-auto"}>
                                <InfoBox>
                                    <>
                                        <p>P4TG supports multiple modes.</p>

                                        <h5>Constant bit rate (CBR)</h5>

                                        <p>Constant bit rate (CBR) traffic sends traffic with a constant rate.</p>

                                        <h5>Poisson</h5>

                                        <p>Poisson traffic is traffic with random inter-arrival times but a constant average traffic
                                            rate.</p>

                                        <h5>Mpps</h5>

                                        <p>In Mpps mode, P4TG generates traffic with a fixed number of packets per seconds.</p>

                                        <h5>Monitor/Analyze</h5>

                                        <p>In monitor/analyze mode, P4TG forwards traffic received on its ports and measures L1/L2
                                            rates, packet sizes/types and inter-arrival times.</p>

                                    </>
                                </InfoBox>
                            </Col>

                            <Col className={"col-auto"}>
                                <div>
                                    <span>Test duration     </span>
                                    <InfoBox>
                                        <>
                                            <h5>Test duration</h5>

                                            <p>If a test duration (in seconds) is specified, traffic generation will automatically stop after the duration is exceeded. A value of 0 indicates generation of infinite duration.</p>
                                        </>
                                    </InfoBox>
                                </div>
                            </Col>

                            <Col className={"col-auto"}>
                                <Form.Control className={"col-3 text-start"}
                                    onChange={(event: any) => set_duration(parseInt(event.target.value))}
                                    min={0}
                                    step={1}
                                    placeholder={duration > 0 ? String(duration) + " s" : "∞ s"}
                                    disabled={running} type={"number"} />

                            </Col>
                            <Col className={"text-end"}>
                                <Button onClick={importSettings} disabled={running} variant={"primary"}>
                                    <i className="bi bi-cloud-arrow-down-fill" /> Import
                                </Button>
                                {" "}
                                <Button onClick={exportSettings} disabled={running} variant={"danger"}>
                                    <i className="bi bi-cloud-arrow-up-fill" /> Export
                                </Button>
                            </Col>
                        </Row>
                        <Row>

                        </Row>
                        {mode != GenerationMode.ANALYZE ?
                            <Row>
                                <Col>
                                    <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
                                        <thead className={"table-dark"}>
                                            <tr>
                                                <th>Stream-ID</th>
                                                <th>Frame Size</th>
                                                <th>Rate</th>
                                                <th>Mode &nbsp;
                                                    <InfoBox>
                                                        <>
                                                            <h5>Rate Precision</h5>

                                                            <p>In this mode, several packets may be generated at once (burst) to fit the configured traffic rate more precisely. </p>

                                                            <h5>IAT Precision</h5>

                                                            <p>In this mode, a single packet is generated at once and all packets have the same inter-arrival times. This mode should be used if the traffic should be very "smooth", i.e., without bursts.
                                                                However, the configured traffic rate may not be met precisely.</p>
                                                        </>
                                                    </InfoBox>
                                                </th>
                                                <th>VxLAN &nbsp;
                                                    <InfoBox>
                                                        <p>VxLAN (<a href={"https://datatracker.ietf.org/doc/html/rfc7348"} target="_blank">RFC
                                                            7348</a>) adds an additional outer Ethernet, IP and VxLAN header to the packet.
                                                        </p>
                                                    </InfoBox>
                                                </th>
                                                <th>IP Version</th>
                                                <th>Encapsulation &nbsp;
                                                    <InfoBox>
                                                        <p>P4TG supports various encapsulations for the generated IP/UDP packet.</p>
                                                    </InfoBox>
                                                </th>
                                                <th>Options</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {streams.map((v, i) => {
                                                v.app_id = i + 1;
                                                return <StreamElement key={i} mode={mode} data={v} remove={removeStream} running={running}
                                                    stream_settings={stream_settings} p4tg_infos={p4tg_infos} />
                                            })}

                                        </tbody>
                                    </Table>

                                </Col>
                            </Row>
                            : null
                        }
                        <Row className={"mb-3"}>
                            <Col className={"text-start"}>
                                {running ? null :
                                    mode === GenerationMode.CBR || mode == GenerationMode.MPPS ?
                                        <Button onClick={addStream} variant="primary"><i className="bi bi-plus" /> Add
                                            stream</Button>
                                        :
                                        null
                                }
                            </Col>
                        </Row>

                        {streams.length > 0 || mode == GenerationMode.ANALYZE ?
                            <Row>
                                <Col>
                                    <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
                                        <thead className={"table-dark"}>
                                            <tr>
                                                <th>TX Port</th>
                                                <th>RX Port</th>
                                                {streams.map((v, i) => {
                                                    return <th key={i}>Stream {v.app_id}</th>
                                                })}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {ports.map((v) => {
                                                if (v.loopback !== "BF_LPBK_NONE" && !p4tg_infos.loopback) return null;

                                                const txKey = String(v.port);
                                                const chKey = String(v.channel);
                                                const current = port_tx_rx_mapping?.[txKey]?.[chKey];
                                                const defaultValue = current ? `${current.port}/${current.channel}` : "-1";

                                                return (
                                                    <tr key={`${v.pid}`}>
                                                        <StyledCol>{v.port}/{v.channel} ({v.pid})</StyledCol>
                                                        <StyledCol className="d-flex align-items-center gap-2">
                                                            <Form.Select
                                                                disabled={running || !v.status}
                                                                required
                                                                defaultValue={defaultValue}
                                                                onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                                                                    const value = event.target.value;
                                                                    // clone shallowly, then the nested level we modify
                                                                    const updated = {
                                                                        ...port_tx_rx_mapping,
                                                                        [txKey]: { ...(port_tx_rx_mapping?.[txKey] ?? {}) },
                                                                    };

                                                                    if (value === "-1") {
                                                                        // remove this (txPort, txCh) mapping
                                                                        delete updated[txKey][chKey];
                                                                        // clean up empty port entry
                                                                        if (Object.keys(updated[txKey]).length === 0) {
                                                                            delete updated[txKey];
                                                                        }
                                                                    } else {
                                                                        const [rxPortStr, rxChStr] = value.split("/");
                                                                        updated[txKey][chKey] = {
                                                                            port: Number(rxPortStr),
                                                                            channel: Number(rxChStr),
                                                                        };
                                                                    }

                                                                    set_port_tx_rx_mapping(updated);
                                                                }}
                                                            >
                                                                <option value="-1">Select RX Port/Channel</option>
                                                                {ports.map((p) => {
                                                                    if (p.loopback !== "BF_LPBK_NONE" && !p4tg_infos.loopback) return null;
                                                                    const optionValue = `${p.port}/${p.channel}`;
                                                                    return (
                                                                        <option key={p.pid} value={optionValue}>
                                                                            {p.port}/{p.channel} ({p.pid})
                                                                        </option>
                                                                    );
                                                                })}
                                                            </Form.Select>

                                                            <HistogramSettings port={v} mapping={port_tx_rx_mapping} disabled={running || !v.status} data={histogram_settings} set_data={updateHistogramSettings} />
                                                        </StyledCol>

                                                        <StreamSettingsList
                                                            stream_settings={stream_settings}
                                                            streams={streams}
                                                            running={running}
                                                            port={v}
                                                            p4tg_infos={p4tg_infos}
                                                        />
                                                    </tr>
                                                );
                                            })}

                                        </tbody>
                                    </Table>

                                </Col>
                            </Row>
                            :
                            null
                        }

                        <Row>
                            <Col>
                                <Button onClick={() => save(true)} disabled={running} variant="primary"><i className="bi bi-check" /> Save</Button>
                                {" "}
                                <Button onClick={reset} disabled={running} variant="danger"><i className="bi bi-x-octagon-fill" /> Reset</Button>
                            </Col>
                        </Row>
                        {/* End of layout */}
                    </Tab.Pane>
                ))}
            </Tab.Content>
        </Tab.Container>

        <input
            style={{ display: "none" }}
            accept=".json"
            // @ts-ignore
            ref={ref}
            onChange={loadSettings}
            type="file"
        />

        <GitHub />


    </Loader>
}

export default Settings