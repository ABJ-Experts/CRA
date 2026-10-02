import { expect, test } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const e2eOwnerEmail = process.env.E2E_OWNER_EMAIL;
const e2eOwnerPassword = process.env.E2E_OWNER_PASSWORD;

async function signInAsOwner(page: import("@playwright/test").Page) {
  if (!e2eOwnerEmail || !e2eOwnerPassword) {
    throw new Error(
      "E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD are required for the local owner journey.",
    );
  }
  const response = await page.request.post(
    `${process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333"}/api/v1/auth/sign-in`,
    {
      data: {
        email: e2eOwnerEmail,
        password: e2eOwnerPassword,
        remember: true,
      },
    },
  );
  expect(response.status()).toBe(200);
}

test("owner can inspect internal triage filters without mutating local data", async ({
  page,
}, testInfo) => {
  await signInAsOwner(page);
  await page.goto("/findings");

  await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
  await expect(page.getByLabel("Queue state")).toBeVisible();
  await expect(
    page.getByRole("grid", { name: "Triage findings" }),
  ).toBeVisible();
  await expect(
    page
      .locator("label")
      .filter({ hasText: /^Internal SLA/ })
      .locator("select"),
  ).toBeVisible();
  await expect(
    page
      .locator("label")
      .filter({ hasText: /^Alert delivery/ })
      .locator("select"),
  ).toBeVisible();
  await page.getByLabel("Queue state").selectOption("suppressed");
  await expect(page.getByText("Loading the triage queue…")).toBeHidden();

  await page.screenshot({
    path: testInfo.outputPath("m5-suppression-sla-filters.png"),
    fullPage: true,
  });
});

test("owner validates and suppresses the tagged local triage fixture", async ({
  page,
}, testInfo) => {
  await signInAsOwner(page);
  await page.goto("/findings");

  const fixtureRow = page.getByRole("row", {
    name: /CVE-M5-VEX-BROWSER-0001/,
  });
  await expect(fixtureRow).toBeVisible();
  await fixtureRow.click();
  await expect(
    page.getByRole("heading", { name: "CVE-M5-VEX-BROWSER-0001" }),
  ).toBeVisible();

  const suppressOrExtend = page.getByRole("button", {
    name: /^(Suppress finding|Extend suppression)$/,
  });
  await suppressOrExtend.click();
  await page.getByLabel("Suppression reason").fill("");
  await page.getByRole("button", { name: "Save suppression" }).click();
  await expect(page.getByRole("alert")).toContainText("A reason is required.");

  await page
    .getByLabel("Suppression reason")
    .fill("M5-04 local browser verification");
  const futureExpiry = new Date(Date.now() + 60 * 60 * 1000);
  const expiry = new Date(
    futureExpiry.getTime() - futureExpiry.getTimezoneOffset() * 60_000,
  )
    .toISOString()
    .slice(0, 16);
  await page.getByLabel("Suppression expiry").fill(expiry);
  await page.getByRole("button", { name: "Save suppression" }).click();

  await expect(
    page.getByRole("dialog", {
      name: /^(Suppress finding|Extend suppression)$/,
    }),
  ).toBeHidden();
  await expect(page.getByText("Suppressed until")).toBeVisible();
  await expect(
    page.getByText("Suppression reason: M5-04 local browser verification"),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("m5-suppressed-detail.png"),
    fullPage: true,
  });

  await page.getByLabel("Queue state").selectOption("suppressed");
  await expect(fixtureRow).toBeVisible();
});

test("triage controls remain usable on a narrow viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsOwner(page);
  await page.goto("/findings");

  await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
  await expect(page.getByLabel("Queue state")).toBeVisible();
  await expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("m5-triage-mobile.png"),
    fullPage: true,
  });
});
