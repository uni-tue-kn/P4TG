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
 * Fabian Ihle (fabian.ihle@uni-tuebingen.de)
 */

import { GenerationMode, MAX_DRAIN_DURATION_SECS, RxMappingMode, TrafficGenData } from "./Interfaces";
import { validateStreams, validateStreamSettings } from "./Validators";

const STORAGE_SCHEMA_KEY = "p4tg.storageSchema";
const STORAGE_SCHEMA_VERSION = "6";
const CONFIG_STORAGE_KEYS = [
    "saved_configs",
    "streams",
    "streamSettings",
    "gen-mode",
    "rx_mapping_mode",
    "duration",
    "repetitions",
    "drain_duration_secs",
    "port_tx_rx_mapping",
    "rtt_histogram_config",
    "iat_histogram_config",
    "rfc2544_config",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null && !Array.isArray(value);

const parseStoredJson = (key: string): unknown => {
    const value = localStorage.getItem(key);
    return value === null ? undefined : JSON.parse(value);
};

/** Clears traffic-generator settings without making new data look pre-schema. */
export const clearStoredConfiguration = () => {
    CONFIG_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    localStorage.setItem(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION);
};

export const migrateTrafficGenData = (value: unknown): TrafficGenData | null => {
    if (!isRecord(value) || !Array.isArray(value.streams) || !Array.isArray(value.stream_settings)) {
        return null;
    }

    const config = JSON.parse(JSON.stringify(value)) as TrafficGenData;
    if (!validateStreams(config.streams) || !validateStreamSettings(config.stream_settings)) {
        return null;
    }

    config.mode = typeof config.mode === "number" ? config.mode : GenerationMode.NONE;
    config.rx_mapping_mode = Object.values(RxMappingMode).includes(config.rx_mapping_mode)
        ? config.rx_mapping_mode
        : RxMappingMode.PerTxPort;
    config.duration = typeof config.duration === "number" ? config.duration : 0;
    config.repetitions = config.mode === GenerationMode.RFC2544
        ? 1
        : typeof config.repetitions === "number" && Number.isInteger(config.repetitions) && config.repetitions > 0
            ? config.repetitions
            : 1;
    config.drain_duration_secs = typeof config.drain_duration_secs === "number"
        && Number.isInteger(config.drain_duration_secs)
        && config.drain_duration_secs >= 0
        ? Math.min(config.drain_duration_secs, MAX_DRAIN_DURATION_SECS)
        : 0;
    config.port_tx_rx_mapping = isRecord(config.port_tx_rx_mapping) ? config.port_tx_rx_mapping : {};
    config.rtt_histogram_config = isRecord(config.rtt_histogram_config) ? config.rtt_histogram_config : {};
    config.iat_histogram_config = isRecord(config.iat_histogram_config) ? config.iat_histogram_config : {};
    return config;
};

/** Migrates persisted v2.7 configuration before React hydrates from it. */
export const migrateStoredConfiguration = () => {
    const storedVersion = localStorage.getItem(STORAGE_SCHEMA_KEY);
    if (storedVersion === STORAGE_SCHEMA_VERSION) {
        return;
    }

    // Schema 5 renumbers the Tofino 2 four-way channels from 0,1,2,3 to
    // 0,2,4,6. Stored channel references cannot be remapped unambiguously —
    // a config using only channels 0 and 2 is valid under both layouts — so
    // the configuration is reset instead of silently pointing at other lanes.
    // Number(null) is 0, so storage predating the schema key is covered too.
    if (Number(storedVersion) < 5) {
        if (CONFIG_STORAGE_KEYS.some((key) => localStorage.getItem(key) !== null)) {
            console.warn(
                "Stored P4TG configuration predates the Tofino 2 channel renumbering and was reset.",
            );
            clearStoredConfiguration();
        }
        localStorage.setItem(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION);
        return;
    }

    try {
        const storedDrainDuration = Number(localStorage.getItem("drain_duration_secs") ?? 0);
        localStorage.setItem(
            "drain_duration_secs",
            String(Number.isInteger(storedDrainDuration) && storedDrainDuration >= 0
                ? Math.min(storedDrainDuration, MAX_DRAIN_DURATION_SECS)
                : 0),
        );

        const streams = parseStoredJson("streams");
        if (streams !== undefined) {
            if (!Array.isArray(streams) || !validateStreams(streams)) {
                throw new Error("Invalid stored streams");
            }
            localStorage.setItem("streams", JSON.stringify(streams));
        }

        const streamSettings = parseStoredJson("streamSettings");
        if (streamSettings !== undefined) {
            if (!Array.isArray(streamSettings) || !validateStreamSettings(streamSettings)) {
                throw new Error("Invalid stored stream settings");
            }
            localStorage.setItem("streamSettings", JSON.stringify(streamSettings));
        }

        const savedConfigs = parseStoredJson("saved_configs");
        if (savedConfigs !== undefined) {
            if (!isRecord(savedConfigs)) {
                throw new Error("Invalid stored configurations");
            }

            const migratedConfigs: Record<string, TrafficGenData> = {};
            for (const [name, config] of Object.entries(savedConfigs)) {
                const migrated = migrateTrafficGenData(config);
                if (!migrated) {
                    throw new Error(`Invalid stored configuration: ${name}`);
                }
                migratedConfigs[name] = migrated;
            }
            localStorage.setItem("saved_configs", JSON.stringify(migratedConfigs));
        }
    } catch (error) {
        console.warn("Stored P4TG configuration is incompatible and was reset.", error);
        clearStoredConfiguration();
    }

    localStorage.setItem(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION);
};
