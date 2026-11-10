import React from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, test, vi } from "vitest";
import {
    DefaultStream,
    DefaultStreamSettings,
    Encapsulation,
    Stream,
    StreamSettings,
} from "../../Configuration GUI/src/common/Interfaces";
import SettingsModal, {
    ensureDefaults,
    stripUnusedFields,
} from "../../Configuration GUI/src/components/settings/SettingsModal";
import { infos } from "./fixtures";

type ProtocolCase = {
    name: string;
    stream: Stream;
    headers: string[];
    absentHeaders?: string[];
    verify: (data: StreamSettings) => void;
};

const base = DefaultStream(1);
const protocolCases: ProtocolCase[] = [
    {
        name: "Ethernet + IPv4",
        stream: base,
        headers: ["Ethernet", "IPv4"],
        absentHeaders: ["IPv6", "VLAN", "QinQ", "MPLS", "SRv6", "VxLAN", "GTP-U"],
        verify: (data) => {
            expect(data.ethernet).toEqual({ eth_src: "32:D5:42:2A:F6:92", eth_dst: "81:E7:9D:E3:AD:47" });
            expect(data.ip).toMatchObject({ ip_src: "192.168.178.10", ip_dst: "192.168.178.11", ip_tos: 0 });
            expect(data.ipv6).toBeUndefined();
        },
    },
    {
        name: "IPv6",
        stream: { ...base, ip_version: 6 },
        headers: ["Ethernet", "IPv6"],
        absentHeaders: ["IPv4"],
        verify: (data) => {
            expect(data.ip).toBeUndefined();
            expect(data.ipv6).toMatchObject({ ipv6_src: "ff80::", ipv6_dst: "ff80::", ipv6_flow_label: 0 });
        },
    },
    {
        name: "VLAN",
        stream: { ...base, encapsulation: Encapsulation.Q },
        headers: ["Ethernet", "VLAN", "IPv4"],
        absentHeaders: ["QinQ", "MPLS"],
        verify: (data) => expect(data.vlan).toEqual({ vlan_id: 1, pcp: 0, dei: 0, inner_vlan_id: 1, inner_pcp: 0, inner_dei: 0 }),
    },
    {
        name: "QinQ",
        stream: { ...base, encapsulation: Encapsulation.QinQ },
        headers: ["Ethernet", "QinQ", "IPv4"],
        absentHeaders: ["VLAN", "MPLS"],
        verify: (data) => expect(data.vlan).toMatchObject({ vlan_id: 1, inner_vlan_id: 1 }),
    },
    {
        name: "MPLS",
        stream: { ...base, encapsulation: Encapsulation.MPLS, number_of_lse: 2 },
        headers: ["Ethernet", "MPLS", "IPv4"],
        absentHeaders: ["VLAN", "SRv6"],
        verify: (data) => {
            expect(data.mpls_stack).toHaveLength(2);
            expect(data.mpls_stack?.[0]).toEqual({ label: 20, tc: 0, ttl: 64 });
            expect(data.mpls_stack?.[1]).toEqual({ label: 20, tc: 0, ttl: 64 });
        },
    },
    {
        name: "SRv6 without inner IP",
        stream: {
            ...base,
            encapsulation: Encapsulation.SRv6,
            ip_version: 6,
            number_of_srv6_sids: 2,
            srv6_ip_tunneling: false,
        },
        headers: ["Ethernet", "SRv6"],
        absentHeaders: ["IPv4", "IPv6", "MPLS"],
        verify: (data) => {
            expect(data.srv6_base_header).toMatchObject({ ipv6_src: "ff80::", ipv6_dst: "ff80::" });
            expect(data.sid_list).toEqual(["ff80::", "ff80::"]);
        },
    },
    {
        name: "VxLAN",
        stream: { ...base, vxlan: true },
        headers: ["VxLAN", "Ethernet", "IPv4"],
        absentHeaders: ["GTP-U"],
        verify: (data) => expect(data.vxlan).toEqual({
            eth_src: "32:D5:42:2A:F6:92",
            eth_dst: "81:E7:9D:E3:AD:47",
            ip_src: "192.168.178.10",
            ip_dst: "192.168.178.11",
            ip_tos: 0,
            udp_source: 49152,
            vni: 1,
        }),
    },
    {
        name: "GTP-U",
        stream: { ...base, gtpu: true },
        headers: ["Ethernet", "GTP-U", "IPv4"],
        absentHeaders: ["VxLAN"],
        verify: (data) => expect(data.gtpu).toEqual({
            ip_src: "192.168.178.10",
            ip_dst: "192.168.178.11",
            ip_tos: 0,
            udp_source: 49152,
            teid: 42,
        }),
    },
];

describe("SettingsModal protocol rendering and persistence", () => {
    test.each(protocolCases)("renders and saves $name settings", async ({ stream, headers, absentHeaders, verify }) => {
        const data = DefaultStreamSettings(1, 1, 0);
        // Seed stale protocol fields to prove Confirm strips disabled protocols.
        if (stream.encapsulation !== Encapsulation.Q && stream.encapsulation !== Encapsulation.QinQ) {
            data.vlan = { vlan_id: 99, pcp: 1, dei: 0, inner_vlan_id: 2, inner_pcp: 0, inner_dei: 0 };
        }
        if (stream.encapsulation !== Encapsulation.MPLS) {
            data.mpls_stack = [{ label: 99, tc: 1, ttl: 1 }];
        }
        const hide = vi.fn();
        render(<SettingsModal show hide={hide} data={data} running={false} stream={stream} p4tg_infos={infos()} />);

        expect(screen.getByText(/Stream #/)).toHaveTextContent("Stream #1");
        for (const header of headers) {
            expect(screen.getByRole("button", { name: header })).toBeInTheDocument();
        }
        for (const header of absentHeaders ?? []) {
            expect(screen.queryByRole("button", { name: header })).not.toBeInTheDocument();
        }

        await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
        expect(hide).toHaveBeenCalledOnce();
        verify(data);
        if (stream.encapsulation !== Encapsulation.Q && stream.encapsulation !== Encapsulation.QinQ) {
            expect(data.vlan).toBeUndefined();
        }
        if (stream.encapsulation !== Encapsulation.MPLS) {
            expect(data.mpls_stack).toBeUndefined();
        }
        if (!stream.vxlan) expect(data.vxlan).toBeUndefined();
        if (!stream.gtpu) expect(data.gtpu).toBeUndefined();
    });

    test("edits Ethernet fields and blocks invalid values before mutating caller state", async () => {
        const data = DefaultStreamSettings(1, 1, 0);
        const hide = vi.fn();
        render(<SettingsModal show hide={hide} data={data} running={false} stream={base} p4tg_infos={infos()} />);
        const user = userEvent.setup();
        const source = screen.getByDisplayValue(data.ethernet.eth_src);

        await user.clear(source);
        await user.type(source, "not-a-mac");
        await user.click(screen.getByRole("button", { name: "Confirm" }));
        expect(screen.getByText("Ethernet source not a valid MAC.")).toBeInTheDocument();
        expect(hide).not.toHaveBeenCalled();
        expect(data.ethernet.eth_src).toBe("32:D5:42:2A:F6:92");

        await user.clear(source);
        await user.type(source, "02:00:00:00:00:01");
        await user.click(screen.getByRole("button", { name: "Confirm" }));
        expect(hide).toHaveBeenCalledOnce();
        expect(data.ethernet.eth_src).toBe("02:00:00:00:00:01");
        expect(screen.queryByText("Ethernet source not a valid MAC.")).not.toBeInTheDocument();
    });

    test("validates VxLAN VNI and GTP-U TEID boundaries", async () => {
        const data = DefaultStreamSettings(1, 1, 0);
        const stream = { ...base, vxlan: true, gtpu: true };
        const hide = vi.fn();
        render(<SettingsModal show hide={hide} data={data} running={false} stream={stream} p4tg_infos={infos()} />);
        const user = userEvent.setup();

        await user.click(screen.getByRole("button", { name: "VxLAN" }));
        const vni = screen.getByDisplayValue("1");
        await user.clear(vni);
        await user.type(vni, "16777216");
        await user.click(screen.getByRole("button", { name: "Confirm" }));
        expect(screen.getByText("VxLAN VNI not valid.")).toBeInTheDocument();
        expect(hide).not.toHaveBeenCalled();

        await user.clear(vni);
        await user.type(vni, "100");
        await user.click(screen.getByRole("button", { name: "GTP-U" }));
        const teid = screen.getByDisplayValue("42");
        await user.clear(teid);
        await user.type(teid, "4294967296");
        await user.click(screen.getByRole("button", { name: "Confirm" }));
        expect(screen.getByText("GTP-U TEID not valid.")).toBeInTheDocument();

        await user.clear(teid);
        await user.type(teid, "4294967295");
        await user.click(screen.getByRole("button", { name: "Confirm" }));
        expect(hide).toHaveBeenCalledOnce();
        expect(data.vxlan?.vni).toBe(100);
        expect(data.gtpu?.teid).toBe(0xffffffff);
    });

    test("running mode makes protocol fields and Confirm read-only while Close remains usable", async () => {
        const hide = vi.fn();
        render(<SettingsModal
            show
            hide={hide}
            data={DefaultStreamSettings(1, 1, 0)}
            running
            stream={{ ...base, vxlan: true }}
            p4tg_infos={infos()}
        />);

        expect(screen.getByRole("button", { name: "Confirm" })).toBeDisabled();
        const close = screen.getAllByRole("button", { name: "Close" }).find((button) => button.textContent === "Close")!;
        expect(close).toBeEnabled();
        expect(screen.getAllByDisplayValue("32:D5:42:2A:F6:92").every((input) => (input as HTMLInputElement).disabled)).toBe(true);
        await userEvent.click(close);
        expect(hide).toHaveBeenCalledOnce();
    });
});

describe("protocol normalization helpers", () => {
    test("ensureDefaults adds every enabled protocol without replacing existing values", () => {
        const stream = {
            ...base,
            encapsulation: Encapsulation.SRv6,
            ip_version: 6,
            number_of_srv6_sids: 3,
            vxlan: true,
            gtpu: true,
        };
        const data = DefaultStreamSettings(1, 1, 0);
        data.ethernet.eth_src = "02:00:00:00:00:01";
        const result = ensureDefaults(data, stream);
        expect(result.ethernet.eth_src).toBe("02:00:00:00:00:01");
        expect(result.ipv6).toBeDefined();
        expect(result.srv6_base_header).toBeDefined();
        expect(result.sid_list).toHaveLength(3);
        expect(result.vxlan).toBeDefined();
        expect(result.gtpu).toBeDefined();
    });

    test("stripUnusedFields produces a minimal payload after features are disabled", () => {
        const all = ensureDefaults(DefaultStreamSettings(1, 1, 0), {
            ...base,
            encapsulation: Encapsulation.SRv6,
            ip_version: 6,
            number_of_srv6_sids: 1,
            vxlan: true,
            gtpu: true,
        });
        all.vlan = { vlan_id: 1, pcp: 0, dei: 0, inner_vlan_id: 1, inner_pcp: 0, inner_dei: 0 };
        all.mpls_stack = [{ label: 20, tc: 0, ttl: 64 }];
        const result = stripUnusedFields(all, base);
        expect(result.ip).toBeDefined();
        expect(result.ipv6).toBeUndefined();
        expect(result.vlan).toBeUndefined();
        expect(result.mpls_stack).toBeUndefined();
        expect(result.srv6_base_header).toBeUndefined();
        expect(result.sid_list).toBeUndefined();
        expect(result.vxlan).toBeUndefined();
        expect(result.gtpu).toBeUndefined();
    });
});
