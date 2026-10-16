import { defineConfig, devices } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Task verification is outside Turbo. */
export default defineConfig({
  testDir: "./e2e",
  testMatch: "m15-03*.spec.ts",
  outputDir: "../../.superpowers/sdd/2026-10-14-m15-03/browser-artifacts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile:
          "../../.superpowers/sdd/2026-10-14-m15-03/browser-results.json",
      },
    ],
  ],
  use: {
    baseURL: process.env.E2E_WEB_ORIGIN ?? "http://localhost:3007",
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
