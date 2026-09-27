import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 45_000,
  // A cold production preview compresses the WASM asset on demand.
  expect: { timeout: 20_000 },
  use: {
    baseURL: "http://127.0.0.1:4175",
    channel: process.env.PLAYWRIGHT_CHANNEL,
    trace: "retain-on-failure",
  },
  webServer: {
    command: process.env.PLAYWRIGHT_PRODUCTION
      ? "bun run preview -- --host 127.0.0.1 --port 4175 --strictPort"
      : "bun run dev -- --host 127.0.0.1 --port 4175 --strictPort",
    url: "http://127.0.0.1:4175",
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
