import { defineConfig, devices } from "../../Configuration GUI/node_modules/@playwright/test";

const baseURL = process.env.P4TG_PLAYWRIGHT_BASE_URL;
if (!baseURL) {
    throw new Error("P4TG_PLAYWRIGHT_BASE_URL must point to the already-running GUI server");
}

export default defineConfig({
    testDir: ".",
    testMatch: "**/*.e2e.ts",
    timeout: 20_000,
    expect: { timeout: 5_000 },
    fullyParallel: false,
    workers: 1,
    reporter: "line",
    outputDir: "/tmp/p4tg-ci-playwright-results",
    use: {
        baseURL,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
    },
    projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
