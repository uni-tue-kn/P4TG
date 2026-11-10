import React from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    DefaultStream,
    GenerationMode,
    GenerationUnit,
    RxMappingMode,
    TrafficGenData,
} from "../../Configuration GUI/src/common/Interfaces";
import Settings from "../../Configuration GUI/src/sites/Settings";
import { config, infos, ports } from "./fixtures";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    startPolling: vi.fn(() => vi.fn()),
}));

vi.mock("../../Configuration GUI/src/common/API", () => ({ get: mocks.get }));
vi.mock("../../Configuration GUI/src/common/Polling", () => ({ startPolling: mocks.startPolling }));

const showToast = vi.fn();

function apiWithTrafficgen(data: unknown = {}) {
    mocks.get.mockImplementation(async ({ route }: { route: string }) => {
        if (route === "/ports") return { status: 200, data: ports };
        if (route === "/trafficgen") return { status: 200, data };
        throw new Error(`unexpected route ${route}`);
    });
}

async function renderSettings() {
    const rendered = render(<Settings p4tg_infos={infos()} showToast={showToast} expertMode={false} />);
    expect((await screen.findAllByRole("button", { name: /Import/i })).length).toBeGreaterThan(0);
    await waitFor(() => expect(mocks.get).toHaveBeenCalledWith({ route: "/trafficgen" }));
    return rendered;
}

async function uploadJson(container: HTMLElement, value: unknown, filename = "settings.json") {
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).not.toBeNull();
    await userEvent.upload(input, new File([JSON.stringify(value)], filename, { type: "application/json" }));
}

function storedConfigs(): Record<string, TrafficGenData> {
    return JSON.parse(localStorage.getItem("saved_configs") ?? "{}");
}

beforeEach(() => {
    apiWithTrafficgen();
    showToast.mockReset();
});

describe("Settings import/export integration", () => {
    test("imports an array, selects its first named test, and persists every configuration", async () => {
        const { container } = await renderSettings();
        await uploadJson(container, [
            { ...config({ duration: 11 }), name: "Latency" },
            { ...config({ duration: 22 }), name: "Throughput" },
        ]);

        await waitFor(() => expect(showToast).toHaveBeenCalledWith("Settings imported successfully.", "success"));
        expect(screen.getByText("Latency")).toBeInTheDocument();
        expect(screen.getByText("Throughput")).toBeInTheDocument();
        expect(Object.keys(storedConfigs())).toEqual(["Latency", "Throughput"]);
        expect(storedConfigs().Latency.duration).toBe(11);
        expect(storedConfigs().Throughput.duration).toBe(22);
        expect(JSON.parse(localStorage.getItem("streams")!)).toHaveLength(1);
        expect(localStorage.getItem("duration")).toBe("11");
        expect(localStorage.getItem("repetitions")).toBe("1");
        expect(JSON.parse(localStorage.getItem("port_tx_rx_mapping")!)).toEqual({ "1": { "0": { port: 2, channel: 0 } } });
    });

    test("accepts a single unnamed configuration and object-map format", async () => {
        const first = await renderSettings();
        await uploadJson(first.container, config({ duration: 7 }));
        await waitFor(() => expect(storedConfigs()["Test 1"]?.duration).toBe(7));
        expect(showToast).toHaveBeenLastCalledWith("Settings imported successfully.", "success");

        await uploadJson(first.container, {
            Alpha: config({ repetitions: 3 }),
            Beta: config({ repetitions: 4 }),
        });
        await waitFor(() => expect(Object.keys(storedConfigs())).toEqual(["Alpha", "Beta"]));
        expect(storedConfigs().Alpha.repetitions).toBe(3);
        expect(storedConfigs().Beta.repetitions).toBe(4);
        expect(screen.getByText("Alpha")).toBeInTheDocument();
        expect(screen.getByText("Beta")).toBeInTheDocument();
    });

    test("migrates legacy MPPS, flat mappings, flat histograms, and missing channels", async () => {
        const { container } = await renderSettings();
        const legacy = config({
            mode: GenerationMode.MPPS,
            port_tx_rx_mapping: { "1": 2 } as any,
            rtt_histogram_config: { "2": { min: 1, max: 10, num_bins: 4 } } as any,
            stream_settings: config().stream_settings.map(({ channel: _channel, ...setting }) => setting as any),
        });
        await uploadJson(container, { Legacy: legacy });

        await waitFor(() => expect(storedConfigs().Legacy).toBeDefined());
        const migrated = storedConfigs().Legacy;
        expect(migrated.mode).toBe(GenerationMode.CBR);
        expect(migrated.streams[0].unit).toBe(GenerationUnit.Mpps);
        expect(migrated.port_tx_rx_mapping).toEqual({ "1": { "0": { port: 2, channel: 0 } } });
        expect(migrated.rtt_histogram_config).toEqual({ "2": { "0": { min: 1, max: 10, num_bins: 4 } } });
        expect(migrated.stream_settings.every((setting) => setting.channel === 0)).toBe(true);
        expect(showToast).toHaveBeenLastCalledWith("Settings imported successfully.", "success");
    });

    test.each([
        ["malformed JSON", "{not-json", "Could not parse file content. Please check the file."],
        ["empty array", "[]", "Settings file does not contain any valid configurations."],
        ["wrong primitive", "42", "Could not serialize file content. Please check the file."],
        ["bad object map", JSON.stringify({ Broken: { streams: "bad", stream_settings: [] } }), "Could not serialize file content. Please check the file."],
    ])("rejects %s without replacing the saved draft", async (_case, contents, message) => {
        localStorage.setItem("saved_configs", JSON.stringify({ Existing: config({ duration: 91 }) }));
        const rendered = await renderSettings();
        const input = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
        await userEvent.upload(input, new File([contents], "bad.json", { type: "application/json" }));

        await waitFor(() => expect(showToast).toHaveBeenCalledWith(message, "danger"));
        expect(Object.keys(storedConfigs())).toEqual(["Existing"]);
        expect(storedConfigs().Existing.duration).toBe(91);
    });

    test("rejects structurally invalid streams and unavailable port mappings", async () => {
        const rendered = await renderSettings();
        await uploadJson(rendered.container, { Invalid: config({ streams: [{ stream_id: "wrong" } as any] }) });
        await waitFor(() => expect(showToast).toHaveBeenCalledWith(
            "Settings not valid for config Invalid. Please check the file.", "danger",
        ));

        showToast.mockClear();
        await uploadJson(rendered.container, {
            MissingPort: config({ port_tx_rx_mapping: { "99": { "0": { port: 2, channel: 0 } } } }),
        });
        await waitFor(() => expect(showToast).toHaveBeenCalledWith(
            "Settings not valid for config MissingPort. Configured front panel ports are not available on this device.", "danger",
        ));
        expect(storedConfigs().Invalid).toBeUndefined();
        expect(storedConfigs().MissingPort).toBeUndefined();
    });

    test("exports all tests, names them, and removes inactive port settings", async () => {
        localStorage.setItem("saved_configs", JSON.stringify({
            First: config({ duration: 5 }),
            Second: config({ duration: 8 }),
        }));
        let clicked: HTMLAnchorElement | undefined;
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
            clicked = this;
        });
        await renderSettings();

        await userEvent.click(screen.getAllByRole("button", { name: /Export/i })[0]);
        expect(clicked).toBeDefined();
        expect(clicked!.download).toBe("settings.json");
        expect(clicked!.href).toMatch(/^data:text\/json;charset=utf-8,/);
        const exported = JSON.parse(decodeURIComponent(clicked!.href.split(",", 2)[1]));
        expect(exported).toHaveLength(2);
        expect(exported.map((entry: TrafficGenData) => entry.name)).toEqual(["First", "Second"]);
        expect(exported[0].stream_settings).toHaveLength(1);
        expect(exported[0].stream_settings[0]).toMatchObject({ port: 1, channel: 0, active: true });
        expect(exported[1].duration).toBe(8);
    });
});

describe("Settings tab and running-state workflows", () => {
    /** v2.8.1: Fixed configuration state, including Rate/IAT Precision and live RFC2544 trials, leaking between test tabs and clones. */
    test("v2_8_1_clone_state_and_tab_lifecycle", async () => {
        localStorage.setItem("saved_configs", JSON.stringify({ "Test 1": config({ duration: 13 }) }));
        await renderSettings();
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: /Add Test/i }));
        expect(screen.getByText("Test 2")).toBeInTheDocument();
        expect(Object.keys(storedConfigs())).toEqual(["Test 1", "Test 2"]);
        expect(storedConfigs()["Test 1"].duration).toBe(13);
        expect(storedConfigs()["Test 2"].streams).toEqual([]);

        const firstTab = screen.getByText("Test 1").closest("a")!;
        await user.click(within(firstTab).getByTitle("Clone Test"));
        expect(screen.getByText("Test 1_copy")).toBeInTheDocument();
        expect(storedConfigs()["Test 1_copy"].duration).toBe(13);
        expect(showToast).toHaveBeenCalledWith('Cloned "Test 1" to "Test 1_copy"', "success");

        const secondTab = screen.getByText("Test 2").closest("a")!;
        await user.click(within(secondTab).getByTitle("Rename Test"));
        const renameInput = within(secondTab).getByRole("textbox");
        await user.clear(renameInput);
        await user.type(renameInput, "Custom Test");
        await user.click(within(secondTab).getByTitle("Save name"));
        expect(screen.getByText("Custom Test")).toBeInTheDocument();
        expect(storedConfigs()["Test 2"]).toBeUndefined();
        expect(storedConfigs()["Custom Test"]).toBeDefined();

        const customTab = screen.getByText("Custom Test").closest("a")!;
        await user.click(within(customTab).getByTitle("Delete Test"));
        expect(screen.queryByText("Custom Test")).not.toBeInTheDocument();
        expect(storedConfigs()["Custom Test"]).toBeUndefined();
        const undo = screen.getByTitle("Restore last deleted test");
        expect(undo).toBeEnabled();
        await user.click(undo);
        expect(screen.getByText("Custom Test")).toBeInTheDocument();
        expect(Object.keys(storedConfigs())).toEqual(["Test 1", "Custom Test", "Test 1_copy"]);
    });

    test("rejects blank and duplicate names without changing storage", async () => {
        localStorage.setItem("saved_configs", JSON.stringify({ Alpha: config(), Beta: config() }));
        await renderSettings();
        const user = userEvent.setup();
        const alpha = screen.getByText("Alpha").closest("a")!;
        await user.click(within(alpha).getByTitle("Rename Test"));
        const input = within(alpha).getByRole("textbox");
        await user.clear(input);
        await user.click(within(alpha).getByTitle("Save name"));
        expect(showToast).toHaveBeenLastCalledWith("Name already exists or is invalid.", "warning");
        expect(Object.keys(storedConfigs())).toEqual(["Alpha", "Beta"]);

        await user.type(input, "Beta");
        await user.click(within(alpha).getByTitle("Save name"));
        expect(showToast).toHaveBeenLastCalledWith("Name already exists or is invalid.", "warning");
        expect(Object.keys(storedConfigs())).toEqual(["Alpha", "Beta"]);
    });

    /** v2.8.1: Fixed configuration state, including Rate/IAT Precision and live RFC2544 trials, leaking between test tabs and clones. */
    test("v2_8_1_tab_state_isolation", async () => {
        localStorage.setItem("saved_configs", JSON.stringify({
            Slow: config({ duration: 3, repetitions: 2 }),
            Fast: config({ duration: 19, repetitions: 6 }),
        }));
        const rendered = await renderSettings();
        const user = userEvent.setup();
        const activePanel = () => rendered.container.querySelector(".tab-pane.active") as HTMLElement;
        const numberInputs = () => within(activePanel()).getAllByRole("spinbutton") as HTMLInputElement[];
        expect(within(activePanel()).getByPlaceholderText("3 s")).toBeInTheDocument();
        expect(numberInputs().some((input) => input.value === "2")).toBe(true);

        await user.click(screen.getByText("Fast"));
        await waitFor(() => expect(within(activePanel()).getByPlaceholderText("19 s")).toBeInTheDocument());
        expect(numberInputs().some((input) => input.value === "6")).toBe(true);
        await user.click(screen.getByText("Slow"));
        await waitFor(() => expect(within(activePanel()).getByPlaceholderText("3 s")).toBeInTheDocument());
        expect(storedConfigs().Fast.duration).toBe(19);
        expect(storedConfigs().Slow.duration).toBe(3);
    });

    /** v2.7.1: Fixed the stream settings enable button to be disabled during traffic generation. Fixed settings export not being available during active traffic generation. */
    test("v2_7_1_running_settings_controls_and_export", async () => {
        const running = config({
            name: "Test 1",
            mode: GenerationMode.CBR,
            streams: [{ ...DefaultStream(1), traffic_rate: 0.01 }],
        });
        apiWithTrafficgen(running);
        localStorage.setItem("saved_configs", JSON.stringify({ "Test 1": config() }));
        await renderSettings();

        await waitFor(() => expect(screen.getByRole("button", { name: /Import/i })).toBeDisabled());
        expect(screen.getByRole("button", { name: /Export/i })).toBeEnabled();
        expect(screen.getByRole("button", { name: /Add Test/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Save/i })).toBeDisabled();
        expect(screen.getByRole("button", { name: /Reset/i })).toBeDisabled();
        expect(screen.getByTitle("Rename Test")).toBeDisabled();
        expect(screen.getByTitle("Clone Test")).toBeDisabled();
        const generationMode = screen.getByRole("option", { name: "Generation Mode" }).parentElement;
        expect(generationMode).toBeDisabled();
    });

    test("Import button delegates to the hidden JSON file chooser", async () => {
        const rendered = await renderSettings();
        const input = rendered.container.querySelector('input[type="file"]') as HTMLInputElement;
        const click = vi.spyOn(input, "click").mockImplementation(() => undefined);
        await userEvent.click(screen.getByRole("button", { name: /Import/i }));
        expect(click).toHaveBeenCalledOnce();
        expect(input.accept).toBe(".json");
    });
});
