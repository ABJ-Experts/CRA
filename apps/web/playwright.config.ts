import { defineConfig, devices } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright configuration is evaluated outside Turbo. */

// Next development resources are served from localhost by default. Keeping
// Playwright on that origin prevents its dev-origin protection from blocking
// client hydration during local browser journeys.
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3000";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./test-results/e2e",
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: 1,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: webOrigin,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
