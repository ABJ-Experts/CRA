import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { expect, test } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const execFileAsync = promisify(execFile);
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333";
const fixtureAdvisory = process.env.E2E_M5_06_FIXTURE_ADVISORY;
const canMutateFixture =
  process.env.E2E_M5_06_ALLOW_MUTATION === "true" &&
  fixtureAdvisory?.startsWith("CVE-M5-06-E2E-") === true;

test.skip(
  !canMutateFixture,
  "M5-06 writes require an explicitly provisioned, uniquely tagged local fixture.",
);

async function signInAsLocalOwner(page: import("@playwright/test").Page) {
  if (!ownerEmail || !ownerPassword) {
    throw new Error("Local owner credentials must be supplied through the E2E environment.");
  }
  const response = await page.request.post(`${apiOrigin}/api/v1/auth/sign-in`, {
    data: { email: ownerEmail, password: ownerPassword, remember: true },
  });
  expect(response.status()).toBe(200);
  // APIRequestContext cookie synchronisation differs between local browser
  // transports, so make the HTTP-only session handoff explicit. The values
  // remain in the test browser context only and are never logged.
  const host = new URL(apiOrigin).hostname;
  await page.context().addCookies(
    response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .flatMap((header) => toBrowserCookie(header.value, host)),
  );
}

function toBrowserCookie(header: string, domain: string) {
  const [pair, ...attributes] = header.split(";");
  const delimiter = pair?.indexOf("=") ?? -1;
  if (!pair || delimiter < 1) return [];
  const name = pair.slice(0, delimiter).trim();
  if (!name.startsWith("cra_")) return [];
  const attribute = (key: string) =>
    attributes.find((value) => value.trim().toLowerCase().startsWith(`${key}=`));
  const path = attribute("path")?.split("=").slice(1).join("=") ?? "/";
  return [{
    name,
    value: pair.slice(delimiter + 1),
    domain,
    path,
    httpOnly: attributes.some((value) => value.trim().toLowerCase() === "httponly"),
    sameSite: "Lax" as const,
  }];
}

test("owner exports a validated OpenVEX snapshot and sees safe publication failure", async ({
  page,
}, testInfo) => {
  await signInAsLocalOwner(page);
  await page.goto("/findings");

  const fixtureRow = page.getByRole("row", { name: new RegExp(fixtureAdvisory!) });
  await expect(fixtureRow).toBeVisible();
  await fixtureRow.click();
  await expect(page.getByRole("heading", { name: fixtureAdvisory! })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Validated VEX export" })).toBeVisible();

  const format = page.getByLabel("Export format");
  await format.selectOption("cyclonedx-vex");
  await expect(
    page
      .getByRole("alert")
      .filter({
        hasText: "cannot represent this scope without changing affectedness",
      }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Create validated export" })).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("m5-vex-cyclonedx-mapping-error.png"),
    fullPage: true,
  });

  await format.selectOption("openvex");
  await page.getByRole("button", { name: "Create validated export" }).click();
  await expect(page.getByRole("heading", { name: "Export snapshots" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: /OpenVEX 0\.2\.0/ }),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("m5-vex-openvex-export.png"),
    fullPage: true,
  });

  const download = page.waitForResponse((response) =>
    response.url().includes("/vex-exports/") && response.url().endsWith("/download"),
  );
  await page.getByRole("button", { name: "Download export" }).click();
  expect((await download).status()).toBe(200);

  await expect(page.getByRole("heading", { name: "Controlled publication" })).toBeVisible();
  await page.getByLabel("Configured publication target").selectOption(
    "local-egress-check",
  );
  const enableTarget = page.getByRole("button", { name: "Enable target" });
  if ((await enableTarget.count()) > 0) await enableTarget.click();
  await expect(page.getByText("Target enabled", { exact: true })).toBeVisible();
  await page
    .getByRole("checkbox", { name: /^I confirm publication of SHA-256 / })
    .check();
  await page.getByRole("button", { name: "Queue publication" }).click();
  const publicationHistory = page.getByLabel("VEX publication history");
  await expect(
    publicationHistory.getByText("Pending", { exact: true }),
  ).toBeVisible();

  await execFileAsync("node", ["dist/vulnerability-vex-publication-worker.js", "--once"], {
    cwd: "../api",
    env: process.env,
    timeout: 30_000,
  });
  await page.reload();
  const refreshedFixtureRow = page.getByRole("row", {
    name: new RegExp(fixtureAdvisory!),
  });
  await expect(refreshedFixtureRow).toBeVisible();
  await refreshedFixtureRow.click();
  await expect(
    page.getByRole("heading", { name: fixtureAdvisory! }),
  ).toBeVisible();
  await expect(
    page
      .getByLabel("VEX publication history")
      .getByText(/^(Retrying|Delivery failed)$/, {
        exact: true,
      }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "configured VEX publication target is unavailable" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Download export" })).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("m5-vex-publication-failure-retained-download.png"),
    fullPage: true,
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("m5-vex-mobile.png"),
    fullPage: true,
  });
});
