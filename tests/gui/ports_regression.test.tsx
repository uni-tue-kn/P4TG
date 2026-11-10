import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import Ports from "../../Configuration GUI/src/sites/Ports";
import { infos, ports } from "./fixtures";

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock("../../Configuration GUI/src/common/API", () => ({
    default: {},
    get: mocks.get,
    post: mocks.post,
}));

describe("Ports request failure regression", () => {
    /** Unreleased: Fixed an initial `/api/ports` failure leaving the Ports page on an indefinite loading spinner. */
    test("unreleased_initial_ports_get_failure_is_recoverable", async () => {
        const port = { ...ports[0], auto_neg: "PM_AN_DEFAULT" };
        let attempts = 0;
        mocks.get.mockImplementation(async ({ route }: { route: string }) => {
            if (route === "/ports") {
                attempts += 1;
                return attempts === 1 ? undefined : { status: 200, data: [port] };
            }
            if (route === "/config") return { status: 200, data: { tg_ports: [] } };
            throw new Error(`unexpected route ${route}`);
        });

        render(<Ports p4tg_infos={infos()} />);

        expect(await screen.findByRole("alert")).toHaveTextContent(/could not load ports/i);
        const retry = screen.getByRole("button", { name: /retry/i });
        expect(retry).toBeEnabled();
        await userEvent.click(retry);
        expect(await screen.findByText("1/0")).toBeInTheDocument();
        await waitFor(() => expect(screen.queryByRole("alert")).not.toBeInTheDocument());
        expect(attempts).toBe(2);
    });

    /** v2.8.1: Fixed the Ports page breaking when a port/ARP configuration request or the config fetch failed. */
    test("v2_8_1_ports_request_failures", async () => {
        const port = { ...ports[0], auto_neg: "PM_AN_DEFAULT" };
        mocks.get.mockImplementation(async ({ route }: { route: string }) => {
            if (route === "/ports") return { status: 200, data: [port] };
            if (route === "/config") return undefined;
            throw new Error(`unexpected route ${route}`);
        });
        mocks.post.mockResolvedValue(undefined);
        render(<Ports p4tg_infos={infos()} />);

        await screen.findByText("1/0");
        expect(screen.getByRole("button", { name: /Refresh/ })).toBeEnabled();
        expect(screen.getByDisplayValue("Unknown")).toBeInTheDocument();
        await userEvent.click(screen.getByRole("checkbox"));
        await waitFor(() => expect(mocks.post).toHaveBeenCalledWith({
            route: "/ports/arp",
            body: { front_panel_port: 1, arp_reply: true, mac: "Unknown", channel: 0 },
        }));
        expect(screen.getByText("1/0")).toBeInTheDocument();
    });
});
