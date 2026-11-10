import { beforeEach, describe, expect, test, vi } from "vitest";
import { calculateStreamRate, getTotalActiveStreamRate, loadFromStorage, uniqueRxPairs } from "../../Configuration GUI/src/common/Helper";
import { clearStoredConfiguration, migrateStoredConfiguration, migrateTrafficGenData } from "../../Configuration GUI/src/common/StorageMigration";
import { DefaultStream, DefaultStreamSettings, Encapsulation, GenerationMode, GenerationUnit } from "../../Configuration GUI/src/common/Interfaces";
import { splitImixRate } from "../../Configuration GUI/src/common/IMIX";
import { ensureDefaults, stripUnusedFields } from "../../Configuration GUI/src/components/settings/SettingsModal";

beforeEach(() => localStorage.clear());

describe("storage regressions", () => {
    test("v2_8_1_corrupt_local_storage is removed and replaced", () => {
        localStorage.setItem("streams", "{broken");
        expect(loadFromStorage("streams", ["fallback"])).toEqual(["fallback"]);
        expect(localStorage.getItem("streams")).toBeNull();
    });

    test("v2_8_1_old_channel_layout resets stored configuration", () => {
        localStorage.setItem("p4tg.storageSchema", "4");
        localStorage.setItem("streams", "[]");
        migrateStoredConfiguration();
        expect(localStorage.getItem("streams")).toBeNull();
        expect(localStorage.getItem("p4tg.storageSchema")).toBe("6");
    });

    test("clear marks storage with the current schema", () => {
        clearStoredConfiguration();
        expect(localStorage.getItem("p4tg.storageSchema")).toBe("6");
    });

    /** v2.8.1: malformed imported settings are rejected instead of partially loading. */
    test("v2_8_1_malformed_import_is_rejected", () => {
        expect(migrateTrafficGenData({ streams: "broken", stream_settings: [] })).toBeNull();
    });

    /** v2.8.1: missing nested defaults are restored during settings migration. */
    test("v2_8_1_import_restores_defaults", () => {
        const migrated = migrateTrafficGenData({
            mode: GenerationMode.CBR,
            streams: [DefaultStream(1)],
            stream_settings: [DefaultStreamSettings(1, 1, 0)],
        });
        expect(migrated).toMatchObject({ repetitions: 1, duration: 0, port_tx_rx_mapping: {} });
    });
});

describe("dashboard and rate regressions", () => {
    test("v2_8_1_rx_fan_in is counted once", () => {
        expect(uniqueRxPairs({
            "1": { "0": { port: 2, channel: 0 } },
            "3": { "0": { port: 2, channel: 0 } },
        })).toEqual([["2", "0"]]);
    });

    test("v2_8_1_gtpu_overhead is 36 bytes", () => {
        const stream = {
            frame_size: 64, traffic_rate: 1, unit: GenerationUnit.Mpps,
            encapsulation: Encapsulation.None, gtpu: true, vxlan: false,
        } as any;
        expect(calculateStreamRate(stream)).toBe(0.8);
    });

    /** v2.6.0: inactive streams do not contribute to the maximum/summary rate. */
    test("v2_6_0_inactive_stream_rate", () => {
        const streams = [DefaultStream(1), { ...DefaultStream(2), traffic_rate: 99 }];
        const settings = [
            { ...DefaultStreamSettings(1, 1, 0), active: true },
            { ...DefaultStreamSettings(2, 1, 0), active: false },
        ];
        expect(getTotalActiveStreamRate(streams, settings)).toBe(streams[0].traffic_rate);
    });

    /** v2.8.1: IMIX Gbit/s allocation is weighted by each frame's L1 size. */
    test("v2_8_1_imix_l1_weighting", () => {
        const rates = splitImixRate(1, GenerationUnit.Gbps);
        expect(rates.reduce((sum, rate) => sum + rate, 0)).toBeCloseTo(1, 6);
        expect(rates[2]).toBeGreaterThan(rates[0]);
    });

    /** v2.7.1: disabled protocol fields are omitted and newly enabled ones get defaults. */
    test("v2_7_1_optional_protocol_fields", () => {
        const base = DefaultStream(1);
        const settings = DefaultStreamSettings(1, 1, 0);
        const enabled = ensureDefaults(settings, { ...base, gtpu: true });
        expect(enabled.gtpu).toBeDefined();
        const stripped = stripUnusedFields({ ...enabled, vlan: {} as any }, base);
        expect(stripped.gtpu).toBeUndefined();
        expect(stripped.vlan).toBeUndefined();
    });
});
