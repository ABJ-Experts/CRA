import { expect, test } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const localReleaseId = "87b00cd4-ed54-4e77-83fa-c001e8268adf";
test.skip(
  !ownerEmail || !ownerPassword,
  "E2E_OWNER_EMAIL and E2E_OWNER_PASSWORD are required for the local owner journey.",
);

async function signInAsOwner(page: import("@playwright/test").Page) {
  // This is context-bound, so the real API's HttpOnly cookies become browser
  // cookies without exposing them to test code or the page.
  const response = await page.request.post("/api/v1/auth/sign-in", {
    data: { email: ownerEmail, password: ownerPassword, remember: true },
  });
  expect(response.status()).toBe(200);
  await page.goto("/dashboard");
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

test("owner creates and submits a local collaborative stage draft", async ({
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
  await expect(
    stages.locator("li").filter({ hasText: /Early Warning.*remaining.*elapsed/ }),
  ).toBeVisible();
  await expect(
    stages.locator("li").filter({ hasText: /Final Report.*Pending anchor/ }),
  ).toBeVisible();

  const draft = detail.locator("section").filter({
    has: page.getByRole("heading", { name: "Early Warning draft" }),
  });
  await expect(draft).toBeVisible();
  await draft.getByPlaceholder("Release UUID").fill(localReleaseId);
  await draft.getByRole("button", { name: "Create draft" }).click();
  await draft.getByRole("button", { name: "Edit draft" }).click();
  await expect(draft.getByText("Editing lock acquired.")).toBeVisible();
  await draft.locator("textarea").nth(0).fill(`${marker}: initial summary.`);
  await draft.locator("textarea").nth(1).fill(`${marker}: known impact.`);
  await draft
    .getByLabel("Member States (comma-separated ISO codes)")
    .fill("DE");
  await draft.getByRole("button", { name: "Save draft" }).click();
  await draft
    .getByPlaceholder("Regulator portal or filing reference")
    .fill(`${marker}-DRAFT-SUBMISSION`);
  await draft.getByLabel("Current password").fill(ownerPassword!);
  await draft
    .getByLabel("Owner override reason (only when approving your own edits)")
    .fill("The seeded owner is the only authorized responder for this local verification.");
  await draft.getByRole("button", { name: "Reauthenticate" }).click();
  await expect(draft.getByText("Fresh approval proof ready.")).toBeVisible();
  await expect(
    draft.getByRole("button", { name: "Approve and record submission" }),
  ).toBeEnabled();
  await draft.getByRole("button", { name: "Approve and record submission" }).click();
  await expect(
    stages.locator("li").filter({ hasText: /Early Warning.*submitted/ }),
  ).toBeVisible();

  await page.screenshot({
    path: testInfo.outputPath("m6-reporting-obligation-desktop.png"),
    fullPage: true,
  });

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
