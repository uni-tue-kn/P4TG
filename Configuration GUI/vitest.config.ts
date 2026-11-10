import { defineConfig } from "vitest/config";

export default defineConfig({
    server: {
        fs: { allow: [".."] },
    },
    test: {
        environment: "jsdom",
        include: ["../tests/gui/**/*.test.ts"],
        restoreMocks: true,
    },
});
