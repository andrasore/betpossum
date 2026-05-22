import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  globalSetup: "./global-setup.ts",
  globalTeardown: "./global-teardown.ts",
  reporter: "list",
  use: {
    baseURL: "http://localhost:18080",
    browserName: "chromium",
    channel: "chromium",
    trace: "on-first-retry",
    launchOptions: {
      executablePath: "/usr/bin/chromium",
    },
  },
});
