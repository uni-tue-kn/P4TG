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
import { Alert, Button, Col, Form, InputGroup, Modal, Nav, OverlayTrigger, Row, Tab, Table, Tabs, ToggleButton, Tooltip } from "react-bootstrap";
import { get } from "../common/API";
import Loader from "../components/Loader";
import {
    ASIC,
    DetNetSeqNumLength,
    DefaultMPLSHeader,
    DefaultRfc2544Config,
    DefaultStream,
    DefaultStreamSettings,
    Encapsulation,
    GenerationMode, GenerationPattern, GenerationUnit, HistogramConfigMap, P4TGInfos,
    PortInfo,
    PortTxRxMap,
    HistogramConfig,
    MAX_DRAIN_DURATION_SECS,
    RFC2544_FRAME_SIZES,
    Rfc2544Config,
    RxMappingMode,
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
import { validateIPv6RandomMask, validatePorts, validateStreamRxTargets, validateStreams, validateStreamSettings } from "../common/Validators";
import HistogramSettings from '../components/settings/HistogramSettings';
import { PortStatus } from './Ports';
import { getTotalActiveStreamRate, getTotalRatePerPort, loadFromStorage } from '../common/Helper';
import IMIXModal from '../components/settings/IMIXModal';
import { IMIXConfig, IMIX_DESCRIPTION, IMIX_STREAM_COUNT, IMIX_STREAM_SPECS, RFC2544_IMIX_FRAME_SIZE, splitImixRate } from '../common/IMIX';
import { startPolling } from '../common/Polling';
import { migrateTrafficGenData } from '../common/StorageMigration';
import { expectedRoutes } from '../common/ExpectedRoutes';

export const StyledRow = styled.tr`
    display: flex;
    align-items: center;
`

export const StyledCol = styled.td`
    vertical-align: middle;
    display: table-cell;
    text-indent: 5px;
`

const Rfc2544Panel = styled.div`
    border: 2px solid var(--color-primary) !important;
`

const Rfc2544SettingsButton = styled(Button)`
    background-color: color-mix(in srgb, var(--color-primary) 80%, #000000);
    border-color: color-mix(in srgb, var(--color-primary) 80%, #000000);
    color: #ffffff;

    &:hover,
    &:focus-visible {
        background-color: color-mix(in srgb, var(--color-primary) 68%, #000000);
        border-color: color-mix(in srgb, var(--color-primary) 68%, #000000);
        color: #ffffff;
    }
`

const CONFIG_STORAGE_KEY = "saved_configs";
const DEFAULT_CONFIG_NAME = "Test 1";
const RUN_NAME_SUFFIX = /\s*\[\d+\/\d+\]$/;
const baseConfigName = (name: string) => name.replace(RUN_NAME_SUFFIX, "");
type Rfc2544NumericField = {
    [Key in keyof Rfc2544Config]: Rfc2544Config[Key] extends number ? Key : never
}[keyof Rfc2544Config];

const rfc2544NeedsThroughput = (config: Partial<Rfc2544Config>): boolean =>
    Boolean(config.latency || config.reset || config.system_recovery);

const enforceRfc2544ThroughputDependencies = (config: Rfc2544Config): Rfc2544Config =>
    rfc2544NeedsThroughput(config) ? { ...config, throughput: true } : config;

const normalizeRfc2544Config = (config?: Partial<Rfc2544Config>): Rfc2544Config => {
    const defaults = DefaultRfc2544Config();
    return enforceRfc2544ThroughputDependencies({
        ...defaults,
        ...(config ?? {}),
        throughput_loss_tolerance: {
            ...defaults.throughput_loss_tolerance,
            ...(config?.throughput_loss_tolerance ?? {}),
        },
    });
};

const patternSupportsInverted = (patternType: GenerationPattern): boolean =>
    patternType === GenerationPattern.Square || patternType === GenerationPattern.Sawtooth;

const normalizeStreamsForFrontend = (
    config: TrafficGenData,
    asic: ASIC,
): { config: TrafficGenData; warning?: string } => {
    const migratedConfig = migrateTrafficGenData(config) ?? config;
    const streams = (migratedConfig.streams ?? []).map((stream) => ({ ...stream }));

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
            ...migratedConfig,
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
    const [streams, set_streams] = useState<Stream[]>(loadFromStorage<Stream[]>("streams", []))
    const [stream_settings, set_stream_settings] = useState<StreamSettings[]>(loadFromStorage<StreamSettings[]>("streamSettings", []))
    const [rtt_histogram_settings, set_rtt_histogram_settings] = useState<HistogramConfigMap>(loadFromStorage<HistogramConfigMap>("rtt_histogram_config", {}))
    const [iat_histogram_settings, set_iat_histogram_settings] = useState<HistogramConfigMap>(loadFromStorage<HistogramConfigMap>("iat_histogram_config", {}))
    const [rfc2544_config, set_rfc2544_config] = useState<Rfc2544Config>(
        normalizeRfc2544Config(loadFromStorage<Rfc2544Config | null>("rfc2544_config", null) || undefined)
    )
    const [rfc2544NumericInputs, setRfc2544NumericInputs] = useState<Partial<Record<Rfc2544NumericField, string>>>({});
    const [rfc2544LossToleranceInput, setRfc2544LossToleranceInput] = useState<string | null>(null);

    const [port_tx_rx_mapping, set_port_tx_rx_mapping] = useState<PortTxRxMap>(loadFromStorage<PortTxRxMap>("port_tx_rx_mapping", {}))
    const [rx_mapping_mode, set_rx_mapping_mode] = useState<RxMappingMode>(
        loadFromStorage<RxMappingMode>("rx_mapping_mode", RxMappingMode.PerTxPort)
    )

    const configuredRoutes = expectedRoutes(rx_mapping_mode, port_tx_rx_mapping, streams, stream_settings);
    const sequenceMetricsWarning = "Packet loss and out-of-order tracking works per physical port. These counters are unreliable when one TX is split across RX ports or several TX ports feed one RX port, and will be hidden in the result view.";
    const rxTargetsByTx = new Map<string, Set<string>>();
    const txSourcesByRx = new Map<string, Set<string>>();
    configuredRoutes.forEach(({ txPort, txChannel, rxPort, rxChannel }) => {
        const tx = `${txPort}/${txChannel}`;
        const rx = `${rxPort}/${rxChannel}`;
        if (!rxTargetsByTx.has(tx)) rxTargetsByTx.set(tx, new Set());
        if (!txSourcesByRx.has(rx)) txSourcesByRx.set(rx, new Set());
        rxTargetsByTx.get(tx)!.add(rx);
        txSourcesByRx.get(rx)!.add(tx);
    });
    const sequenceMetricAffectedTxPorts = new Set(configuredRoutes
        .filter(({ txPort, txChannel, rxPort, rxChannel }) =>
            (rxTargetsByTx.get(`${txPort}/${txChannel}`)?.size ?? 0) > 1
            || (txSourcesByRx.get(`${rxPort}/${rxChannel}`)?.size ?? 0) > 1)
        .map(({ txPort, txChannel }) => `${txPort}/${txChannel}`));

    const [mode, set_mode] = useState(parseInt(localStorage.getItem("gen-mode") || String(GenerationMode.NONE)))
    const [duration, set_duration] = useState(parseInt(localStorage.getItem("duration") || String(0)))
    const [drain_duration_secs, set_drain_duration_secs] = useState(() => {
        const stored = Number(localStorage.getItem("drain_duration_secs") ?? 0);
        return Number.isInteger(stored) && stored >= 0
            ? Math.min(stored, MAX_DRAIN_DURATION_SECS)
            : 0;
    })
    const [repetitions, set_repetitions] = useState(() => {
        const storedRepetitions = parseInt(localStorage.getItem("repetitions") || String(1));
        return Number.isInteger(storedRepetitions) && storedRepetitions > 0 ? storedRepetitions : 1;
    })
    const [repetitionsInput, setRepetitionsInput] = useState(String(repetitions))
    const [loaded, set_loaded] = useState(false)
    const ref = useRef<HTMLInputElement>(null)
    const streamsRef = useRef<Stream[]>(streams);
    const rxMappingModeRef = useRef<RxMappingMode>(rx_mapping_mode);
    const loadGenWarningRef = useRef<string | null>(null);
    const activeConfigNameRef = useRef<string>(DEFAULT_CONFIG_NAME);
    const savedConfigsRef = useRef<Record<string, TrafficGenData>>({});
    // The backend test name identifies the only tab that may display live
    // runtime state. Other tabs always keep their saved drafts.
    const liveConfigDisplayedForRef = useRef<string | null>(null);

    const [savedConfigs, setSavedConfigs] = useState<Record<string, TrafficGenData>>({});
    const [activeConfigName, setActiveConfigName] = useState<string>(DEFAULT_CONFIG_NAME);

    const [renamingTab, setRenamingTab] = useState<string | null>(null);
    const [renameValue, setRenameValue] = useState<string>("");
    const [lastDeletedConfig, setLastDeletedConfig] = useState<{ name: string; config: TrafficGenData; index: number } | null>(null);
    const [showIMIXModal, setShowIMIXModal] = useState(false);
    const [showRfc2544Modal, setShowRfc2544Modal] = useState(false);

    const maxStreams = p4tg_infos.asic === ASIC.Tofino1 ? 7 : 15;

    const renderTooltip = (props: any, message: string) => (
        <Tooltip id="tooltip-disabled" {...props}>
            {message}
        </Tooltip>
    );

    const eligiblePorts = ports.filter((port) => port.loopback == "BF_LPBK_NONE" || p4tg_infos.loopback);

    // A TX port that sends traffic without an RX port assigned still generates
    // traffic, but nothing measures it. Flag the RX selection in that case.
    const hasActiveStream = (port: PortInfo) => stream_settings.some((setting) =>
        setting.active && setting.port === port.port && setting.channel === port.channel);

    const setActiveDraftConfig = (config: TrafficGenData) => {
        set_streams(config.streams);
        set_stream_settings(config.stream_settings);
        set_mode(config.mode);
        set_duration(config.duration);
        set_repetitions(config.repetitions);
        set_drain_duration_secs(config.drain_duration_secs ?? 0);
        set_port_tx_rx_mapping(config.port_tx_rx_mapping);
        set_rx_mapping_mode(config.rx_mapping_mode ?? RxMappingMode.PerTxPort);
        set_rtt_histogram_settings(config.rtt_histogram_config);
        set_iat_histogram_settings(config.iat_histogram_config);
        set_rfc2544_config(normalizeRfc2544Config(config.rfc2544));

        localStorage.setItem("streams", JSON.stringify(config.streams));
        localStorage.setItem("streamSettings", JSON.stringify(config.stream_settings));
        localStorage.setItem("gen-mode", String(config.mode));
        localStorage.setItem("duration", String(config.duration));
        localStorage.setItem("repetitions", String(config.repetitions));
        localStorage.setItem("drain_duration_secs", String(config.drain_duration_secs ?? 0));
        localStorage.setItem("port_tx_rx_mapping", JSON.stringify(config.port_tx_rx_mapping));
        localStorage.setItem("rx_mapping_mode", JSON.stringify(config.rx_mapping_mode ?? RxMappingMode.PerTxPort));
        localStorage.setItem("rtt_histogram_config", JSON.stringify(config.rtt_histogram_config));
        localStorage.setItem("iat_histogram_config", JSON.stringify(config.iat_histogram_config));
        localStorage.setItem("rfc2544_config", JSON.stringify(normalizeRfc2544Config(config.rfc2544)));

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
                rx_mapping_mode: RxMappingMode.PerTxPort,
                duration: 0,
                repetitions: 1,
                streams: [],
                stream_settings: [],
                port_tx_rx_mapping: {},
                rtt_histogram_config: {},
                iat_histogram_config: {},
                rfc2544: mode === GenerationMode.RFC2544 ? rfc2544_config : undefined,
            }),
            streams: nextStreams,
            stream_settings: nextStreamSettings,
            mode,
            rx_mapping_mode,
            duration,
            repetitions,
            drain_duration_secs,
            port_tx_rx_mapping,
            rtt_histogram_config: rtt_histogram_settings,
            iat_histogram_config: iat_histogram_settings,
            rfc2544: mode === GenerationMode.RFC2544 ? rfc2544_config : undefined,
        };

        setActiveDraftConfig(nextConfig);
    };

    const updateStreamSetting = (
        target: StreamSettings,
        updates: Partial<Pick<StreamSettings, "active" | "rx_target">>,
    ) => {
        set_stream_settings((current) => current.map((setting) =>
            setting.port === target.port
                && setting.channel === target.channel
                && setting.stream_id === target.stream_id
                ? { ...setting, ...updates }
                : setting
        ));
    };

    const changeRxMappingMode = (nextMode: RxMappingMode) => {
        if (nextMode === RxMappingMode.PerStream) {
            set_stream_settings((current) => current.map((setting) => {
                if (setting.rx_target) return setting;
                const target = port_tx_rx_mapping?.[String(setting.port)]?.[String(setting.channel)];
                return target ? { ...setting, rx_target: { ...target } } : setting;
            }));
        }
        set_rx_mapping_mode(nextMode);
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
                const configs = savedConfigsRef.current;
                const backendName = typeof stats.data.source_name === "string"
                    ? stats.data.source_name
                    : typeof stats.data.name === "string"
                        ? baseConfigName(stats.data.name)
                        : null;
                const configNames = Object.keys(configs);
                const runningConfigName = backendName && configs[backendName]
                    ? backendName
                    : configNames.length === 1
                        ? configNames[0]
                        : null;
                // Only the tab identified by the backend test name displays
                // live state. Every other tab continues to show its saved draft.
                const viewing_running_config = runningConfigName !== null
                    && runningConfigName === activeConfigNameRef.current;
                const runningDraftStreams = runningConfigName
                    ? configs[runningConfigName]?.streams ?? currentStreams
                    : currentStreams;
                const mergedStreams = (stats.data.streams ?? []).map((streamFromBackend: Stream) => {
                    const existing = runningDraftStreams.find((stream) => stream.stream_id === streamFromBackend.stream_id);
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
                const backendRxMappingMode = normalized.config.rx_mapping_mode ?? RxMappingMode.PerTxPort;

                if (viewing_running_config && rxMappingModeRef.current !== backendRxMappingMode) {
                    rxMappingModeRef.current = backendRxMappingMode;
                    set_rx_mapping_mode(backendRxMappingMode);
                    localStorage.setItem("rx_mapping_mode", JSON.stringify(backendRxMappingMode));
                }

                if (viewing_running_config) {
                    set_mode(normalized.config.mode)
                    set_duration(normalized.config.duration)
                    set_repetitions(normalized.config.repetitions)
                    set_drain_duration_secs(normalized.config.drain_duration_secs ?? 0)
                    set_port_tx_rx_mapping(normalized.config.port_tx_rx_mapping)
                    set_stream_settings(normalized.config.stream_settings)
                    set_streams(nextStreams)
                    set_rtt_histogram_settings(normalized.config.rtt_histogram_config)
                    set_iat_histogram_settings(normalized.config.iat_histogram_config)
                    set_rfc2544_config(normalizeRfc2544Config(normalized.config.rfc2544))

                    localStorage.setItem("streams", JSON.stringify(nextStreams))
                    localStorage.setItem("gen-mode", String(normalized.config.mode))
                    localStorage.setItem("duration", String(normalized.config.duration ?? 0))
                    localStorage.setItem("repetitions", String(normalized.config.repetitions ?? 1))
                    localStorage.setItem("drain_duration_secs", String(normalized.config.drain_duration_secs ?? 0))
                    localStorage.setItem("streamSettings", JSON.stringify(normalized.config.stream_settings))
                    localStorage.setItem("port_tx_rx_mapping", JSON.stringify(normalized.config.port_tx_rx_mapping))
                    localStorage.setItem("rtt_histogram_config", JSON.stringify(normalized.config.rtt_histogram_config))
                    localStorage.setItem("iat_histogram_config", JSON.stringify(normalized.config.iat_histogram_config))
                    localStorage.setItem("rfc2544_config", JSON.stringify(normalizeRfc2544Config(normalized.config.rfc2544)))
                    liveConfigDisplayedForRef.current = runningConfigName;
                } else if (!viewing_running_config && liveConfigDisplayedForRef.current !== null) {
                    const activeDraft = configs[activeConfigNameRef.current];
                    if (activeDraft) {
                        loadConfigToState(activeDraft);
                    }
                    liveConfigDisplayedForRef.current = null;
                }

                if (normalized.warning && loadGenWarningRef.current !== normalized.warning) {
                    showToast(normalized.warning, "warning");
                    loadGenWarningRef.current = normalized.warning;
                } else if (!normalized.warning) {
                    loadGenWarningRef.current = null;
                }
                set_running(true)
            } else {
                const activeDraft = savedConfigsRef.current[activeConfigNameRef.current];
                if (activeDraft && liveConfigDisplayedForRef.current !== null) {
                    loadConfigToState(activeDraft);
                }
                liveConfigDisplayedForRef.current = null;
                loadGenWarningRef.current = null;
                set_running(false)
            }
        }
    }

    useEffect(() => {
        streamsRef.current = streams;
    }, [streams]);

    useEffect(() => {
        rxMappingModeRef.current = rx_mapping_mode;
    }, [rx_mapping_mode]);

    useEffect(() => {
        activeConfigNameRef.current = activeConfigName;
    }, [activeConfigName]);

    useEffect(() => {
        savedConfigsRef.current = savedConfigs;
    }, [savedConfigs]);

    useEffect(() => {
        setRepetitionsInput(String(repetitions));
    }, [repetitions]);

    useEffect(() => {
        let disposed = false;
        let stopPolling = () => { };

        const initialize = async () => {
            await refresh();
            if (!disposed) {
                stopPolling = startPolling(loadGen, 2000);
            }
        };
        void initialize();

        return () => {
            disposed = true;
            stopPolling();
        }
    }, [])

    useEffect(() => {
        let configs = loadFromStorage<Record<string, TrafficGenData>>(CONFIG_STORAGE_KEY, {});
        let toastMessage;
        let toastType;

        configs = Object.fromEntries(
            Object.entries(configs).filter(([name, config]) =>
                !RUN_NAME_SUFFIX.test(name)
                && !((config as TrafficGenData).mode === GenerationMode.RFC2544 && /^RFC2544 \d+B$/.test(name))
            )
        );

        // If no configs, create default one
        if (Object.keys(configs).length === 0) {
            const defaultConfig: TrafficGenData = {
                mode: GenerationMode.NONE,
                rx_mapping_mode: RxMappingMode.PerTxPort,
                duration: 0,
                repetitions: 1,
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

        savedConfigsRef.current = configs;
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
        set_rx_mapping_mode(config.rx_mapping_mode ?? RxMappingMode.PerTxPort);
        set_duration(config.duration ?? 0);
        set_repetitions(config.repetitions ?? 1);
        set_drain_duration_secs(config.drain_duration_secs ?? 0);
        set_port_tx_rx_mapping(config.port_tx_rx_mapping || {});
        set_rtt_histogram_settings(config.rtt_histogram_config ?? {});
        set_iat_histogram_settings(config.iat_histogram_config ?? {});
        set_rfc2544_config(normalizeRfc2544Config(config.rfc2544));
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
                set_repetitions(1);
                set_drain_duration_secs(0);
                set_port_tx_rx_mapping({});
                set_rtt_histogram_settings({});
                set_iat_histogram_settings({});
                set_rfc2544_config(DefaultRfc2544Config());
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

        if (rx_mapping_mode === RxMappingMode.PerStream
            && stream_settings.some((setting) => setting.active && !setting.rx_target)) {
            showToast("Every active stream requires an RX port/channel in per-stream mapping mode.", "warning");
            return;
        }

        // Iterate histogram settings and remove any entry which key (port) is not a value in port_tx_rx_mapping
        // Build allowed (port/channel) set from mapping values
        const allowed = new Set(rx_mapping_mode === RxMappingMode.PerStream
            ? configuredRoutes.map((route) => `${route.rxPort}/${route.rxChannel}`)
            : Object.values(port_tx_rx_mapping ?? {}).flatMap(perCh =>
                Object.values(perCh ?? {}).map((t: any) => `${t.port}/${t.channel}`)
            ));

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
        localStorage.setItem("rx_mapping_mode", JSON.stringify(rx_mapping_mode))
        localStorage.setItem("duration", String(duration))
        localStorage.setItem("repetitions", String(repetitions))
        localStorage.setItem("drain_duration_secs", String(drain_duration_secs))
        localStorage.setItem("streamSettings", JSON.stringify(reconciledSettings))
        localStorage.setItem("rtt_histogram_config", JSON.stringify(filteredRTTHistogramSettings))
        localStorage.setItem("iat_histogram_config", JSON.stringify(filteredIATHistogramSettings))
        localStorage.setItem("port_tx_rx_mapping", JSON.stringify(port_tx_rx_mapping))
        localStorage.setItem("rfc2544_config", JSON.stringify(rfc2544_config))

        const newConfig: TrafficGenData = {
            streams: streams,
            mode: mode,
            rx_mapping_mode,
            duration: duration,
            repetitions: mode === GenerationMode.RFC2544 ? 1 : repetitions,
            drain_duration_secs,
            stream_settings: reconciledSettings,
            rtt_histogram_config: filteredRTTHistogramSettings,
            iat_histogram_config: filteredIATHistogramSettings,
            port_tx_rx_mapping: port_tx_rx_mapping,
            rfc2544: mode === GenerationMode.RFC2544 ? rfc2544_config : undefined,
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
        set_rfc2544_config(DefaultRfc2544Config())
        set_mode(GenerationMode.NONE)
        set_rx_mapping_mode(RxMappingMode.PerTxPort)
        set_duration(0)
        set_repetitions(1)
        set_drain_duration_secs(0)
        set_port_tx_rx_mapping({})

        const defaultConfig: TrafficGenData = {
            mode: GenerationMode.NONE,
            rx_mapping_mode: RxMappingMode.PerTxPort,
            duration: 0,
            repetitions: 1,
            drain_duration_secs: 0,
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
        const nextRfc2544 = nextMode === GenerationMode.RFC2544 ? rfc2544_config : undefined;

        const nextStreams = shouldCreateDefaultStream ? [DefaultStream(1)] : [];
        const nextStreamSettings = shouldCreateDefaultStream
            ? eligiblePorts.map((port) => DefaultStreamSettings(1, port.port, port.channel))
            : [];

        const nextConfig: TrafficGenData = {
            ...(savedConfigs[activeConfigName] ?? {
                mode: GenerationMode.NONE,
                rx_mapping_mode: RxMappingMode.PerTxPort,
                duration: 0,
                repetitions: 1,
                streams: [],
                stream_settings: [],
                port_tx_rx_mapping: {},
                rtt_histogram_config: {},
                iat_histogram_config: {},
            }),
            mode: nextMode,
            rx_mapping_mode: nextMode === GenerationMode.ANALYZE || nextMode === GenerationMode.RFC2544
                ? RxMappingMode.PerTxPort
                : rx_mapping_mode,
            duration: 0,
            repetitions: 1,
            drain_duration_secs,
            streams: nextStreams,
            stream_settings: nextStreamSettings,
            port_tx_rx_mapping: {},
            rtt_histogram_config: {},
            iat_histogram_config: {},
            rfc2544: nextRfc2544,
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
            ...structuredClone(original),
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

    const updateStream = (updated: Stream, updatedSettings: StreamSettings[]) => {
        updateDraftState(
            streams.map((stream) => stream.stream_id === updated.stream_id ? updated : stream),
            updatedSettings,
        );
    };

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
        return typeof val === 'object' && val !== null && !Array.isArray(val)
            && 'streams' in val && Array.isArray(val.streams)
            && 'stream_settings' in val && Array.isArray(val.stream_settings)
    }

    const loadSettings = (e: React.ChangeEvent<HTMLInputElement>) => {
        e.preventDefault()

        const file = e.target.files?.[0];
        e.target.value = "";
        if (!file) {
            showToast("No settings file selected.", "danger")
            return;
        }

        const fileReader = new FileReader();
        fileReader.readAsText(file, "UTF-8");

        fileReader.onload = (event) => {
            let data: unknown;
            try {
                if (typeof event.target?.result !== "string") {
                    throw new Error("FileReader returned non-text content");
                }
                data = JSON.parse(event.target.result);
            } catch {
                showToast("Could not parse file content. Please check the file.", "danger")
                return;
            }
            let new_config: Record<string, TrafficGenData> = {};

            const addConfig = (fallbackName: string, value: TrafficGenData) => {
                const importedName = typeof value.name === "string" && value.name.trim()
                    ? value.name.trim()
                    : fallbackName;
                new_config[importedName] = value;
            };

            if (Array.isArray(data)) {
                if (data.length === 0 || !data.every(isSingleTrafficGenData)) {
                    showToast("Settings file does not contain any valid configurations.", "danger")
                    return;
                }
                data.forEach((value, index) => addConfig(`Test ${index + 1}`, value));
            } else if (isSingleTrafficGenData(data)) {
                addConfig(DEFAULT_CONFIG_NAME, data);
            } else if (typeof data === "object" && data !== null) {
                const entries = Object.entries(data);
                if (entries.length === 0 || !entries.every(([, value]) => isSingleTrafficGenData(value))) {
                    showToast("Could not serialize file content. Please check the file.", "danger")
                    return;
                }
                entries.forEach(([name, value]) => addConfig(name, value as TrafficGenData));
            } else {
                showToast("Could not serialize file content. Please check the file.", "danger")
                return;
            }

            const migrated_config = migrateImportedConfig(new_config)
            if (Object.keys(migrated_config).length === 0) {
                showToast("Settings file does not contain any configurations.", "danger")
                return;
            }

            for (const [name, config] of Object.entries(migrated_config)) {
                if (!validateStreams(config.streams) || !validateStreamSettings(config.stream_settings)) {
                    showToast("Settings not valid for config " + name + ". Please check the file.", "danger")
                    return;
                } else if (config.rx_mapping_mode === RxMappingMode.PerStream
                    ? !validateStreamRxTargets(config.rx_mapping_mode, config.stream_settings, ports, p4tg_infos)
                    : !validatePorts(config.port_tx_rx_mapping, ports, p4tg_infos)) {
                    showToast("Settings not valid for config " + name + ". Configured front panel ports are not available on this device.", "danger")
                    return;
                }
            };

            let toastMessage;
            let toastType;
            for (const [cfgName, cfg] of Object.entries(migrated_config)) {
                const normalized = normalizeStreamsForFrontend(cfg, p4tg_infos.asic);
                if (normalized.warning) {
                    toastMessage = normalized.warning;
                    toastType = "warning" as ToastVariant;
                }

                if (p4tg_infos.asic === ASIC.Tofino1 && Array.isArray(normalized.config.stream_settings)) {
                    const normalizedSettings = normalizeTofino1StreamSettings(normalized.config.stream_settings);
                    normalized.config.stream_settings = normalizedSettings.stream_settings;
                    if (normalizedSettings.warning) {
                        toastMessage = normalizedSettings.warning;
                        toastType = "warning" as ToastVariant;
                    }
                }

                migrated_config[cfgName] = normalized.config;
            }

            localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(migrated_config))

            const firstEntry = Object.entries(migrated_config)[0];
            if (!firstEntry) {
                showToast("Settings file does not contain any configurations.", "danger")
                return;
            }
            const [first_name, first_test] = firstEntry;

            localStorage.setItem("streams", JSON.stringify(first_test.streams))
            localStorage.setItem("gen-mode", String(first_test.mode))
            localStorage.setItem("rx_mapping_mode", JSON.stringify(first_test.rx_mapping_mode ?? RxMappingMode.PerTxPort))
            localStorage.setItem("duration", first_test.duration ? String(first_test.duration) : "0")
            localStorage.setItem("repetitions", String(first_test.repetitions ?? 1))
            localStorage.setItem("drain_duration_secs", String(first_test.drain_duration_secs ?? 0))
            localStorage.setItem("streamSettings", JSON.stringify(first_test.stream_settings))
            localStorage.setItem("port_tx_rx_mapping", JSON.stringify(first_test.port_tx_rx_mapping))
            localStorage.setItem("rtt_histogram_config", first_test.rtt_histogram_config ? JSON.stringify(first_test.rtt_histogram_config) : "{}")
            localStorage.setItem("iat_histogram_config", first_test.iat_histogram_config ? JSON.stringify(first_test.iat_histogram_config) : "{}")
            localStorage.setItem("rfc2544_config", JSON.stringify(normalizeRfc2544Config(first_test.rfc2544)))

            setSavedConfigs(migrated_config);
            setActiveConfigName(first_name);
            loadConfigToState(first_test);

            if (toastMessage !== undefined && toastType !== undefined) {
                showToast(toastMessage, toastType);
            } else {
                showToast("Settings imported successfully.", "success")
            }

        }

        fileReader.onerror = () => {
            showToast("Could not read settings file.", "danger")
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
        `${import.meta.env.BASE_URL}patterns/${name}_${variant}.png`;
    const patternNames = ["sine", "sawtooth", "triangle", "square", "flashcrowd"];
    const rfc2544ThroughputRequired = rfc2544NeedsThroughput(rfc2544_config);
    const activeRfc2544TxChannels = new Set(
        stream_settings
            .filter((setting) => setting.active)
            .map((setting) => `${setting.port}/${setting.channel}`)
    );
    const rfc2544MappingCount = Object.entries(port_tx_rx_mapping ?? {}).reduce(
        (sum, [txPort, perChannel]) => sum + Object.keys(perChannel ?? {})
            .filter((txChannel) => activeRfc2544TxChannels.has(`${Number(txPort)}/${Number(txChannel)}`))
            .length,
        0
    );
    const selectedRfc2544Tests = [
        rfc2544_config.throughput ? "Throughput" : null,
        rfc2544_config.latency ? "Latency" : null,
        rfc2544_config.frame_loss ? "Frame loss" : null,
        rfc2544_config.reset ? "Reset" : null,
        rfc2544_config.system_recovery ? "System recovery" : null,
    ].filter((value): value is string => value !== null);
    const rfc2544FixedFrameSizeCount = rfc2544_config.frame_sizes.filter((frameSize) => frameSize !== RFC2544_IMIX_FRAME_SIZE).length;
    const rfc2544IMIXSelected = rfc2544_config.frame_sizes.includes(RFC2544_IMIX_FRAME_SIZE);
    const rfc2544FrameSizeSummary = [
        rfc2544FixedFrameSizeCount === RFC2544_FRAME_SIZES.length
            ? "All RFC sizes"
            : rfc2544FixedFrameSizeCount > 0 ? `${rfc2544FixedFrameSizeCount} fixed` : null,
        rfc2544IMIXSelected ? "IMIX (ZLT)" : null,
    ].filter((value): value is string => value !== null).join(" + ") || "None selected";
    const rfc2544MappingSummary = rfc2544MappingCount > 1
        ? `${rfc2544MappingCount} mappings, serial`
        : `${rfc2544MappingCount || 0} mapping`;

    const updateRfc2544Config = (updates: Partial<Rfc2544Config>) => {
        set_rfc2544_config((prev) => enforceRfc2544ThroughputDependencies({ ...prev, ...updates }));
    };

    const rfc2544NumericValue = (field: Rfc2544NumericField): string | number =>
        rfc2544NumericInputs[field] ?? rfc2544_config[field];

    const updateRfc2544NumericInput = (field: Rfc2544NumericField, value: string) => {
        setRfc2544NumericInputs((prev) => ({ ...prev, [field]: value }));

        if (value !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                updateRfc2544Config({ [field]: parsed } as Partial<Rfc2544Config>);
            }
        }
    };

    const finishRfc2544NumericInput = (field: Rfc2544NumericField) => {
        setRfc2544NumericInputs((prev) => {
            const next = { ...prev };
            delete next[field];
            return next;
        });
    };

    const updateRfc2544LossToleranceInput = (value: string) => {
        setRfc2544LossToleranceInput(value);

        if (value !== "") {
            const parsed = Number(value);
            if (Number.isFinite(parsed)) {
                updateRfc2544Config({
                    throughput_loss_tolerance: {
                        ...rfc2544_config.throughput_loss_tolerance,
                        value: parsed,
                    },
                });
            }
        }
    };

    const setRfc2544ModalVisibility = (show: boolean) => {
        setRfc2544NumericInputs({});
        setRfc2544LossToleranceInput(null);
        setShowRfc2544Modal(show);
    };

    const toggleRfc2544FrameSize = (frameSize: number, checked: boolean) => {
        set_rfc2544_config((prev) => {
            const nextFrameSizes = checked
                ? Array.from(new Set([...prev.frame_sizes, frameSize])).sort((a, b) => {
                    if (a === b) return 0;
                    if (a === RFC2544_IMIX_FRAME_SIZE) return 1;
                    if (b === RFC2544_IMIX_FRAME_SIZE) return -1;
                    return a - b;
                })
                : prev.frame_sizes.filter((value) => value !== frameSize);
            return { ...prev, frame_sizes: nextFrameSizes };
        });
    };
    const rfc2544HoverLabel = (label: string, message: string) => (
        <OverlayTrigger placement="top" overlay={(props) => renderTooltip(props, message)}>
            <span style={{ cursor: "help" }}>{label}</span>
        </OverlayTrigger>
    );

    // @ts-ignore
    return <Loader loaded={loaded}>

        <Tab.Container activeKey={activeConfigName} onSelect={(k) => {
            if (!running) {
                save();
            }
            if (k) setActiveConfigName(k);
        }}>
            <Nav variant="tabs">
                {Object.keys(savedConfigs).map((name) => (
                    <Nav.Item key={name}>
                        <Nav.Link
                            eventKey={name}
                            active={activeConfigName === name}
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
                                    rx_mapping_mode: RxMappingMode.PerTxPort,
                                    duration: 0,
                                    repetitions: 1,
                                    drain_duration_secs: 0,
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
                                    <option value={GenerationMode.RFC2544}>RFC2544</option>
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

                                        <h5>RFC2544</h5>

                                        <p>RFC2544 mode orchestrates throughput, latency, reset time, and frame loss trials with the configured stream as packet template.</p>

                                    </>
                                </InfoBox>
                            </Col>

                            <Col className={"col-auto d-flex align-items-center gap-2"}>
                                <div className="text-nowrap">
                                    <span>Drain duration </span>
                                    <InfoBox>
                                        <>
                                            <h5>Drain duration</h5>
                                            <p>Packet generation stops immediately, while the receive measurement path remains active for this many seconds so in-flight or reordered packets can still update the final statistics. This happens before any idle cooldown. A value of 0 disables draining; the maximum is {MAX_DRAIN_DURATION_SECS} seconds.</p>
                                        </>
                                    </InfoBox>
                                </div>
                                <Form.Control
                                    className={"text-start"}
                                    style={{ width: "6rem" }}
                                    value={drain_duration_secs}
                                    onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                                        const parsed = Number(event.target.value);
                                        if (Number.isInteger(parsed) && parsed >= 0 && parsed <= MAX_DRAIN_DURATION_SECS) {
                                            set_drain_duration_secs(parsed);
                                        }
                                    }}
                                    min={0}
                                    max={MAX_DRAIN_DURATION_SECS}
                                    step={1}
                                    disabled={running}
                                    type={"number"}
                                    aria-label={"Drain duration in seconds"}
                                />
                            </Col>

                            {mode !== GenerationMode.RFC2544 ?
                                <>
                                    <Col className={"col-auto d-flex align-items-center gap-2"}>
                                        <div className="text-nowrap">
                                            <span>Test duration     </span>
                                            <InfoBox>
                                                <>
                                                    <h5>Test duration</h5>

                                                    <p>If a test duration (in seconds) is specified, traffic generation will automatically stop after the duration is exceeded. A value of 0 indicates generation of infinite duration.</p>
                                                </>
                                            </InfoBox>
                                        </div>
                                        <Form.Control className={"text-start"}
                                            style={{ width: "8rem" }}
                                            onChange={(event: any) => set_duration(parseInt(event.target.value))}
                                            min={0}
                                            step={1}
                                            placeholder={duration > 0 ? String(duration) + " s" : "∞ s"}
                                            disabled={running} type={"number"} />
                                    </Col>
                                    <Col className={"col-auto d-flex align-items-center gap-2"}>
                                        <div className="text-nowrap">
                                            <span>Repetitions     </span>
                                            <InfoBox>
                                                <>
                                                    <h5>Repetitions</h5>

                                                    <p>Number of times this test is executed. Each repetition drains and then waits for the 3-second idle cooldown before the next run begins. Repeated tests require a finite test duration.</p>
                                                </>
                                            </InfoBox>
                                        </div>
                                        <Form.Control
                                            className={"text-start"}
                                            style={{ width: "6rem" }}
                                            value={repetitionsInput}
                                            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                                                const value = event.target.value;
                                                setRepetitionsInput(value);

                                                const parsed = Number(value);
                                                if (Number.isInteger(parsed) && parsed >= 1) {
                                                    set_repetitions(parsed);
                                                }
                                            }}
                                            onBlur={() => {
                                                const parsed = Number(repetitionsInput);
                                                const normalized = Number.isInteger(parsed) && parsed >= 1 ? parsed : 1;
                                                set_repetitions(normalized);
                                                setRepetitionsInput(String(normalized));
                                            }}
                                            min={1}
                                            step={1}
                                            disabled={running}
                                            type={"number"}
                                        />
                                    </Col>
                                </>
                                : null}
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
                        {mode === GenerationMode.RFC2544 ?
                            <>
                                <Row className="mt-3 mb-2 g-2 align-items-center">
                                    <Col className="col-12">
                                        <Rfc2544Panel className="rounded p-3">
                                            <div className="d-flex flex-wrap align-items-center gap-2">
                                                <i className="bi bi-clipboard-data fs-5" />
                                                <h4 className="mb-0">RFC2544 benchmark</h4>
                                                <InfoBox>
                                                    <>
                                                        <h5>RFC2544 benchmark</h5>
                                                        <p>P4TG runs the selected RFC2544 procedures using the configured stream/header template and TX/RX mapping.</p>
                                                        <p>If multiple TX/RX mappings are enabled for active tests, the full RFC2544 sequence runs serially for each mapping and results are reported per mapping.</p>
                                                    </>
                                                </InfoBox>
                                            </div>
                                            <div className="small text-muted mt-1">
                                                {rfc2544MappingCount > 1
                                                    ? `RFC2544 will run ${rfc2544MappingCount} active TX/RX mappings serially.`
                                                    : "RFC2544 results are reported per active TX/RX mapping."}
                                            </div>

                                            <Row className="g-2 mt-2">
                                                <Col className="col-12 col-md-6 col-xl">
                                                    <div className="border rounded p-2 h-100">
                                                        <div className="small fw-semibold text-muted">Tests</div>
                                                        <div>{selectedRfc2544Tests.length > 0 ? selectedRfc2544Tests.join(", ") : "None selected"}</div>
                                                    </div>
                                                </Col>
                                                <Col className="col-12 col-sm-4 col-xl">
                                                    <div className="border rounded p-2 h-100">
                                                        <div className="small fw-semibold text-muted">Frame sizes</div>
                                                        <div>{rfc2544FrameSizeSummary}</div>
                                                    </div>
                                                </Col>
                                                <Col className="col-12 col-sm-4 col-xl">
                                                    <div className="border rounded p-2 h-100">
                                                        <div className="small fw-semibold text-muted">Line rate</div>
                                                        <div>{rfc2544_config.line_rate_gbps} Gbit/s</div>
                                                    </div>
                                                </Col>
                                                <Col className="col-12 col-sm-4 col-xl">
                                                    <div className="border rounded p-2 h-100">
                                                        <div className="small fw-semibold text-muted">TX/RX mappings</div>
                                                        <div>{rfc2544MappingSummary}</div>
                                                    </div>
                                                </Col>
                                                <Col className="col-12 col-xl-auto d-grid">
                                                    <Rfc2544SettingsButton onClick={() => setRfc2544ModalVisibility(true)}>
                                                        <i className="bi bi-sliders" /> RFC2544 settings
                                                    </Rfc2544SettingsButton>
                                                </Col>
                                            </Row>
                                        </Rfc2544Panel>
                                    </Col>
                                </Row>

                                <Modal show={showRfc2544Modal} onHide={() => setRfc2544ModalVisibility(false)} size="lg" centered scrollable>
                                    <Modal.Header closeButton>
                                        <Modal.Title>RFC2544 settings</Modal.Title>
                                    </Modal.Header>
                                    <Modal.Body>
                                        <Tabs defaultActiveKey="tests" className="mb-3">
                                            <Tab eventKey="tests" title="Tests">
                                                <div className="fw-semibold mb-2">
                                                    RFC2544 Tests&nbsp;
                                                    <InfoBox>
                                                        <>
                                                            <h5>RFC2544 Tests</h5>
                                                            <p>Select the benchmark procedures to orchestrate. Latency, reset, and system recovery use the zero-loss throughput rate for the selected frame size.</p>
                                                            <p>If multiple TX/RX mappings are enabled for active tests, P4TG runs the full RFC2544 sequence serially for each mapping and reports results per mapping.</p>
                                                        </>
                                                    </InfoBox>
                                                </div>
                                                <div className="small text-muted mb-3">
                                                    {rfc2544MappingCount > 1
                                                        ? `${rfc2544MappingCount} active TX/RX mappings. RFC2544 will run them serially.`
                                                        : "RFC2544 results are reported per active TX/RX mapping."}
                                                </div>
                                                <div className="d-grid gap-2">
                                                    <Form.Check
                                                        type="checkbox"
                                                        label={rfc2544HoverLabel("Zero loss throughput", "Finds the highest offered rate for each frame size and mapping where no frame loss is observed. Required by latency, reset time, and system recovery.")}
                                                        checked={rfc2544_config.throughput}
                                                        disabled={running || rfc2544ThroughputRequired}
                                                        onChange={(event) => updateRfc2544Config({
                                                            throughput: event.target.checked,
                                                            frame_sizes: event.target.checked
                                                                ? rfc2544_config.frame_sizes
                                                                : rfc2544_config.frame_sizes.filter((frameSize) => frameSize !== RFC2544_IMIX_FRAME_SIZE),
                                                        })}
                                                    />
                                                    {rfc2544ThroughputRequired ?
                                                        <div className="small text-muted">Required by latency, reset time, or system recovery.</div>
                                                        : null}
                                                    <Form.Check
                                                        type="checkbox"
                                                        label={rfc2544HoverLabel("Latency", "Runs traffic at the zero-loss throughput rate and reports P4TG RTT/2 latency samples for each frame size and mapping.")}
                                                        checked={rfc2544_config.latency}
                                                        disabled={running}
                                                        onChange={(event) => updateRfc2544Config({ latency: event.target.checked })}
                                                    />
                                                    <Form.Check
                                                        type="checkbox"
                                                        label={rfc2544HoverLabel("Frame loss rate", "Measures loss at 100%, 90%, 80%, and lower offered rates until two successive no-loss trials or the RFC2544 step limit is reached.")}
                                                        checked={rfc2544_config.frame_loss}
                                                        disabled={running}
                                                        onChange={(event) => updateRfc2544Config({ frame_loss: event.target.checked })}
                                                    />
                                                    <Form.Check
                                                        type="checkbox"
                                                        label={rfc2544HoverLabel("Reset time", "Runs traffic at zero-loss throughput and measures the controller-observed outage from RX traffic stopping until it returns.")}
                                                        checked={rfc2544_config.reset}
                                                        disabled={running}
                                                        onChange={(event) => updateRfc2544Config({ reset: event.target.checked })}
                                                    />
                                                    <Form.Check
                                                        type="checkbox"
                                                        label={rfc2544HoverLabel("System recovery", "Overloads the DUT at 110% of zero-loss throughput, capped at line rate, then drops to 50% and observes when loss stops.")}
                                                        checked={rfc2544_config.system_recovery}
                                                        disabled={running}
                                                        onChange={(event) => updateRfc2544Config({ system_recovery: event.target.checked })}
                                                    />
                                                </div>
                                            </Tab>

                                            <Tab eventKey="frame-sizes" title="Frame sizes">
                                                <div className="d-flex justify-content-between align-items-center gap-2 mb-3">
                                                    <div className="small text-muted">
                                                        Select fixed frame sizes or the optional IMIX ZLT profile.&nbsp;
                                                        <InfoBox>
                                                            <>
                                                                <h5>Frame Sizes</h5>
                                                                <p>RFC2544 Ethernet benchmarks are reported for each configured frame size.</p>
                                                                <p>IMIX adds a non-RFC2544 zero-loss-throughput run using three streams in a 7:4:1 packet mix.</p>
                                                            </>
                                                        </InfoBox>
                                                    </div>
                                                    <div className="d-flex gap-2">
                                                        <Button size="sm" variant="outline-secondary" disabled={running} onClick={() => updateRfc2544Config({ frame_sizes: RFC2544_FRAME_SIZES })}>All</Button>
                                                        <Button size="sm" variant="outline-secondary" disabled={running} onClick={() => updateRfc2544Config({ frame_sizes: [64] })}>64 B only</Button>
                                                    </div>
                                                </div>
                                                <div className="d-flex flex-wrap gap-3">
                                                    {RFC2544_FRAME_SIZES.map((frameSize) => (
                                                        <ToggleButton
                                                            key={frameSize}
                                                            id={`rfc2544-frame-size-${frameSize}`}
                                                            type="checkbox"
                                                            size="sm"
                                                            variant="outline-primary"
                                                            className="rfc2544-frame-size-toggle"
                                                            value={frameSize}
                                                            checked={rfc2544_config.frame_sizes.includes(frameSize)}
                                                            disabled={running}
                                                            onChange={(event) => toggleRfc2544FrameSize(frameSize, event.target.checked)}
                                                        >
                                                            {rfc2544HoverLabel(`${frameSize} B`, `Run the selected RFC2544 tests with ${frameSize} byte Ethernet frames.`)}
                                                        </ToggleButton>
                                                    ))}
                                                    <ToggleButton
                                                        id="rfc2544-frame-size-imix"
                                                        type="checkbox"
                                                        size="sm"
                                                        variant="outline-primary"
                                                        className="rfc2544-frame-size-toggle"
                                                        value={RFC2544_IMIX_FRAME_SIZE}
                                                        checked={rfc2544IMIXSelected}
                                                        disabled={running || !rfc2544_config.throughput}
                                                        onChange={(event) => toggleRfc2544FrameSize(RFC2544_IMIX_FRAME_SIZE, event.target.checked)}
                                                    >
                                                        {rfc2544HoverLabel("IMIX", `Run an additional non-RFC2544 ZLT profile with ${IMIX_DESCRIPTION}, equivalent to the Add IMIX stream preset.`)}
                                                    </ToggleButton>
                                                </div>
                                                <div className="small text-muted mt-3">
                                                    IMIX applies to zero loss throughput only and is not RFC2544 conform.
                                                </div>
                                            </Tab>

                                            <Tab eventKey="timing" title="Timing">
                                                <div className="fw-semibold mb-2">
                                                    Rate and Timing&nbsp;
                                                    <InfoBox>
                                                        <>
                                                            <h5>Rate and Timing</h5>
                                                            <p>Line rate is shared by all RFC2544 tests.</p>
                                                        </>
                                                    </InfoBox>
                                                </div>
                                                <div className="small fw-semibold text-uppercase opacity-75 mb-1">Shared</div>
                                                <Row className="g-2">
                                                    <Col className="col-12 col-sm-6">
                                                        <Form.Label className="small mb-1">{rfc2544HoverLabel("Line rate (Gbit/s)", "Maximum media rate used as the upper bound for throughput search and as 100% offered load for frame loss testing.")}</Form.Label>
                                                        <Form.Control
                                                            size="sm"
                                                            type="number"
                                                            min={0.001}
                                                            max={maxRate}
                                                            step="any"
                                                            value={rfc2544NumericValue("line_rate_gbps")}
                                                            disabled={running}
                                                            onChange={(event) => updateRfc2544NumericInput("line_rate_gbps", event.target.value)}
                                                            onBlur={() => finishRfc2544NumericInput("line_rate_gbps")}
                                                        />
                                                    </Col>
                                                </Row>

                                                <div className="border-top mt-3 pt-2">
                                                    <div className="small fw-semibold text-uppercase opacity-75 mb-1">Warm-up / Cool-down</div>
                                                    <Row className="g-2 align-items-end">
                                                        <Col className="col-12 col-sm-4">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Warm-up duration (s)", "Traffic is generated for this duration before a measured RFC2544 trial starts. Warm-up traffic is excluded from the result counters and latency samples.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={0}
                                                                step={1}
                                                                value={rfc2544NumericValue("warmup_duration_secs")}
                                                                disabled={running}
                                                                onChange={(event) => updateRfc2544NumericInput("warmup_duration_secs", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("warmup_duration_secs")}
                                                            />
                                                        </Col>
                                                        <Col className="col-12 col-sm-4">
                                                            <Form.Check
                                                                type="checkbox"
                                                                label={rfc2544HoverLabel("Warm up first trial per mapping", "When enabled, warm-up runs only before the first measured trial for each active TX/RX mapping. When disabled, warm-up runs before every measured trial.")}
                                                                checked={rfc2544_config.warmup_once_per_mapping}
                                                                disabled={running || rfc2544_config.warmup_duration_secs <= 0}
                                                                onChange={(event) => updateRfc2544Config({ warmup_once_per_mapping: event.target.checked })}
                                                            />
                                                        </Col>
                                                        <Col className="col-12 col-sm-4">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Cool-down duration (s)", "Idle time after draining and before the next RFC2544 trial resets counters. Default is 2 seconds.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={0}
                                                                step={1}
                                                                value={rfc2544NumericValue("cooldown_duration_secs")}
                                                                disabled={running}
                                                                onChange={(event) => updateRfc2544NumericInput("cooldown_duration_secs", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("cooldown_duration_secs")}
                                                            />
                                                        </Col>
                                                    </Row>
                                                </div>

                                                <div className="border-top mt-3 pt-2">
                                                    <div className="small fw-semibold text-uppercase opacity-75 mb-1">Zero Loss Throughput and Frame Loss Rate</div>
                                                    <Row className="g-2">
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Trial duration (s)", "Duration of each fixed-rate throughput and frame-loss trial unless high loss ends the trial early.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("trial_duration_secs")}
                                                                disabled={running || (!rfc2544_config.throughput && !rfc2544_config.frame_loss)}
                                                                onChange={(event) => updateRfc2544NumericInput("trial_duration_secs", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("trial_duration_secs")}
                                                            />
                                                        </Col>
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Throughput search steps", "Number of fixed-rate binary refinement trials after a zero-to-line-rate sawtooth sweep finds a padded coarse window around the first observed loss.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("throughput_search_steps")}
                                                                disabled={running || !rfc2544_config.throughput}
                                                                onChange={(event) => updateRfc2544NumericInput("throughput_search_steps", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("throughput_search_steps")}
                                                            />
                                                        </Col>
                                                    </Row>
                                                    <Row className="g-2 mt-1">
                                                        <Col className="col-12 col-sm-4">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Throughput repetitions", "Number of complete zero-loss throughput searches to run per frame size and mapping. Repeating the search can make noisy or virtualized systems easier to characterize, but increases runtime.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("throughput_repetitions")}
                                                                disabled={running || !rfc2544_config.throughput}
                                                                onChange={(event) => updateRfc2544NumericInput("throughput_repetitions", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("throughput_repetitions")}
                                                            />
                                                        </Col>
                                                        <Col className="col-12 col-sm-4">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Aggregation mode", "Select how repeated zero-loss throughput searches are reported. Raw preserves every measured value without calculating an aggregate; the legacy scalar and follow-up procedures use the final repetition. Clustered mode groups rates within the configured tolerance and selects the largest stable group. Repeated or clustered ZLT is pragmatic and may deviate from strict RFC2544 single-run interpretation.")}</Form.Label>
                                                            <Form.Select
                                                                size="sm"
                                                                value={rfc2544_config.throughput_aggregation}
                                                                disabled={running || !rfc2544_config.throughput || rfc2544_config.throughput_repetitions <= 1}
                                                                onChange={(event) => updateRfc2544Config({ throughput_aggregation: event.target.value as "raw" | "clustered" | "median" | "minimum" })}
                                                            >
                                                                <option value="raw">Raw (all repetitions)</option>
                                                                <option value="clustered">Clustered</option>
                                                                <option value="median">Median</option>
                                                                <option value="minimum">Minimum</option>
                                                            </Form.Select>
                                                        </Col>
                                                        <Col className="col-12 col-sm-4">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Cluster tolerance (Gbit/s)", "Maximum spread within a clustered zero-loss-throughput group. For example, with 0.5 Gbit/s tolerance, 10.8, 11.0, and 11.2 Gbit/s form one stable group.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={0.001}
                                                                step="any"
                                                                value={rfc2544NumericValue("throughput_cluster_tolerance_gbps")}
                                                                disabled={running || !rfc2544_config.throughput || rfc2544_config.throughput_repetitions <= 1 || rfc2544_config.throughput_aggregation !== "clustered"}
                                                                onChange={(event) => updateRfc2544NumericInput("throughput_cluster_tolerance_gbps", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("throughput_cluster_tolerance_gbps")}
                                                            />
                                                        </Col>
                                                    </Row>
                                                    <Row className="g-2 mt-1">
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Ignored loss", "Zero-loss throughput treats loss at or below this value as no loss. Select packets for an absolute count or percent for a share of transmitted frames. This is useful for noisy systems, but is not fully RFC2544 conform because RFC2544 throughput is defined with zero frame loss.")}</Form.Label>
                                                            <InputGroup size="sm">
                                                                <Form.Control
                                                                    type="number"
                                                                    min={0}
                                                                    max={rfc2544_config.throughput_loss_tolerance.unit === "percent" ? 100 : undefined}
                                                                    step={rfc2544_config.throughput_loss_tolerance.unit === "percent" ? 0.0001 : 1}
                                                                    value={rfc2544LossToleranceInput ?? rfc2544_config.throughput_loss_tolerance.value}
                                                                    disabled={running || !rfc2544_config.throughput}
                                                                    onChange={(event) => updateRfc2544LossToleranceInput(event.target.value)}
                                                                    onBlur={() => setRfc2544LossToleranceInput(null)}
                                                                />
                                                                <Form.Select
                                                                    style={{ width: "auto", flex: "0 0 auto", minWidth: "fit-content", whiteSpace: "nowrap" }}
                                                                    value={rfc2544_config.throughput_loss_tolerance.unit}
                                                                    disabled={running || !rfc2544_config.throughput}
                                                                    onChange={(event) => updateRfc2544Config({
                                                                        throughput_loss_tolerance: {
                                                                            ...rfc2544_config.throughput_loss_tolerance,
                                                                            unit: event.target.value as "packets" | "percent",
                                                                        }
                                                                    })}
                                                                >
                                                                    <option value="packets">Packets</option>
                                                                    <option value="percent">Percent</option>
                                                                </Form.Select>
                                                            </InputGroup>
                                                        </Col>
                                                    </Row>
                                                </div>

                                                <div className="border-top mt-3 pt-2">
                                                    <div className="small fw-semibold text-uppercase opacity-75 mb-1">Latency</div>
                                                    <Row className="g-2">
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Duration (s)", "Traffic duration for each latency repetition at the zero-loss throughput rate.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("latency_duration_secs")}
                                                                disabled={running || !rfc2544_config.latency}
                                                                onChange={(event) => updateRfc2544NumericInput("latency_duration_secs", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("latency_duration_secs")}
                                                            />
                                                        </Col>
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Repetitions", "Number of latency trials to run for each selected frame size and mapping.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("latency_repetitions")}
                                                                disabled={running || !rfc2544_config.latency}
                                                                onChange={(event) => updateRfc2544NumericInput("latency_repetitions", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("latency_repetitions")}
                                                            />
                                                        </Col>
                                                    </Row>
                                                </div>

                                                <div className="border-top mt-3 pt-2">
                                                    <div className="small fw-semibold text-uppercase opacity-75 mb-1">Reset Time</div>
                                                    <Row className="g-2">
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Timeout (s)", "Maximum time to wait for the DUT to go offline and recover during reset-time measurement.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("reset_timeout_secs")}
                                                                disabled={running || !rfc2544_config.reset}
                                                                onChange={(event) => updateRfc2544NumericInput("reset_timeout_secs", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("reset_timeout_secs")}
                                                            />
                                                        </Col>
                                                    </Row>
                                                </div>

                                                <div className="border-top mt-3 pt-2">
                                                    <div className="small fw-semibold text-uppercase opacity-75 mb-1">System Recovery</div>
                                                    <Row className="g-2">
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Overload duration (s)", "Time to send the overload phase at 110% of zero-loss throughput, capped by the configured line rate.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("system_recovery_overload_duration_secs")}
                                                                disabled={running || !rfc2544_config.system_recovery}
                                                                onChange={(event) => updateRfc2544NumericInput("system_recovery_overload_duration_secs", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("system_recovery_overload_duration_secs")}
                                                            />
                                                        </Col>
                                                        <Col className="col-12 col-sm-6">
                                                            <Form.Label className="small mb-1">{rfc2544HoverLabel("Observation duration (s)", "Time to observe post-reduction frame loss after dropping system recovery traffic to 50% of throughput.")}</Form.Label>
                                                            <Form.Control
                                                                size="sm"
                                                                type="number"
                                                                min={1}
                                                                step={1}
                                                                value={rfc2544NumericValue("system_recovery_observation_duration_secs")}
                                                                disabled={running || !rfc2544_config.system_recovery}
                                                                onChange={(event) => updateRfc2544NumericInput("system_recovery_observation_duration_secs", event.target.value)}
                                                                onBlur={() => finishRfc2544NumericInput("system_recovery_observation_duration_secs")}
                                                            />
                                                        </Col>
                                                    </Row>
                                                </div>
                                            </Tab>
                                        </Tabs>
                                    </Modal.Body>
                                </Modal>
                            </>
                            : null}
                        {mode != GenerationMode.ANALYZE ?
                            <Row>
                                <Col>
                                    <Table striped bordered hover size="sm" className={"mt-3 mb-3 text-center"}>
                                        <thead className={"table-dark"}>
                                            <tr>
                                                {mode !== GenerationMode.RFC2544 ?
                                                    <>
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
                                                                                `Total rate of active streams (${totalRate} Gbit/s) exceeds the maximum rate of ${maxRate} Gbit/s.`
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
                                                    </>
                                                    : null}
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
                                                return <StreamElement key={`${activeConfigName}-${v.stream_id}`} mode={mode} data={v} remove={removeStream} update={updateStream} running={running}
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
                                {running ? null : mode === GenerationMode.CBR ? (
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
                                                {mode === GenerationMode.CBR ?
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
                                                    : null}
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
                                                <th colSpan={1 + streams.length + (rx_mapping_mode === RxMappingMode.PerTxPort ? 1 : 0)}>
                                                    <div className="d-flex flex-wrap align-items-center justify-content-between gap-2">
                                                        <span>Port and stream mapping</span>
                                                        {streams.length > 0
                                                            && mode !== GenerationMode.ANALYZE
                                                            && mode !== GenerationMode.RFC2544 ?
                                                            <InputGroup size="sm" style={{ maxWidth: 500 }}>
                                                                <InputGroup.Text>Expected RX mapping</InputGroup.Text>
                                                                <Form.Select
                                                                    aria-label="Expected RX mapping mode"
                                                                    disabled={running}
                                                                    value={rx_mapping_mode}
                                                                    onChange={(event) => changeRxMappingMode(event.target.value as RxMappingMode)}
                                                                >
                                                                    <option value={RxMappingMode.PerTxPort}>One RX per TX port</option>
                                                                    <option value={RxMappingMode.PerStream}>One RX per stream and TX port</option>
                                                                </Form.Select>
                                                            </InputGroup>
                                                            : null}
                                                    </div>
                                                </th>
                                            </tr>
                                            <tr>
                                                <th>TX Port</th>
                                                {rx_mapping_mode === RxMappingMode.PerTxPort ? <th>RX Port</th> : null}
                                                {streams.map((v, i) => {
                                                    return <th key={i}>
                                                        {mode === GenerationMode.RFC2544 ? "Enabled" : `Stream ${v.app_id}`}
                                                        {rx_mapping_mode === RxMappingMode.PerStream ?
                                                            <small className="d-block fw-normal">Enabled · Expected RX</small>
                                                            : null}
                                                    </th>
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
                                                    const sequenceMetricsAffected = sequenceMetricAffectedTxPorts.has(`${v.port}/${v.channel}`);

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
                                                                                    `Total rate of enabled streams (${totalRate} Gbit/s) exceeds line rate of this port (${speedToGbps(v.speed)} Gbit/s)`
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

                                                                <span
                                                                    className="d-inline-flex justify-content-center align-items-center ms-2"
                                                                    style={{ width: 18, height: 18 }}
                                                                >
                                                                    {sequenceMetricsAffected ? (
                                                                        <OverlayTrigger
                                                                            placement="top"
                                                                            overlay={(props) => renderTooltip(props, sequenceMetricsWarning)}
                                                                        >
                                                                            <span
                                                                                className="d-inline-flex align-items-center text-warning"
                                                                                role="img"
                                                                                tabIndex={0}
                                                                                aria-label={`Warning for TX port ${v.port}/${v.channel}: ${sequenceMetricsWarning}`}
                                                                                style={{ cursor: "help", lineHeight: 1 }}
                                                                            >
                                                                                <i className="bi bi-exclamation-triangle-fill" aria-hidden="true" />
                                                                            </span>
                                                                        </OverlayTrigger>
                                                                    ) : (
                                                                        <i
                                                                            className="bi bi-exclamation-triangle-fill"
                                                                            aria-hidden="true"
                                                                            style={{ visibility: "hidden" }}
                                                                        />
                                                                    )}
                                                                </span>
                                                            </StyledCol>


                                                            {rx_mapping_mode === RxMappingMode.PerTxPort ?
                                                                <StyledCol className="d-flex align-items-center gap-2">
                                                                    <Form.Select
                                                                        disabled={running || !v.status}
                                                                        required
                                                                        isInvalid={hasActiveStream(v) && !current}
                                                                        value={defaultValue}
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

                                                                    <HistogramSettings port={v} mapping={port_tx_rx_mapping} disabled={!v.status} running={running} iat_data={iat_histogram_settings} rtt_data={rtt_histogram_settings} set_rtt_data={updateRTTHistogramSettings} set_iat_data={updateIATHistogramSettings} streams={streams} />
                                                                </StyledCol>
                                                                : null}

                                                            <StreamSettingsList
                                                                stream_settings={stream_settings}
                                                                streams={streams}
                                                                running={running}
                                                                port={v}
                                                                ports={eligiblePorts}
                                                                rx_mapping_mode={rx_mapping_mode}
                                                                onUpdate={updateStreamSetting}
                                                                rtt_histogram_settings={rtt_histogram_settings}
                                                                iat_histogram_settings={iat_histogram_settings}
                                                                set_rtt_histogram_settings={updateRTTHistogramSettings}
                                                                set_iat_histogram_settings={updateIATHistogramSettings}
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
