import { GenerationMode, TrafficGenData } from "./Interfaces";
import { validateStreams, validateStreamSettings } from "./Validators";

const STORAGE_SCHEMA_KEY = "p4tg.storageSchema";
const STORAGE_SCHEMA_VERSION = "2";
const CONFIG_STORAGE_KEYS = [
    "saved_configs",
    "streams",
    "streamSettings",
    "gen-mode",
    "duration",
    "repetitions",
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

export const migrateTrafficGenData = (value: unknown): TrafficGenData | null => {
    if (!isRecord(value) || !Array.isArray(value.streams) || !Array.isArray(value.stream_settings)) {
        return null;
    }

    const config = JSON.parse(JSON.stringify(value)) as TrafficGenData;
    if (!validateStreams(config.streams) || !validateStreamSettings(config.stream_settings)) {
        return null;
    }

    config.mode = typeof config.mode === "number" ? config.mode : GenerationMode.NONE;
    config.duration = typeof config.duration === "number" ? config.duration : 0;
    config.repetitions = config.mode === GenerationMode.RFC2544
        ? 1
        : typeof config.repetitions === "number" && Number.isInteger(config.repetitions) && config.repetitions > 0
            ? config.repetitions
            : 1;
    config.port_tx_rx_mapping = isRecord(config.port_tx_rx_mapping) ? config.port_tx_rx_mapping : {};
    config.rtt_histogram_config = isRecord(config.rtt_histogram_config) ? config.rtt_histogram_config : {};
    config.iat_histogram_config = isRecord(config.iat_histogram_config) ? config.iat_histogram_config : {};
    return config;
};

/** Migrates persisted v2.7 configuration before React hydrates from it. */
export const migrateStoredConfiguration = () => {
    if (localStorage.getItem(STORAGE_SCHEMA_KEY) === STORAGE_SCHEMA_VERSION) {
        return;
    }

    try {
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
        CONFIG_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    }

    localStorage.setItem(STORAGE_SCHEMA_KEY, STORAGE_SCHEMA_VERSION);
};
