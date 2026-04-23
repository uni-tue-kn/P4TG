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
import { Button, Col, Form, Nav, OverlayTrigger, Row, Tab, Table, Tooltip } from "react-bootstrap";
import { get } from "../common/API";
import Loader from "../components/Loader";
import {
    ASIC,
    DetNetSeqNumLength,
    DefaultMPLSHeader,
    DefaultStream,
    DefaultStreamSettings,
    Encapsulation,
    GenerationMode, GenerationPattern, GenerationUnit, HistogramConfigMap, P4TGInfos,
    PortInfo,
    PortTxRxMap,
    HistogramConfig,
    speedToGbps,
    Stream,
    StreamSettings, ToastVariant, TrafficGenData,
    defaultIPv4,
    defaultIPv6,
} from "../common/Interfaces";
import styled from "styled-components";
import InfoBox from "../components/InfoBox";

import { GitHub } from "./Home";
import StreamSettingsList from "../components/settings/StreamSettingsList";
import StreamElement from "../components/settings/StreamElement";
import { ensureDefaults, stripUnusedFields } from "../components/settings/SettingsModal";
import { validateIPv6RandomMask, validatePorts, validateStreams, validateStreamSettings } from "../common/Validators";
import HistogramSettings from '../components/settings/HistogramSettings';
import { PortStatus } from './Ports';
import { getTotalActiveStreamRate, getTotalRatePerPort } from '../common/Helper';
import IMIXModal from '../components/settings/IMIXModal';
import { IMIXConfig, IMIX_DESCRIPTION, IMIX_STREAM_COUNT, IMIX_STREAM_SPECS, splitImixRate } from '../common/IMIX';

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

const patternSupportsInverted = (patternType: GenerationPattern): boolean =>
    patternType === GenerationPattern.Square || patternType === GenerationPattern.Sawtooth;

const normalizeStreamsForFrontend = (
    config: TrafficGenData,
    asic: ASIC,
): { config: TrafficGenData; warning?: string } => {
    const streams = (config.streams ?? []).map((stream) => ({ ...stream }));
    validateStreams(streams);

    let warning: string | undefined;

    const normalizedStreams = streams.map((stream) => {
        const normalizedStream = { ...stream };
        const pattern = normalizedStream.pattern ? { ...normalizedStream.pattern } : null;
        const postStackAllowed = normalizedStream.encapsulation === Encapsulation.MPLS
            && !normalizedStream.vxlan
            && !normalizedStream.gtpu
            && !normalizedStream.detnet_cw;

        if (asic === ASIC.Tofino1 && normalizedStream.encapsulation === Encapsulation.SRv6) {
            warning = `SRv6 is not supported on Tofino 1. Stream "${normalizedStream.stream_id}" encapsulation set to None.`;
            normalizedStream.encapsulation = Encapsulation.None;
        }

        if (normalizedStream.encapsulation !== Encapsulation.MPLS) {
            normalizedStream.detnet_cw = false;
            normalizedStream.detnet_seq_num_length = null;
            normalizedStream.mna_in_stack = false;
            normalizedStream.mna_post_stack = false;
        } else if (!normalizedStream.detnet_cw) {
            normalizedStream.detnet_seq_num_length = null;
        } else if (normalizedStream.detnet_seq_num_length == null) {
            normalizedStream.detnet_seq_num_length = DetNetSeqNumLength.TwentyEight;
        }

        if (normalizedStream.encapsulation === Encapsulation.MPLS
            && normalizedStream.mna_post_stack
            && !normalizedStream.mna_in_stack) {
            normalizedStream.mna_in_stack = true;
        }

        if (!normalizedStream.mna_in_stack || !postStackAllowed) {
            if (normalizedStream.mna_post_stack && normalizedStream.encapsulation === Encapsulation.MPLS) {
                warning = `Post-stack MNA requires MPLS without DetNet Control Word, VxLAN, or GTP-U. Stream "${normalizedStream.stream_id}" post-stack MNA was disabled.`;
            }
            normalizedStream.mna_post_stack = false;
        }

        if (
            asic === ASIC.Tofino1 &&
            normalizedStream.encapsulation === Encapsulation.MPLS &&
            normalizedStream.detnet_cw &&
            normalizedStream.ip_version === 6
        ) {
            warning = `DetNet CW requires IPv4 on Tofino 1. Stream "${normalizedStream.stream_id}" IP version set to IPv4.`;
            normalizedStream.ip_version = 4;
        }

        if (pattern) {
            if (!patternSupportsInverted(pattern.pattern_type)) {
                if (pattern.inverted) {
                    warning = `Inverted is ignored for ${pattern.pattern_type} in stream "${normalizedStream.stream_id}".`;
                }
                pattern.inverted = null;
            } else if (pattern.inverted == null) {
                pattern.inverted = false;
            }
            normalizedStream.pattern = pattern;
        }

        return normalizedStream;
    });

    return {
        config: {
            ...config,
            streams: normalizedStreams,
        },
        warning,
    };
};

const normalizeTofino1StreamSettings = (
    stream_settings: StreamSettings[],
): { stream_settings: StreamSettings[]; warning?: string } => {
    let warning: string | undefined;

    const normalizedSettings = stream_settings.map((setting) => {
        let updated = setting;

        if (setting.ipv6) {
            const ipv6 = updated.ipv6!;
            if (!validateIPv6RandomMask(setting.ipv6.ipv6_src_mask, ASIC.Tofino1)) {
                warning = `IPv6 source randomization mask too large for Tofino 1 on ${setting.stream_id}. Setting to ::ffff:ffff`;
                updated = {
                    ...updated,
                    ipv6: { ...ipv6, ipv6_src_mask: "::ffff:ffff" },
                };
            }
            if (!validateIPv6RandomMask(setting.ipv6.ipv6_dst_mask, ASIC.Tofino1)) {
                warning = `IPv6 destination randomization mask too large for Tofino 1 on ${setting.stream_id}. Setting to ::ffff:ffff`;
                updated = {
                    ...updated,
                    ipv6: { ...ipv6, ipv6_dst_mask: "::ffff:ffff" },
                };
            }
        }

        return updated;
    });

    return {
        stream_settings: normalizedSettings,
        warning,
    };
};


const Settings = ({ p4tg_infos, showToast }: { p4tg_infos: P4TGInfos, showToast: (msg: string, bg: ToastVariant) => void }) => {
    const [ports, set_ports] = useState<PortInfo[]>([])
    const [running, set_running] = useState(false)
    // @ts-ignore
    const [streams, set_streams] = useState<Stream[]>(JSON.parse(localStorage.getItem("streams")) || [])
    // @ts-ignore
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(JSON.parse(localStorage.getItem("streamSettings")) || [])
    // @ts-ignore
    const [rtt_histogram_settings, set_rtt_histogram_settings] = useState<HistogramConfigMap>(JSON.parse(localStorage.getItem("rtt_histogram_config")) || {})
    // @ts-ignore
    const [iat_histogram_settings, set_iat_histogram_settings] = useState<HistogramConfigMap>(JSON.parse(localStorage.getItem("iat_histogram_config")) || {})

    // @ts-ignore
    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<PortTxRxMap>(JSON.parse(localStorage.getItem("port_tx_rx_mapping")) || {})

    const [mode, set_mode] = useState(parseInt(localStorage.getItem("gen-mode") || String(GenerationMode.NONE)))
    const [duration, set_duration] = useState(parseInt(localStorage.getItem("duration") || String(0)))
    const [loaded, set_loaded] = useState(false)
    const ref = useRef()
    const streamsRef = useRef<Stream[]>(streams);
    const loadGenWarningRef = useRef<string | null>(null);

    const [savedConfigs, setSavedConfigs] = useState<Record<string, TrafficGenData>>({});
    const [activeConfigName, setActiveConfigName] = useState<string>(DEFAULT_CONFIG_NAME);

    const [renamingTab, setRenamingTab] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState<string>("");
    const [lastDeletedConfig, setLastDeletedConfig] = useState<{ name: string; config: TrafficGenData; index: number } | null>(null);
    const [showIMIXModal, setShowIMIXModal] = useState(false);

    const maxStreams = p4tg_infos.asic === ASIC.Tofino1 ? 7 : 15;

    const renderTooltip = (props: any, message: string) => (
        <Tooltip id="tooltip-disabled" {...props}>
            {message}
        </Tooltip>
    );

    const eligiblePorts = ports.filter((port) => port.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback);

    const setActiveDraftConfig = (config: TrafficGenData) => {
        set_streams(config.streams);
        set_stream_settings(config.stream_settings);
        set_mode(config.mode);
        set_duration(config.duration);
        set_port_tx_rx_mapping(config.port_tx_rx_mapping);
        set_rtt_histogram_settings(config.rtt_histogram_config);
        set_iat_histogram_settings(config.iat_histogram_config);

        localStorage.setItem("streams", JSON.stringify(config.streams));
        localStorage.setItem("streamSettings", JSON.stringify(config.stream_settings));
        localStorage.setItem("gen-mode", String(config.mode));
        localStorage.setItem("duration", String(config.duration));
        localStorage.setItem("port_tx_rx_mapping", JSON.stringify(config.port_tx_rx_mapping));
        localStorage.setItem("rtt_histogram_config", JSON.stringify(config.rtt_histogram_config));
        localStorage.setItem("iat_histogram_config", JSON.stringify(config.iat_histogram_config));

        if (activeConfigName) {
            const updatedConfigs = {
                ...savedConfigs,
                [activeConfigName]: config,
            };

            setSavedConfigs(updatedConfigs);
            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedConfigs));
        }
    };

    const updateDraftState = (nextStreams: Stream[], nextStreamSettings: StreamSettings[]) => {
        const nextConfig: TrafficGenData = {
            ...(savedConfigs[activeConfigName] ?? {
                mode: GenerationMode.NONE,
                duration: 0,
                streams: [],
                stream_settings: [],
                port_tx_rx_mapping: {},
                rtt_histogram_config: {},
                iat_histogram_config: {},
            }),
            streams: nextStreams,
            stream_settings: nextStreamSettings,
            mode,
            duration,
            port_tx_rx_mapping,
            rtt_histogram_config: rtt_histogram_settings,
            iat_histogram_config: iat_histogram_settings,
        };

        setActiveDraftConfig(nextConfig);
    };

    const appendStreams = (newStreams: Stream[]) => {
        if (newStreams.length === 0) {
            return;
        }

        const newSettings = eligiblePorts.flatMap((port) =>
            newStreams.map((stream) => DefaultStreamSettings(stream.stream_id, port.port, port.channel))
        );

        updateDraftState(
            [...streams, ...newStreams],
            [...stream_settings, ...newSettings]
        );
    }

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
        const currentStreams = streamsRef.current;

        let stats = await get({ route: "/trafficgen" })
        if (stats !== undefined) {
            if (Object.keys(stats.data).length > 1) {
                let old_streams = JSON.stringify(currentStreams)
                const mergedStreams = (stats.data.streams ?? []).map((streamFromBackend: Stream) => {
                    const existing = currentStreams.find((stream) => stream.stream_id === streamFromBackend.stream_id);
                    return {
                        ...streamFromBackend,
                        detnet_cw: streamFromBackend.detnet_cw ?? existing?.detnet_cw ?? false,
                        detnet_seq_num_length: streamFromBackend.detnet_seq_num_length ?? existing?.detnet_seq_num_length ?? null,
                        mna_in_stack: streamFromBackend.mna_in_stack ?? existing?.mna_in_stack ?? false,
                        mna_post_stack: streamFromBackend.mna_post_stack ?? existing?.mna_post_stack ?? false,
                    };
                });
                const normalized = normalizeStreamsForFrontend({
                    ...stats.data,
                    streams: mergedStreams,
                }, p4tg_infos.asic);
                const nextStreams = normalized.config.streams ?? [];

                if (old_streams != JSON.stringify(nextStreams)) {
                    set_mode(normalized.config.mode)
                    set_duration(normalized.config.duration)
                    set_port_tx_rx_mapping(normalized.config.port_tx_rx_mapping)
                    set_stream_settings(normalized.config.stream_settings)
                    set_streams(nextStreams)
                    set_rtt_histogram_settings(normalized.config.rtt_histogram_config)
                    set_iat_histogram_settings(normalized.config.iat_histogram_config)

                    localStorage.setItem("streams", JSON.stringify(nextStreams))
                    localStorage.setItem("gen-mode", String(normalized.config.mode))
                    localStorage.setItem("duration", String(normalized.config.duration ?? 0))
                    localStorage.setItem("streamSettings", JSON.stringify(normalized.config.stream_settings))
                    localStorage.setItem("port_tx_rx_mapping", JSON.stringify(normalized.config.port_tx_rx_mapping))
                    localStorage.setItem("rtt_histogram_config", JSON.stringify(normalized.config.rtt_histogram_config))
                    localStorage.setItem("iat_histogram_config", JSON.stringify(normalized.config.iat_histogram_config))
                }

                if (normalized.warning && loadGenWarningRef.current !== normalized.warning) {
                    showToast(normalized.warning, "warning");
                    loadGenWarningRef.current = normalized.warning;
                } else if (!normalized.warning) {
                    loadGenWarningRef.current = null;
                }
                set_running(true)
            } else {
                loadGenWarningRef.current = null;
                set_running(false)
            }
        }
    }

    useEffect(() => {
        streamsRef.current = streams;
    }, [streams]);

    useEffect(() => {
        refresh()

        const interval = setInterval(loadGen, 2000);

        return () => {
            clearInterval(interval)
        }
    }, [])

    useEffect(() => {
        let configs = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "{}");
        let toastMessage;
        let toastType;

        // If no configs, create default one
        if (Object.keys(configs).length === 0) {
            const defaultConfig: TrafficGenData = {
                mode: GenerationMode.NONE,
                duration: 0,
                streams: [],
                stream_settings: [],
                port_tx_rx_mapping: {},
                rtt_histogram_config: {},
                iat_histogram_config: {}
            };
            configs = { [DEFAULT_CONFIG_NAME]: defaultConfig };
        }

        configs = Object.fromEntries(
            Object.entries(configs).map(([name, config]) => {
                const normalized = normalizeStreamsForFrontend(
                    config as TrafficGenData,
                    p4tg_infos.asic,
                );
                if (normalized.warning) {
                    toastMessage = normalized.warning;
                    toastType = "warning" as ToastVariant;
                }
                return [name, normalized.config];
            })
        );

        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(configs));

        setSavedConfigs(configs);

        // Load first available config or fallback
        const names = Object.keys(configs);
        if (names.length > 0) {
            setActiveConfigName(names[0]);
            loadConfigToState(configs[names[0]]);
        }

        if (toastMessage && toastType) {
            showToast(toastMessage, toastType);
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
        set_rtt_histogram_settings(config.rtt_histogram_config ?? {});
        set_iat_histogram_settings(config.iat_histogram_config ?? {});
    };

    const deleteConfig = (name: string) => {
        const updated = { ...savedConfigs };
        const deletedConfig = updated[name];
        const deletedIndex = Object.keys(savedConfigs).indexOf(name);
        delete updated[name];
        setSavedConfigs(updated);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updated));
        if (deletedConfig) {
            setLastDeletedConfig({ name, config: deletedConfig, index: deletedIndex });
        }

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
                set_rtt_histogram_settings({});
                set_iat_histogram_settings({});
            }
        }
    };

    const restoreDeletedConfig = () => {
        if (!lastDeletedConfig) return;

        const { name, config, index } = lastDeletedConfig;
        let restoredName = name;

        // Avoid name collisions if a test with the same name was added after deletion
        if (savedConfigs[restoredName]) {
            let counter = 1;
            while (savedConfigs[`${name} (${counter})`]) counter++;
            restoredName = `${name} (${counter})`;
        }

        const entries = Object.entries(savedConfigs);
        const insertIndex = Math.min(Math.max(index, 0), entries.length);
        const updatedEntries = [
            ...entries.slice(0, insertIndex),
            [restoredName, config] as [string, TrafficGenData],
            ...entries.slice(insertIndex),
        ];

        const updatedConfigs = Object.fromEntries(updatedEntries) as Record<string, TrafficGenData>;
        setSavedConfigs(updatedConfigs);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedConfigs));
        setActiveConfigName(restoredName);
        setLastDeletedConfig(null);
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
        const filteredRTTHistogramSettings: HistogramConfigMap = {};
        for (const [rxPort, perCh] of Object.entries(rtt_histogram_settings ?? {})) {
            for (const [rxCh, cfg] of Object.entries(perCh ?? {})) {
                if (allowed.has(`${rxPort}/${rxCh}`)) {
                    (filteredRTTHistogramSettings[rxPort] ??= {})[rxCh] = cfg;
                }
            }
        }
        const filteredIATHistogramSettings: HistogramConfigMap = {};
        for (const [rxPort, perCh] of Object.entries(iat_histogram_settings ?? {})) {
            for (const [rxCh, cfg] of Object.entries(perCh ?? {})) {
                if (allowed.has(`${rxPort}/${rxCh}`)) {
                    (filteredIATHistogramSettings[rxPort] ??= {})[rxCh] = cfg;
                }
            }
        }

        // Reconcile stream_settings: populate defaults for enabled features,
        // strip fields for disabled features, so the payload is always correct
        // even if the user never opened the SettingsModal.
        const reconciledSettings = stream_settings.map(ss => {
            const matchingStream = streams.find(s => s.stream_id === ss.stream_id);
            if (!matchingStream) return ss;
            return stripUnusedFields(ensureDefaults(ss, matchingStream), matchingStream);
        });

        // Update in-memory state so subsequent operations use reconciled data
        set_stream_settings(reconciledSettings);

        localStorage.setItem("streams", JSON.stringify(streams))
        localStorage.setItem("gen-mode", String(mode))
        localStorage.setItem("duration", String(duration))
        localStorage.setItem("streamSettings", JSON.stringify(reconciledSettings))
        localStorage.setItem("rtt_histogram_config", JSON.stringify(filteredRTTHistogramSettings))
        localStorage.setItem("iat_histogram_config", JSON.stringify(filteredIATHistogramSettings))
        localStorage.setItem("port_tx_rx_mapping", JSON.stringify(port_tx_rx_mapping))

        const newConfig: TrafficGenData = {
            streams: streams,
            mode: mode,
            duration: duration,
            stream_settings: reconciledSettings,
            rtt_histogram_config: filteredRTTHistogramSettings,
            iat_histogram_config: filteredIATHistogramSettings,
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
        set_rtt_histogram_settings({})
        set_iat_histogram_settings({})
        set_mode(GenerationMode.NONE)
        set_duration(0)
        set_port_tx_rx_mapping({})

        const defaultConfig: TrafficGenData = {
            mode: GenerationMode.NONE,
            duration: 0,
            streams: [],
            stream_settings: [],
            port_tx_rx_mapping: {},
            rtt_histogram_config: {},
            iat_histogram_config: {}
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

            appendStreams([DefaultStream(id + 1)])
        }
    }

    const addIMIXStreams = (config: IMIXConfig) => {
        if (streams.length + IMIX_STREAM_COUNT > maxStreams) {
            showToast(`IMIX requires ${IMIX_STREAM_COUNT} free stream slots.`, "warning");
            return;
        }

        const startId = streams.length > 0 ? Math.max(...streams.map((stream) => stream.stream_id)) : 0;
        const rates = splitImixRate(config.totalRate, config.unit);
        const newStreams = IMIX_STREAM_SPECS.map((spec, index) => {
            const stream = DefaultStream(startId + index + 1);
            stream.frame_size = spec.frameSize;
            stream.traffic_rate = rates[index];
            stream.unit = config.unit;
            stream.ip_version = config.ipVersion;
            return stream;
        });

        const newSettings = eligiblePorts.flatMap((port) =>
            newStreams.map((stream) => {
                const settings = DefaultStreamSettings(stream.stream_id, port.port, port.channel);
                if (config.ipVersion === 6) {
                    delete settings.ip;
                    settings.ipv6 = defaultIPv6();
                } else {
                    settings.ip = defaultIPv4();
                    delete settings.ipv6;
                }
                return settings;
            })
        );

        updateDraftState(
            [...streams, ...newStreams],
            [...stream_settings, ...newSettings]
        );
        showToast(`Added IMIX streams (${IMIX_DESCRIPTION}).`, "success");
    }

    const handleModeChange = (nextMode: GenerationMode) => {
        const shouldCreateDefaultStream =
            nextMode !== GenerationMode.NONE && nextMode !== GenerationMode.ANALYZE;

        const nextStreams = shouldCreateDefaultStream ? [DefaultStream(1)] : [];
        const nextStreamSettings = shouldCreateDefaultStream
            ? eligiblePorts.map((port) => DefaultStreamSettings(1, port.port, port.channel))
            : [];

        const nextConfig: TrafficGenData = {
            ...(savedConfigs[activeConfigName] ?? {
                mode: GenerationMode.NONE,
                duration: 0,
                streams: [],
                stream_settings: [],
                port_tx_rx_mapping: {},
                rtt_histogram_config: {},
                iat_histogram_config: {},
            }),
            mode: nextMode,
            duration: 0,
            streams: nextStreams,
            stream_settings: nextStreamSettings,
            port_tx_rx_mapping: {},
            rtt_histogram_config: {},
            iat_histogram_config: {},
        };

        setActiveDraftConfig(nextConfig);
    };

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
    const updateRTTHistogramSettings = (
        front_panel_port: number,
        channel: number,
        updated: HistogramConfig
    ) => {
        set_rtt_histogram_settings((prev: { [x: string]: any; }) => {
            const p = String(front_panel_port);
            const c = String(channel);
            const next: HistogramConfigMap = {
                ...prev,
                [p]: { ...(prev[p] ?? {}), [c]: updated },
            };
            localStorage.setItem("rtt_histogram_config", JSON.stringify(next));
            return next;
        });
    };

    // Update a single (rx_port, rx_channel)
    const updateIATHistogramSettings = (
        front_panel_port: number,
        channel: number,
        updated: HistogramConfig
    ) => {
        set_iat_histogram_settings((prev: { [x: string]: any; }) => {
            const p = String(front_panel_port);
            const c = String(channel);
            const next: HistogramConfigMap = {
                ...prev,
                [p]: { ...(prev[p] ?? {}), [c]: updated },
            };
            localStorage.setItem("iat_histogram_config", JSON.stringify(next));
            return next;
        });
    };

    const removeStream = (id: number) => {
        updateDraftState(
            streams.filter(v => v.stream_id != id),
            stream_settings.filter(v => v.stream_id != id)
        )
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
        const availablePairs: Array<[number, number]> = ports
            .filter(p => p.loopback === "BF_LPBK_NONE" || !!p4tg_infos.loopback)
            .map(p => [p.port, p.channel]);

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
                    def.mpls_stack = [];
                    for (let i = 0; i < s.number_of_lse; i++) def.mpls_stack.push(DefaultMPLSHeader());
                } else if (s.encapsulation === Encapsulation.SRv6) {
                    def.sid_list = [];
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
            const hc = t?.rtt_histogram_config;
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

            if (v.mode === GenerationMode.MPPS) {
                v.mode = GenerationMode.CBR;
                for (const s of v.streams) {
                    s.unit = GenerationUnit.Mpps;
                }
            }

            if (isLegacyTest(v)) {
                const port_tx_rx_mapping: PortTxRxMap = Object.fromEntries(
                    Object.entries(v.port_tx_rx_mapping ?? {}).map(([tx, rx]) => [
                        String(tx),
                        { "0": { port: Number(rx), channel: 0 } },
                    ])
                );
                const rtt_histogram_config = Object.fromEntries(
                    Object.entries(v.rtt_histogram_config ?? {}).map(([rp, cfg]) => [String(rp), { "0": cfg }])
                );
                const stream_settings: StreamSettings[] = (v.stream_settings ?? []).map((s: any) => ({
                    ...s, channel: s.channel ?? 0,
                }));
                out[k] = { ...v, port_tx_rx_mapping, rtt_histogram_config, stream_settings };
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

            let toastMessage;
            let toastType;
            for (const [cfgName, cfg] of Object.entries(migrated_config)) {
                const normalized = normalizeStreamsForFrontend(cfg, p4tg_infos.asic);
                migrated_config[cfgName] = normalized.config;
                if (normalized.warning) {
                    toastMessage = normalized.warning;
                    toastType = "warning" as ToastVariant;
                }

                if (p4tg_infos.asic === ASIC.Tofino1 && Array.isArray(cfg.stream_settings)) {
                    const normalizedSettings = normalizeTofino1StreamSettings(cfg.stream_settings);
                    cfg.stream_settings = normalizedSettings.stream_settings;
                    if (normalizedSettings.warning) {
                        toastMessage = normalizedSettings.warning;
                        toastType = "warning" as ToastVariant;
                    }
                }
            }

            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(migrated_config))

            const first_test = Object.values(migrated_config)[0];

            localStorage.setItem("streams", JSON.stringify(first_test.streams))
            localStorage.setItem("gen-mode", String(first_test.mode))
            localStorage.setItem("duration", first_test.duration ? String(first_test.duration) : "0")
            localStorage.setItem("streamSettings", JSON.stringify(first_test.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(first_test.port_tx_rx_mapping))
            localStorage.setItem("rtt_histogram_config", first_test.rtt_histogram_config ? JSON.stringify(first_test.rtt_histogram_config) : "{}")

            if (toastMessage !== undefined && toastType !== undefined) {
                showToast(toastMessage, toastType);
            } else {
                showToast("Settings imported successfully.", "success")
            }

        }
    }


    const handleRenameTab = (oldName: string, newName: string) => {
        const trimmed = newName.trim();

        if (!trimmed) {
            showToast("Name already exists or is invalid.", "warning");
            return;
        }
        if (trimmed === oldName) {
            setRenamingTab(null);
            setRenameValue("");
            return;
        }
        if (savedConfigs[trimmed]) {
            showToast("Name already exists or is invalid.", "warning");
            return;
        }
        // Rename in savedConfigs
        const updatedConfigs: Record<string, TrafficGenData> = {};
        Object.entries(savedConfigs).forEach(([k, v]) => {
            if (k === oldName) {
                updatedConfigs[trimmed] = v;
            } else {
                updatedConfigs[k] = v;
            }
        });
        setSavedConfigs(updatedConfigs);
        localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(updatedConfigs));
        setActiveConfigName(trimmed);
        setRenamingTab(null);
        setRenameValue("");
    };


    fillPortsOnMissingSetting(streams, stream_settings);
    const totalRate = getTotalActiveStreamRate(streams, stream_settings);
    const maxRate = p4tg_infos.asic === ASIC.Tofino1 ? 100 : 400;
    const rateExceeded = totalRate > maxRate;

    const patternSrc = (name: string, variant: "light" | "dark") =>
        `${process.env.PUBLIC_URL}/patterns/${name}_${variant}.png`;
    const patternNames = ["sine", "sawtooth", "triangle", "square", "flashcrowd"];

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
                            style={{ userSelect: "none" }}
                        >
                            {renamingTab === name ? (
                                <Form
                                    style={{ display: "inline-flex", alignItems: "center" }}
                                    onSubmit={e => {
                                        e.preventDefault();
                                        e.stopPropagation();
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
                                        style={{ width: "90px", display: "inline-block", marginRight: "4px", padding: "0px 4px" }}
                                        disabled={running}
                                        // This line is required to enable spaces in input
                                        onKeyDown={e => e.stopPropagation()}
                                    />
                                    {/* Rename Button */}
                                    <Button
                                        type="button"
                                        size="sm"
                                        variant="outline-success"
                                        disabled={running}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            if (renameValue.length > 20) {
                                                showToast("Name too long (max 20 characters).", "warning");
                                                return;
                                            }
                                            handleRenameTab(name, renameValue);
                                        }}
                                        style={{
                                            padding: "0px",
                                            borderWidth: "1px",
                                            width: "28px",
                                            height: "20px",
                                            display: "flex",
                                            justifyContent: "center",
                                            alignItems: "center",
                                            marginLeft: "4px"
                                        }}
                                        title="Save name"
                                    >
                                        <i className="bi bi-check" />
                                    </Button>
                                </Form>
                            ) : (
                                <>
                                    {name}
                                    {/* Save name Button */}
                                    <div style={{ display: "inline-flex", alignItems: "center", marginLeft: "5px", gap: "4px" }}>
                                        <Button
                                            size="sm"
                                            disabled={running}
                                            variant="outline-secondary"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setRenamingTab(name);
                                                setRenameValue(name);
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
                                            title="Rename Test"
                                        >
                                            <i className="bi bi-pencil" />
                                        </Button>
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
                                    rtt_histogram_config: {},
                                    iat_histogram_config: {}
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
                {lastDeletedConfig && (
                    <Nav.Item>
                        <Button
                            size="sm"
                            onClick={(e) => {
                                e.stopPropagation();
                                restoreDeletedConfig();
                            }}
                            variant="outline-secondary"
                            disabled={running}
                            style={{ marginLeft: "10px", marginTop: "0px" }}
                            title="Restore last deleted test"
                        >
                            <i className="bi bi-arrow-counterclockwise" />
                        </Button>
                    </Nav.Item>
                )}
            </Nav>

            <Tab.Content>
                {Object.keys(savedConfigs).map((name) => (
                    <Tab.Pane eventKey={name} key={name}>
                        <Row className={"align-items-center"}>

                            <Col className={"col-2"}>
                                <Form.Select
                                    disabled={running}
                                    required
                                    value={mode}
                                    onChange={(event: React.ChangeEvent<HTMLSelectElement>) => {
                                        handleModeChange(parseInt(event.target.value));
                                    }}
                                >
                                    <option value={GenerationMode.NONE}>Generation Mode</option>
                                    <option value={GenerationMode.CBR}>CBR</option>
                                    <option value={GenerationMode.POISSON}>Poisson</option>
                                    <option value={GenerationMode.ANALYZE}>Monitor</option>
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
                                <Button onClick={exportSettings} variant={"danger"}>
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
                                                <th className="text-nowrap">
                                                    {/* fixed slot for the warning icon (keeps layout stable) */}
                                                    <span
                                                        className="d-inline-flex justify-content-center align-items-center me-1"
                                                        style={{ width: 18, height: 18 }}
                                                    >
                                                        {rateExceeded ? (
                                                            <OverlayTrigger
                                                                placement="top"
                                                                overlay={(props) =>
                                                                    renderTooltip(
                                                                        props,
                                                                        `Total rate of active streams (${totalRate} Gb/s) exceeds the maximum rate of ${maxRate} Gb/s.`
                                                                    )
                                                                }
                                                            >
                                                                <span role="img" aria-label="Warning" style={{ lineHeight: 1 }}>
                                                                    ⚠️
                                                                </span>
                                                            </OverlayTrigger>
                                                        ) : (
                                                            <span aria-hidden="true" style={{ visibility: "hidden" }}>⚠️</span>
                                                        )}
                                                    </span>

                                                    Rate
                                                </th>
                                                <th>Pattern &nbsp;
                                                    <InfoBox>
                                                        <>
                                                            <h5>Pattern Generation</h5>

                                                            <p>With this setting, generated traffic will be shaped into a periodic pattern.
                                                                The maximum possible period depends on the packet rate and on the frame size.</p>

                                                            {patternNames.map((pattern) => (
                                                                <div key={pattern} style={{ marginBottom: "8px" }}>
                                                                    <h6 style={{ textTransform: "capitalize" }}>{pattern}</h6>
                                                                    <div>
                                                                        <img
                                                                            className="pattern-light"
                                                                            src={patternSrc(pattern, "light")}
                                                                            alt={`${pattern} pattern`}
                                                                            style={{ maxWidth: "100%" }}
                                                                        />
                                                                        <img
                                                                            className="pattern-dark"
                                                                            src={patternSrc(pattern, "dark")}
                                                                            alt={`${pattern} pattern`}
                                                                            style={{ maxWidth: "100%" }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            ))}

                                                        </>
                                                    </InfoBox>
                                                </th>
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
                                                <th>Tunneling &nbsp;
                                                    <InfoBox>
                                                        <p>Encapsulate packets using VxLAN (<a href={"https://datatracker.ietf.org/doc/html/rfc7348"} target="_blank">RFC
                                                            7348</a>) or GTP-U to add outer IP/UDP tunneling headers.
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
                        <Row className="mb-3">
                            <Col className="text-start">
                                {running ? null : (mode === GenerationMode.CBR) ? (
                                    (() => {
                                        const reachedMax = streams.length >= maxStreams;
                                        const reachedIMIXLimit = streams.length + IMIX_STREAM_COUNT > maxStreams;
                                        return (
                                            <>
                                                <OverlayTrigger
                                                    placement="top"
                                                    overlay={
                                                        reachedMax
                                                            ? (props) => renderTooltip(props, "Maximum number of streams reached")
                                                            : <></>
                                                    }
                                                >
                                                    <span className="d-inline-block me-2" tabIndex={0}>
                                                        <Button
                                                            disabled={reachedMax}
                                                            onClick={addStream}
                                                            variant="primary"
                                                            style={reachedMax ? { pointerEvents: "none" } : undefined}
                                                        >
                                                            <i className="bi bi-plus" /> Add stream
                                                        </Button>
                                                    </span>
                                                </OverlayTrigger>
                                                <OverlayTrigger
                                                    placement="top"
                                                    overlay={
                                                        reachedIMIXLimit
                                                            ? (props) => renderTooltip(props, `IMIX requires ${IMIX_STREAM_COUNT} free stream slots.`)
                                                            : <></>
                                                    }
                                                >
                                                    <span className="d-inline-block" tabIndex={0}>
                                                        <Button
                                                            disabled={reachedIMIXLimit}
                                                            onClick={() => setShowIMIXModal(true)}
                                                            variant="primary"
                                                            style={reachedIMIXLimit ? { pointerEvents: "none" } : undefined}
                                                        >
                                                            Add IMIX
                                                        </Button>
                                                    </span>
                                                </OverlayTrigger>
                                            </>
                                        );
                                    })()
                                ) : null}
                            </Col>
                        </Row>
                        <IMIXModal
                            show={showIMIXModal}
                            hide={() => setShowIMIXModal(false)}
                            onConfirm={addIMIXStreams}
                        />


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
                                                if (v.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback) {

                                                    const txKey = String(v.port);
                                                    const chKey = String(v.channel);
                                                    const current = port_tx_rx_mapping?.[txKey]?.[chKey];
                                                    const defaultValue = current ? `${current.port}/${current.channel}` : "-1";

                                                    const totalRate = getTotalRatePerPort(streams, stream_settings, v);
                                                    const speedExceeded = totalRate > speedToGbps(v.speed);

                                                    return (
                                                        <tr key={`${v.pid}`}>
                                                            <StyledCol className="align-items-center">
                                                                {/* fixed slot for the warning icon */}
                                                                <span
                                                                    className="d-inline-flex justify-content-center align-items-center me-2"
                                                                    style={{ width: 18, height: 18 }}
                                                                >
                                                                    {speedExceeded ? (
                                                                        <OverlayTrigger
                                                                            placement="top"
                                                                            overlay={(props) =>
                                                                                renderTooltip(
                                                                                    props,
                                                                                    `Total rate of enabled streams (${totalRate} Gb/s) exceeds line rate of this port (${speedToGbps(v.speed)} Gb/s)`
                                                                                )
                                                                            }
                                                                        >
                                                                            <span role="img" aria-label="Warning" style={{ lineHeight: 1 }}>
                                                                                ⚠️
                                                                            </span>
                                                                        </OverlayTrigger>
                                                                    ) : (
                                                                        // placeholder keeps the width; hidden from screen readers
                                                                        <span aria-hidden="true" style={{ visibility: "hidden" }}>⚠️</span>
                                                                    )}
                                                                </span>

                                                                <span className="me-2">
                                                                    <PortStatus active={v.status} />
                                                                </span>

                                                                <span>
                                                                    {v.port}/{v.channel} ({v.pid})
                                                                </span>
                                                            </StyledCol>


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
                                                                        if (p.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback) {
                                                                            const optionValue = `${p.port}/${p.channel}`;
                                                                            return (
                                                                                <option key={p.pid} value={optionValue}>
                                                                                    {p.port}/{p.channel} ({p.pid})
                                                                                </option>
                                                                            )
                                                                        };
                                                                    })}
                                                                </Form.Select>

                                                                <HistogramSettings port={v} mapping={port_tx_rx_mapping} disabled={running || !v.status} iat_data={iat_histogram_settings} rtt_data={rtt_histogram_settings} set_rtt_data={updateRTTHistogramSettings} set_iat_data={updateIATHistogramSettings} />
                                                            </StyledCol>

                                                            <StreamSettingsList
                                                                stream_settings={stream_settings}
                                                                streams={streams}
                                                                running={running}
                                                                port={v}
                                                                p4tg_infos={p4tg_infos}
                                                            />
                                                        </tr>
                                                    )
                                                };
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
