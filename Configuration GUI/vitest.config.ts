import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
    resolve: {
        // Tests live outside Vite's project root; keep their bare test-library
        // imports anchored to the GUI installation used by npm ci.
        alias: [
            { find: "@testing-library", replacement: resolve(__dirname, "node_modules/@testing-library") },
            { find: /^react$/, replacement: resolve(__dirname, "node_modules/react/index.js") },
            { find: "react/jsx-dev-runtime", replacement: resolve(__dirname, "node_modules/react/jsx-dev-runtime.js") },
            { find: "react/jsx-runtime", replacement: resolve(__dirname, "node_modules/react/jsx-runtime.js") },
        ],
    },
    server: {
        fs: { allow: [".."] },
    },
    test: {
        environment: "jsdom",
        include: ["../tests/gui/**/*.test.{ts,tsx}"],
        setupFiles: ["../tests/gui/setup.ts"],
        restoreMocks: true,
        coverage: {
            provider: "v8",
            reporter: ["text", "json-summary"],
            reportsDirectory: "/tmp/p4tg-ci-gui-coverage",
            include: ["src/**/*.{ts,tsx}"],
            exclude: ["src/index.tsx", "src/react-app-env.d.ts"],
        },
    },
});
