import { expect, test } from "../../Configuration GUI/node_modules/@playwright/test";
import { readFile } from "node:fs/promises";

const online = {
    status: "online",
    version: "v99.0.0",
    asic: "Tofino2",
    loopback: false,
    digests_alive: true,
    connected_clients: 0,
};

const ports = [1, 2].map((port, pid) => ({
    pid,
    port,
    channel: 0,
    loopback: "BF_LPBK_NONE",
    status: true,
    speed: "BF_SPEED_100G",
    enable: true,
    fec: "BF_FEC_TYP_NONE",
}));

const stream = (id = 1) => ({
    stream_id: id,
    app_id: id,
    frame_size: 128,
    encapsulation: 0,
    number_of_lse: 0,
    number_of_srv6_sids: 0,
    srv6_ip_tunneling: true,
    traffic_rate: 0.01,
    burst: 10,
    batches: true,
    vxlan: false,
    gtpu: false,
    ip_version: 4,
    unit: 0,
    pattern: null,
    detnet_cw: false,
    detnet_seq_num_length: null,
    mna_in_stack: false,
    mna_post_stack: false,
});

const setting = (id = 1, port = 1, active = true) => ({
    port,
    channel: 0,
    stream_id: id,
    ethernet: { eth_src: "02:00:00:00:00:01", eth_dst: "02:00:00:00:00:02" },
    ip: {
        ip_src: "192.0.2.1",
        ip_dst: "192.0.2.2",
        ip_tos: 0,
        ip_src_mask: "0.0.0.0",
        ip_dst_mask: "0.0.0.0",
    },
    active,
});

const configuration = (duration: number) => ({
    mode: 1,
    rx_mapping_mode: "per_tx_port",
    duration,
    repetitions: 1,
    drain_duration_secs: 0,
    streams: [stream()],
    stream_settings: [setting(1, 1, true), setting(1, 2, false)],
    port_tx_rx_mapping: { "1": { "0": { port: 2, channel: 0 } } },
    rtt_histogram_config: {},
    iat_histogram_config: {},
});

const emptyStats = {
    sample_mode: false,
    frame_size: {}, frame_type_data: {}, rx_rate_l1: {}, rx_rate_l2: {},
    tx_rate_l1: {}, tx_rate_l2: {}, iats: {}, rtts: {}, packet_loss: {},
    app_tx_l2: {}, app_rx_l2: {}, app_l2_frame_sizes: {}, out_of_order: {},
    elapsed_time: 0, rtt_histogram: {}, iat_histogram: {},
};
// The controller answers an idle GET /api/trafficgen with 202 and this body.
const idle = { status: 202, json: { message: "Not running." } };
const emptyTimeStats = { tx_rate_l1: {}, rx_rate_l1: {}, app_tx_l2: {}, app_rx_l2: {} };

async function mockReleaseCheck(page: import("../../Configuration GUI/node_modules/@playwright/test").Page) {
    await page.route("https://raw.githubusercontent.com/**", (route) => route.fulfill({ status: 200, body: "v99.0.0\n" }));
}

async function seedConfigs(
    page: import("../../Configuration GUI/node_modules/@playwright/test").Page,
    configs: Record<string, ReturnType<typeof configuration>>,
) {
    await page.addInitScript((value) => {
        localStorage.setItem("p4tg.storageSchema", "6");
        localStorage.setItem("saved_configs", JSON.stringify(value));
    }, configs);
}

test("actual Chromium exports and re-imports the complete settings file", async ({ page }) => {
    await mockReleaseCheck(page);
    await seedConfigs(page, { Alpha: configuration(5), Beta: configuration(8) });
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/online") return route.fulfill({ json: online });
        if (path === "/api/ports") return route.fulfill({ json: ports });
        if (path === "/api/trafficgen") return route.fulfill(idle);
        return route.fulfill({ status: 404, json: { message: `unmocked ${path}` } });
    });

    await page.goto("/settings");
    await expect(page.getByRole("tab", { name: /Alpha/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Beta/ })).toBeVisible();

    const downloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /Export/ }).first().click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe("settings.json");
    const exported = JSON.parse(await readFile(await download.path(), "utf8"));
    expect(exported.map((entry: { name: string }) => entry.name)).toEqual(["Alpha", "Beta"]);
    expect(exported[0].stream_settings).toHaveLength(1);
    expect(exported[0].stream_settings[0]).toMatchObject({ port: 1, channel: 0, active: true });
    expect(exported[1].duration).toBe(8);

    exported[0].name = "Imported Alpha";
    exported[1].name = "Imported Beta";
    await page.locator('input[type="file"]').setInputFiles({
        name: "roundtrip.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(exported)),
    });
    await expect(page.getByText("Settings imported successfully.")).toBeVisible();
    await expect(page.getByRole("tab", { name: /Imported Alpha/ })).toBeVisible();
    await expect(page.getByRole("tab", { name: /Imported Beta/ })).toBeVisible();
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("saved_configs") ?? "{}"));
    expect(Object.keys(persisted)).toEqual(["Imported Alpha", "Imported Beta"]);
    expect(persisted["Imported Alpha"].duration).toBe(5);
});

/** v2.8.1: Fixed the dashboard briefly showing the running state after a rejected start request. */
test("v2_8_1_rejected_start_state", async ({ page }) => {
    await mockReleaseCheck(page);
    const drafts = { Alpha: configuration(5), Beta: configuration(8) };
    await seedConfigs(page, drafts);
    let postCount = 0;
    let running = false;
    let postedBody: unknown;
    await page.route("**/api/**", async (route) => {
        const request = route.request();
        const path = new URL(request.url()).pathname;
        if (path === "/api/online") return route.fulfill({ json: online });
        if (path === "/api/statistics") return route.fulfill({ json: [emptyStats] });
        if (path === "/api/time_statistics") return route.fulfill({ json: [emptyTimeStats] });
        if (path === "/api/trafficgen" && request.method() === "GET") {
            return route.fulfill(running ? { json: { ...configuration(5), name: "Alpha [1/2]" } } : idle);
        }
        if (path === "/api/trafficgen" && request.method() === "POST") {
            postCount += 1;
            postedBody = request.postDataJSON();
            if (postCount === 1) {
                return route.fulfill({ status: 400, json: { message: "start rejected by controller" } });
            }
            running = true;
            return route.fulfill({ status: 200, json: {} });
        }
        if (path === "/api/reset") return route.fulfill({ json: {} });
        return route.fulfill({ status: 404, json: { message: `unmocked ${path}` } });
    });

    await page.goto("/");
    await expect(page.getByRole("button", { name: /Start/ })).toBeVisible();
    await page.getByRole("button", { name: /Start/ }).click();
    await expect(page.getByText("start rejected by controller")).toBeVisible();
    await expect(page.getByRole("button", { name: /Start/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Stop/ })).toHaveCount(0);

    await page.getByRole("button", { name: /Start/ }).click();
    await expect(page.getByRole("button", { name: /Stop/ })).toBeVisible();
    await expect(page.getByText("Run 1 / 2")).toBeVisible();
    expect(postCount).toBe(2);
    expect((postedBody as Array<{ name: string }>).map((entry) => entry.name)).toEqual(["Alpha", "Beta"]);
    expect((postedBody as Array<{ stream_settings: unknown[] }>)[0].stream_settings).toHaveLength(1);
    const persisted = await page.evaluate(() => JSON.parse(localStorage.getItem("saved_configs") ?? "{}"));
    expect(Object.keys(persisted)).toEqual(["Alpha", "Beta"]);
    expect(persisted.Alpha.duration).toBe(5);
    expect(persisted.Beta.duration).toBe(8);
});

/** v2.4.0: Fixed frontend crash if controller goes offline. */
test("v2_4_0_offline_controller_crash", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await mockReleaseCheck(page);
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/online") return route.fulfill({ json: online });
        if (path === "/api/statistics") return route.abort("connectionfailed");
        if (path === "/api/time_statistics") return route.fulfill({ json: [emptyTimeStats] });
        if (path === "/api/trafficgen") return route.fulfill(idle);
        return route.fulfill({ status: 404, json: {} });
    });

    await page.goto("/");
    await expect(page.getByText("P4TG device not reachable")).toBeVisible();
    await expect(page.locator(".bi-wifi-off")).toBeVisible();
    expect(await page.evaluate(() => window.innerWidth)).toBe(390);
});

/** v2.8.5: Fixed the GUI going blank when hovering "Add stream" or "Add IMIX" on the Settings page. */
test("v2_8_5_add_stream_hover_crash", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await mockReleaseCheck(page);
    // Tofino 2 allows 15 streams: "Below" keeps both buttons enabled (no
    // tooltip), "Full" reaches the limit so both tooltips must still render.
    await seedConfigs(page, { Below: configuration(0) });
    await page.route("**/api/**", async (route) => {
        const path = new URL(route.request().url()).pathname;
        if (path === "/api/online") return route.fulfill({ json: online });
        if (path === "/api/ports") return route.fulfill({ json: ports });
        if (path === "/api/trafficgen") return route.fulfill(idle);
        return route.fulfill({ status: 404, json: { message: `unmocked ${path}` } });
    });

    await page.goto("/settings");
    const addStream = page.getByRole("button", { name: /Add stream/ });
    const addIMIX = page.getByRole("button", { name: /Add IMIX/ });
    await expect(addStream).toBeEnabled();
    for (const button of [addStream, addIMIX, addStream]) {
        await button.hover();
        // Outlast the tooltip fade so a broken transition end listener fires.
        await page.waitForTimeout(500);
        expect(errors).toEqual([]);
    }
    await expect(page.getByRole("tab", { name: /Below/ })).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);

    const full = configuration(0);
    full.streams = Array.from({ length: 15 }, (_, index) => stream(index + 1));
    full.stream_settings = full.streams.map(({ stream_id }) => setting(stream_id, 1, true));
    // Init scripts run in registration order, so this one replaces "Below".
    await seedConfigs(page, { Full: full });
    await page.reload();
    await expect(page.getByRole("tab", { name: /Full/ })).toBeVisible();
    await expect(addStream).toBeDisabled();
    await addStream.locator("..").hover();
    await expect(page.getByRole("tooltip", { name: "Maximum number of streams reached" })).toBeVisible();
    await addIMIX.locator("..").hover();
    await expect(page.getByRole("tooltip", { name: /IMIX requires/ })).toBeVisible();
    expect(errors).toEqual([]);
});
