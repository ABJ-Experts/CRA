import { expect, test } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
test.skip(
  !ownerEmail || !ownerPassword,
  "E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD are required for the local owner journey.",
);

async function signInAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByTestId("si-identifier").fill(ownerEmail!);
  await page.getByTestId("si-password").fill(ownerPassword!);
  const response = page.waitForResponse((candidate) =>
    candidate.url().endsWith("/api/v1/auth/sign-in"),
  );
  await page.getByTestId("si-submit").click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);

  const selected = await page.evaluate(async () => {
    const sessionResponse = await fetch("/api/v1/auth/session");
    if (!sessionResponse.ok) return false;
    const session = (await sessionResponse.json()) as {
      organizations: Array<{ id: string; role: string }>;
    };
    const organization =
      session.organizations.find((candidate) => candidate.role === "owner") ??
      session.organizations[0];
    if (!organization) return false;
    const switchResponse = await fetch("/api/v1/organizations/switch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ organizationId: organization.id }),
    });
    return switchResponse.ok;
  });
  expect(selected).toBe(true);
}

test("owner creates, anchors, submits, and cancels a local reporting obligation", async ({
  page,
}, testInfo) => {
  await signInAsOwner(page);
  await page.goto("/reporting");

  await expect(
    page.getByRole("heading", { name: "Reporting obligations" }),
  ).toBeVisible();

  const create = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Open obligation" }),
  });
  const marker = `LOCAL-M6-E2E-${Date.now()}`;
  await create
    .getByLabel("Awareness basis")
    .fill(`${marker}: a human asserted awareness for browser verification.`);
  await create.getByRole("button", { name: "Open obligation" }).click();

  const detail = page.getByRole("complementary");
  const stages = detail.locator("ol");
  await expect(stages.getByText("Early Warning", { exact: true })).toBeVisible();
  await expect(stages.getByText("Final Report", { exact: true })).toBeVisible();

  const correction = detail.locator("form").filter({ hasText: "Correct anchor" });
  await correction.locator("select").selectOption("remediation_available");
  await correction
    .getByPlaceholder("Correction reason")
    .fill(`${marker}: remediation became available.`);
  await correction.getByRole("button", { name: "Save correction" }).click();
  await expect(stages.getByText("Final Report", { exact: true })).toBeVisible();
  await expect(
    stages.locator("li").filter({ hasText: /Final Report.*running/ }),
  ).toBeVisible();

  const submission = detail
    .locator("form")
    .filter({ hasText: "Record submission" });
  await submission
    .getByPlaceholder("Submission reference")
    .fill(`${marker}-SUBMISSION`);
  await submission
    .getByRole("button", { name: "Record submission" })
    .click();
  await expect(
    stages.locator("li").filter({ hasText: /Early Warning.*submitted/ }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("m6-reporting-obligation-desktop.png"),
    fullPage: true,
  });

  await detail.getByRole("button", { name: "Cancel obligation" }).click();
  await expect(detail.getByText("Cancelled:", { exact: false })).toBeVisible();
  await expect(
    stages.locator("li").filter({ hasText: /Notification.*not_required/ }),
  ).toBeVisible();
  await expect(
    stages.locator("li").filter({ hasText: /Final Report.*not_required/ }),
  ).toBeVisible();

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("m6-reporting-obligation-mobile.png"),
    fullPage: true,
  });
});
