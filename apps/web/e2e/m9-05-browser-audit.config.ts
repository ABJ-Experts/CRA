import { defineConfig, devices } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Opt-in browser audit runs outside Turbo. */

/** Opt-in cross-browser audit; the normal Chromium suite is unchanged. */
export default defineConfig({
  testDir: ".",
  testMatch: "m9-05-grounded-extraction.spec.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 45_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL: process.env.E2E_WEB_ORIGIN ?? "http://localhost:3000",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    {
      name: "chrome",
      use: { ...devices["Desktop Chrome"], channel: "chrome" },
    },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
