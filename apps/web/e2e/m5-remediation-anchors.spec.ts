import { expect, test } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const e2eOwnerEmail = process.env.E2E_OWNER_EMAIL;
const e2eOwnerPassword = process.env.E2E_OWNER_PASSWORD;
const e2eApiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333";
const fixtureAdvisory = process.env.E2E_M5_05_FIXTURE_ADVISORY;
const canMutateTaggedFixture =
  process.env.E2E_M5_05_ALLOW_MUTATION === "true" &&
  fixtureAdvisory?.startsWith("CVE-M5-05-E2E-") === true;

test.skip(
  !canMutateTaggedFixture,
  "M5-05 writes require an explicitly provisioned, uniquely tagged local fixture.",
);

async function signInAsOwner(page: import("@playwright/test").Page) {
  if (!e2eOwnerEmail || !e2eOwnerPassword) {
    throw new Error(
      "E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD are required for the local owner journey.",
    );
  }
  const response = await page.request.post(`${e2eApiOrigin}/api/v1/auth/sign-in`, {
    data: {
      email: e2eOwnerEmail,
      password: e2eOwnerPassword,
      remember: true,
    },
  });
  expect(response.status()).toBe(200);
}

function localPastDateTime() {
  const past = new Date(Date.now() - 5 * 60 * 1000);
  return new Date(past.getTime() - past.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

test("owner records or corrects a remediation anchor for the tagged local fixture", async ({
  page,
}, testInfo) => {
  await signInAsOwner(page);
  await page.goto("/findings");

  await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Remediation" }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Reintroduction" }),
  ).toBeVisible();

  const fixtureRow = page.getByRole("row", {
    name: new RegExp(fixtureAdvisory!),
  });
  await expect(fixtureRow).toBeVisible();
  await fixtureRow.click();
  await expect(
    page.getByRole("heading", { name: fixtureAdvisory! }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Remediation anchor" }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: /^(Record remediation|Correct remediation)$/,
    })
    .click();

  const dialog = page.getByRole("dialog", {
    name: /^(Record remediation anchor|Correct remediation anchor)$/,
  });
  await expect(dialog).toBeVisible();
  const submit = dialog.getByRole("button", {
    name: /^(Record remediation|Save correction)$/,
  });
  await submit.click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("m5-remediation-validation.png"),
    fullPage: true,
  });

  await dialog.getByLabel("Remediation type").selectOption("corrective");
  await dialog.getByLabel("Fix version").fill(`2.4.${Date.now()}`);
  await dialog
    .getByLabel("Mitigation description")
    .fill("M5-05 browser verification: vendor correction package is available.");
  await dialog.getByLabel("Availability timestamp").fill(localPastDateTime());
  await dialog
    .getByLabel("Human/business availability basis")
    .fill("M5-05 browser verification: maintainer confirmation was reviewed.");
  const correctionReason = dialog.getByLabel("Correction reason");
  if (await correctionReason.isVisible()) {
    await correctionReason.fill(
      "M5-05 browser verification correction for the local tagged fixture.",
    );
  }
  await submit.click();

  await expect(dialog).toBeHidden();
  const detail = page.getByRole("complementary");
  await expect(detail.getByText("Fix available", { exact: true })).toBeVisible();
  await expect(detail.getByText("Human asserted", { exact: true })).toBeVisible();
  await expect(
    detail.getByText(/Human\/business availability evidence\. Recording it does not change VEX/i),
  ).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("m5-remediation-available-detail.png"),
    fullPage: true,
  });

  await page
    .getByRole("combobox", { name: "Remediation" })
    .selectOption("available");
  await expect(page.getByText("Loading the triage queue…")).toBeHidden();
  await expect(fixtureRow).toBeVisible();
  await page
    .getByRole("combobox", { name: "Reintroduction" })
    .selectOption("not_evaluated");
  await expect(page.getByText("Loading the triage queue…")).toBeHidden();
  await expect(fixtureRow).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath("m5-remediation-filters.png"),
    fullPage: true,
  });
});

test("remediation controls remain readable on a narrow viewport", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAsOwner(page);
  await page.goto("/findings");

  await expect(page.getByRole("heading", { name: "Findings" })).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Remediation" }),
  ).toBeVisible();
  await expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await expect(page.getByText("Loading the triage queue…")).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("m5-remediation-mobile.png"),
    fullPage: true,
  });
});
