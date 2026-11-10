import React from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, test, vi } from "vitest";
import {
    StatisticsObject,
    TimeStatisticsObject,
} from "../../Configuration GUI/src/common/Interfaces";
import Home from "../../Configuration GUI/src/sites/Home";
import Status from "../../Configuration GUI/src/components/Status";
import { config, infos } from "./fixtures";

const mocks = vi.hoisted(() => ({
    get: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
    reportPost: vi.fn(),
    startPolling: vi.fn(() => vi.fn()),
}));

vi.mock("../../Configuration GUI/src/common/API", () => ({
    default: { post: mocks.reportPost },
    get: mocks.get,
    post: mocks.post,
    del: mocks.del,
}));
vi.mock("../../Configuration GUI/src/common/Polling", () => ({ startPolling: mocks.startPolling }));
vi.mock("../../Configuration GUI/src/components/SummaryView", () => ({
    default: ({ statistics, time_statistics }: { statistics: { name?: string }, time_statistics: { name?: string } }) => (
        <div data-testid="summary-view">
            Summary for {statistics.name ?? "current"}; time series {time_statistics.name ?? "current"}
        </div>
    ),
}));

const showToast = vi.fn();

function seedTwoConfigs() {
    localStorage.setItem("saved_configs", JSON.stringify({
        Alpha: config({ repetitions: 1 }),
        Beta: config({ repetitions: 1 }),
    }));
}

function apiWithStatistics(statistics: unknown[]) {
    mocks.get.mockImplementation(async ({ route }: { route: string }) => {
        if (route === "/trafficgen") return { status: 200, data: {} };
        if (route === "/statistics") return { status: 200, data: statistics };
        if (route.startsWith("/time_statistics")) {
            return { status: 200, data: statistics.map((entry: any) => ({ ...TimeStatisticsObject, name: entry.name })) };
        }
        throw new Error(`unexpected route ${route}`);
    });
}

async function runTimeStatisticsPoll() {
    await waitFor(() => expect(mocks.startPolling.mock.calls.some((call) => call[1] === 1000)).toBe(true));
    const poll = mocks.startPolling.mock.calls.find((call) => call[1] === 1000)![0];
    await act(async () => { await poll(); });
}

beforeEach(() => {
    showToast.mockReset();
    mocks.post.mockReset();
    mocks.del.mockReset();
});

describe("dashboard multi-run and aborted-run presentation", () => {
    /** v2.5.0: Fix results not being rendered for multiple tests in frontend, if tests were triggered via direct REST API calls. */
    test("v2_5_0_direct_api_multiple_results", async () => {
        seedTwoConfigs();
        apiWithStatistics([
            { ...StatisticsObject, name: "Beta" },
            { ...StatisticsObject, name: "Alpha" },
        ]);
        render(<Home p4tg_infos={infos()} showToast={showToast} />);

        await screen.findByRole("button", { name: /Start/ });
        await runTimeStatisticsPoll();
        expect(screen.getByText("Run 2 / 2")).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Alpha" })).toBeInTheDocument();
        expect(screen.getByRole("tab", { name: "Beta" })).toBeInTheDocument();
        expect(screen.getByText("Summary for Alpha; time series Alpha")).toBeInTheDocument();

        await userEvent.click(screen.getByRole("tab", { name: "Beta" }));
        await waitFor(() => expect(screen.getByText("Summary for Beta; time series Beta")).toBeVisible());
        expect(screen.getAllByTestId("summary-view")).toHaveLength(2);
        expect(screen.getByText("Run 2 / 2").closest("span")?.querySelector(".bi-check-circle-fill")).not.toBeNull();
    });

    /** v2.5.0: Fix stats not being shown in frontend for the most recent test if multiple tests were conducted and the last test was aborted. */
    test("v2_5_0_latest_aborted_result_count", async () => {
        seedTwoConfigs();
        apiWithStatistics([{ ...StatisticsObject, name: "Alpha" }]);
        render(<Home p4tg_infos={infos()} showToast={showToast} />);

        await screen.findByRole("button", { name: /Start/ });
        await runTimeStatisticsPoll();
        const progress = screen.getByText("Run 1 / 2").closest("span")!;
        expect(progress).toBeInTheDocument();
        expect(progress.querySelector(".bi-pause-circle-fill")).not.toBeNull();
        expect(progress.querySelector(".bi-check-circle-fill")).toBeNull();
        expect(screen.getByText("Summary for Alpha; time series Alpha")).toBeInTheDocument();
        expect(screen.queryByText(/Summary for Beta/)).not.toBeInTheDocument();
    });

    /** v2.5.0: Fix displayed number of tests on dashboard. */
    test("v2_5_0_dashboard_test_count", async () => {
        localStorage.setItem("saved_configs", JSON.stringify({
            Alpha: config({ repetitions: 2 }),
            Beta: config({ repetitions: 3 }),
        }));
        apiWithStatistics([{ ...StatisticsObject, name: "Alpha" }]);
        render(<Home p4tg_infos={infos()} showToast={showToast} />);
        await screen.findByRole("button", { name: /Start/ });
        expect(screen.getByText("Run 1 / 5")).toBeInTheDocument();
    });

    /** v2.7.1: Fixed the visualization in the frontend degrading due to the limit parameter which derived the number of elements from the time when the experiment started. */
    test("v2_7_1_visualization_limit_stable_window", async () => {
        seedTwoConfigs();
        apiWithStatistics([{ ...StatisticsObject, name: "Alpha" }]);
        render(<Home p4tg_infos={infos()} showToast={showToast} />);
        await screen.findByRole("button", { name: /Start/ });
        await runTimeStatisticsPoll();
        expect(mocks.get).toHaveBeenCalledWith({ route: "/time_statistics?limit=100" });
        expect(mocks.get).not.toHaveBeenCalledWith(expect.objectContaining({ route: expect.stringMatching(/limit=[^1]/) }));
    });

    /** v2.8.1: Fixed JSON result exports containing only the locally cached time-series data. JSON downloads now fetch and include the complete statistics and unabridged time-series history for all runs. */
    test("v2_8_1_complete_json_result_export", async () => {
        seedTwoConfigs();
        apiWithStatistics([{
            ...StatisticsObject,
            name: "Alpha",
            tx_rate_l1: { "1": { "0": 1 } },
        }]);
        let exportedBlob: Blob | undefined;
        Object.defineProperty(URL, "createObjectURL", {
            configurable: true,
            value: vi.fn((blob: Blob) => {
                exportedBlob = blob;
                return "blob:p4tg-results";
            }),
        });
        Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
        vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
        render(<Home p4tg_infos={infos()} showToast={showToast} />);

        await userEvent.click(await screen.findByRole("button", { name: /Export JSON/ }));
        await waitFor(() => expect(mocks.get).toHaveBeenCalledWith({ route: "/time_statistics" }));
        expect(mocks.get).toHaveBeenCalledWith({ route: "/statistics" });
        expect(exportedBlob).toBeDefined();
        const text = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = () => reject(reader.error);
            reader.readAsText(exportedBlob!);
        });
        const exported = JSON.parse(text);
        expect(exported.statistics[0]).toMatchObject({ name: "Alpha" });
        expect(exported.time_statistics[0]).toMatchObject({ name: "Alpha" });
        expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:p4tg-results");
    });
});

describe("dashboard loss status", () => {
    test("reports OK when no mapping loses packets", () => {
        render(<Status stats={{ ...StatisticsObject, packet_loss: { "1": { "0": 0 } } }} />);
        expect(screen.getByText("Status: Ok")).toBeInTheDocument();
    });

    test("aggregates loss over ports/channels and exposes the exact count", async () => {
        render(<Status stats={{
            ...StatisticsObject,
            packet_loss: { "1": { "0": 12, "1": 3 }, "2": { "0": 1000 } },
        }} />);
        const status = screen.getByText("Status: Error. Lost 1.01 K frames.");
        expect(status).toBeInTheDocument();
        await userEvent.hover(status);
        expect(await screen.findByText("1015")).toBeInTheDocument();
    });
});
