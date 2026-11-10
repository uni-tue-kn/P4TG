import { describe, expect, test } from "vitest";
import {
    validateIP,
    validateIPv6,
    validateMAC,
    validateMPLS,
    validateTEID,
    validateUdpPort,
} from "../../Configuration GUI/src/common/Validators";

describe("configuration validators", () => {
    /** v2.4.0/v2.5.0: imported port and stream fields reject malformed values. */
    test("accept valid network identifiers", () => {
        expect(validateMAC("02:00:00:00:00:01")).toBe(true);
        expect(validateIP("192.0.2.1")).toBe(true);
        expect(validateIPv6("2001:db8::1")).toBe(true);
    });

    test("reject malformed and out-of-range identifiers", () => {
        expect(validateMAC("not-a-mac")).toBe(false);
        expect(validateIP("256.1.1.1")).toBe(false);
        expect(validateUdpPort(65536)).toBe(false);
        expect(validateTEID(0x1_0000_0000)).toBe(false);
    });

    test("validates every MPLS label", () => {
        expect(validateMPLS([{ label: 16, tc: 0, ttl: 64 }])).toBe(true);
        expect(validateMPLS([{ label: 1_048_575, tc: 0, ttl: 64 }])).toBe(false);
    });
});
