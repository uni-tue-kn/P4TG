import { describe, expect, test, vi } from "vitest";
import { startPolling } from "../../Configuration GUI/src/common/Polling";

describe("v2_8_1 serialized polling", () => {
    /** v2.8.1: slow frontend polling requests must never overlap. */
    test("a slow request never overlaps the next request", async () => {
        vi.useFakeTimers();
        let resolve!: () => void;
        let active = 0;
        let maxActive = 0;
        const task = vi.fn(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise<void>((done) => { resolve = done; });
            active -= 1;
        });
        const stop = startPolling(task, 100, true);
        await vi.advanceTimersByTimeAsync(500);
        expect(task).toHaveBeenCalledTimes(1);
        resolve();
        await Promise.resolve();
        await vi.advanceTimersByTimeAsync(100);
        expect(task).toHaveBeenCalledTimes(2);
        expect(maxActive).toBe(1);
        stop();
        vi.useRealTimers();
    });
});
