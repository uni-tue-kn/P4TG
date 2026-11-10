import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import PatternModal from "../../Configuration GUI/src/components/settings/PatternModal";
import { GenerationPattern, GenerationPatternConfig } from "../../Configuration GUI/src/common/Interfaces";

const squarePattern = (): GenerationPatternConfig => ({
    pattern_type: GenerationPattern.Square,
    period: 20_000_000_000,
    sample_rate: 128,
    burst_packets: null,
    inverted: false,
    fc_quiet_until: null,
    fc_ramp_until: null,
    fc_decay_rate: null,
    square_low: 0.2,
    square_high_until: 10_000_000_000,
});

const numericField = (label: string): HTMLInputElement => {
    const input = screen.getByText(label, { exact: true }).closest(".row")?.querySelector('input[type="number"]');
    if (!(input instanceof HTMLInputElement)) throw new Error(`No numeric input for ${label}`);
    return input;
};

describe("pattern modal regressions", () => {
    /** v2.8.1: Fixed numeric pattern fields retaining the previous value when cleared and replaced. */
    test("v2_8_1_cleared_numeric_pattern_fields", async () => {
        const setData = vi.fn();
        const hide = vi.fn();
        render(<PatternModal show hide={hide} data={squarePattern()} disabled={false} expertMode={false} set_data={setData} />);
        const user = userEvent.setup();

        for (const [label, replacement] of [
            ["Period", "5"],
            ["Sample factor", "64"],
            ["Square low", "0.4"],
            ["High until", "3"],
        ] as const) {
            const input = numericField(label);
            await user.clear(input);
            expect(input).toHaveValue(null);
            await user.type(input, replacement);
            expect(input).toHaveValue(Number(replacement));
        }
        await user.click(screen.getByRole("button", { name: "Confirm" }));

        expect(setData).toHaveBeenCalledWith(expect.objectContaining({
            period: 5_000_000_000,
            sample_rate: 64,
            square_low: 0.4,
            square_high_until: 3_000_000_000,
        }));
        expect(hide).toHaveBeenCalledOnce();
    });
});
