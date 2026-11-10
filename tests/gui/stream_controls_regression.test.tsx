import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import StreamSettingsElement from "../../Configuration GUI/src/components/settings/StreamSettingsElement";
import { DefaultStream, DefaultStreamSettings, RxMappingMode } from "../../Configuration GUI/src/common/Interfaces";
import { infos, ports } from "./fixtures";

const propsFor = (active: boolean, running: boolean, portStatus: boolean) => ({
    running,
    port_status: portStatus,
    stream: { ...DefaultStreamSettings(1, 1, 0), active, rx_target: { port: 2, channel: 0 } },
    stream_data: DefaultStream(1),
    configured_streams: [DefaultStream(1)],
    p4tg_infos: infos(),
    ports,
    rx_mapping_mode: RxMappingMode.PerStream,
    onActiveChange: vi.fn(),
    onRxTargetChange: vi.fn(),
    rtt_histogram_settings: {},
    iat_histogram_settings: {},
    set_rtt_histogram_settings: vi.fn(),
    set_iat_histogram_settings: vi.fn(),
});

const element = (props: ReturnType<typeof propsFor>) => (
    <table><tbody><tr><StreamSettingsElement {...props} /></tr></tbody></table>
);

describe("stream control regressions", () => {
    /** v2.7.1: Fixed the stream settings enable button to be disabled during traffic generation. */
    test("v2_7_1_running_stream_controls", async () => {
        const props = propsFor(true, true, true);
        render(element(props));
        expect(screen.getByRole("checkbox")).toBeChecked();
        expect(screen.getByRole("checkbox")).toBeDisabled();
        expect(screen.getByRole("combobox", { name: "RX target for stream 1" })).toBeDisabled();

        await userEvent.click(screen.getByRole("button", { name: "Stream settings" }));
        expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
        expect(screen.getAllByDisplayValue("32:D5:42:2A:F6:92").every((node) => (node as HTMLInputElement).disabled)).toBe(true);
        expect(props.onActiveChange).not.toHaveBeenCalled();
    });

    /** v2.5.0: Fix disabling of streams whose TX port is down in frontend (again). */
    test("v2_5_0_disabled_down_port_stream", async () => {
        const inactive = propsFor(false, false, false);
        const rendered = render(element(inactive));
        expect(screen.getByRole("checkbox")).toBeDisabled();
        expect(screen.getByRole("combobox", { name: "RX target for stream 1" })).toBeDisabled();

        const active = propsFor(true, false, false);
        rendered.rerender(element(active));
        expect(screen.getByRole("checkbox")).toBeEnabled();
        await userEvent.click(screen.getByRole("checkbox"));
        expect(active.onActiveChange).toHaveBeenCalledWith(false);
        expect(screen.getByRole("combobox", { name: "RX target for stream 1" })).toBeDisabled();
    });
});
