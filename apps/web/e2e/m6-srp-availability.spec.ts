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

test("owner sees the SRP-unavailable manual fallback after generating a local package", async ({
  page,
}, testInfo) => {
  await signInAsOwner(page);
  await page.goto("/reporting");
  await expect(
    page.getByRole("heading", { name: "Reporting obligations" }),
  ).toBeVisible();

  const marker = `LOCAL-M6-SRP-E2E-${Date.now()}`;
  const create = page.locator("form").filter({
    has: page.getByRole("heading", { name: "Open obligation" }),
  });
  await create
    .getByLabel("Awareness basis")
    .fill(`${marker}: local-only browser fixture.`);
  const opened = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/reporting/obligations") &&
      response.request().method() === "POST",
  );
  await create.getByRole("button", { name: "Open obligation" }).click();
  const openedResponse = await opened;
  expect(openedResponse.status()).toBe(201);
  const openedBody = (await openedResponse.json()) as {
    obligation: { id: string };
  };

  await page.goto(`/reporting?obligationId=${openedBody.obligation.id}`);
  const detail = page.getByRole("complementary");
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
  await draft.getByLabel("Current password").fill(ownerPassword!);
  await draft
    .getByLabel("Owner override reason (only when approving your own edits)")
    .fill("The seeded owner is the authorized local browser test responder.");
  await draft.getByRole("button", { name: "Reauthenticate" }).click();
  await expect(draft.getByText("Fresh approval proof ready.")).toBeVisible();
  await draft.getByRole("button", { name: "Approve stage" }).click();
  await draft.getByRole("button", { name: "Generate package" }).click();
  await expect(draft.getByText(/Package ready:/)).toBeVisible();

  const notice = draft.getByRole("status", {
    name: "ENISA SRP submission availability",
  });
  await expect(notice).toContainText("Automated SRP submission is unavailable");
  await expect(notice).toContainText("ENISA has not published a supported API");
  await expect(notice).toContainText("Signed manual package");
  await expect(notice).toContainText("Record external filing");
  await expect(draft.getByRole("button", { name: /submit to ENISA/i })).toHaveCount(0);

  await page.screenshot({
    path: testInfo.outputPath("m6-srp-availability-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(notice).toBeVisible();
  await expect(
    await page
      .locator("html")
      .evaluate((element) => element.scrollWidth - window.innerWidth <= 2),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("m6-srp-availability-mobile.png"),
    fullPage: true,
  });
});
