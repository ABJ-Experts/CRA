import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://127.0.0.1:3333";
const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3000";
const productId = process.env.E2E_M7_PRODUCT_ID;
const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !productId || !ownerEmail || !ownerPassword,
  "E2E_M7_PRODUCT_ID, E2E_OWNER_EMAIL, and E2E_OWNER_PASSWORD are required for the local M7 auditor journey.",
);

function sessionCookies(header: string, domain: string) {
  const [pair, ...attributes] = header.split(";");
  const separator = pair?.indexOf("=") ?? -1;
  if (!pair || separator < 1) return [];

  const name = pair.slice(0, separator).trim();
  if (!name.startsWith("cra_")) return [];
  const attribute = (key: string) =>
    attributes.find((value) =>
      value.trim().toLowerCase().startsWith(`${key}=`),
    );

  return [{
    name,
    value: pair.slice(separator + 1),
    domain,
    path: attribute("path")?.split("=").slice(1).join("=") ?? "/",
    httpOnly: attributes.some(
      (value) => value.trim().toLowerCase() === "httponly",
    ),
    sameSite: "Lax" as const,
  }];
}

async function signInAsOwner(page: import("@playwright/test").Page) {
  const response = await page.request.post(`${apiOrigin}/api/v1/auth/sign-in`, {
    data: { email: ownerEmail, password: ownerPassword, remember: true },
  });
  expect(response.status()).toBe(200);
  await page.context().addCookies(
    response
      .headersArray()
      .filter((header) => header.name.toLowerCase() === "set-cookie")
      .flatMap((header) =>
        sessionCookies(header.value, new URL(webOrigin).hostname),
      ),
  );

  await page.goto("/dashboard");
  const switched = await page.evaluate(async () => {
    const session = await fetch("/api/v1/auth/session");
    if (!session.ok) return false;
    const body = (await session.json()) as {
      organizations: Array<{ id: string; role: string }>;
    };
    const organization =
      body.organizations.find((candidate) => candidate.role === "owner") ??
      body.organizations[0];
    if (!organization) return false;
    return (
      await fetch("/api/v1/organizations/switch", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organizationId: organization.id }),
      })
    ).ok;
  });
  expect(switched).toBe(true);
}

test("owner grants a scoped snapshot, auditor redeems it, then revocation takes effect", async ({
  page,
  browser,
}, testInfo) => {
  await signInAsOwner(page);
  await page.goto(`/products/${productId}/technical-file`);
  await expect(page.getByRole("heading", { name: "Technical-file snapshots" })).toBeVisible();

  const queued = page.waitForResponse(
    (response) =>
      /\/technical-file\/snapshots\/[^/]+\/exports$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Export snapshot" }).first().click();
  const queuedResponse = await queued;
  expect(queuedResponse.status()).toBe(201);

  execFileSync("pnpm", ["--filter", "api", "run", "worker:technical-file-export"], {
    cwd: "../..",
    env: process.env,
    stdio: "pipe",
  });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Export status: ready")).toBeVisible();

  const auditorAccess = page
    .getByRole("heading", { name: "Auditor access" })
    .locator("..");
  await expect(auditorAccess.getByText(/^Scope:/)).toBeVisible();
  const recipient = `auditor-e2e-${Date.now()}@example.test`;
  await auditorAccess.getByLabel("Auditor email").fill(recipient);
  await auditorAccess
    .getByRole("textbox", { name: "Purpose" })
    .fill("Local browser verification of scoped immutable snapshot access.");
  const expiry = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const part = (value: number) => String(value).padStart(2, "0");
  await auditorAccess.getByLabel("Expiry").fill(
    `${expiry.getFullYear()}-${part(expiry.getMonth() + 1)}-${part(expiry.getDate())}T${part(expiry.getHours())}:${part(expiry.getMinutes())}`,
  );
  const created = page.waitForResponse(
    (response) =>
      /\/technical-file\/snapshots\/[^/]+\/auditor-grants$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await auditorAccess
    .getByRole("button", { name: "Create auditor access" })
    .click();
  expect((await created).status()).toBe(201);
  await expect(auditorAccess.getByRole("status")).toContainText(
    "Scoped auditor access was created",
  );
  const deliveryLink = auditorAccess
    .locator("p")
    .filter({ hasText: /\/auditor\?token=/ })
    .last();
  await expect(deliveryLink).toBeVisible();
  const deliveryUrl = await deliveryLink.textContent();
  expect(deliveryUrl).toMatch(
    /^http:\/\/localhost:3100\/auditor\?token=[A-Za-z0-9_-]{43,}$/,
  );
  await page.screenshot({
    path: testInfo.outputPath("auditor-grant-created.png"),
    fullPage: true,
  });

  const auditorContext = await browser.newContext({ baseURL: webOrigin });
  const auditorPage = await auditorContext.newPage();
  await auditorPage.goto(deliveryUrl!);
  await expect
    .poll(async () =>
      (await auditorContext.cookies()).some((cookie) => cookie.name === "cra_auditor"),
    )
    .toBe(true);
  await expect(
    auditorPage.getByRole("heading", { name: "Permitted technical-file snapshot" }),
  ).toBeVisible();
  await expect(auditorPage.locator("nav")).toHaveCount(0);
  await expect(auditorPage.getByText("Export manifest")).toBeVisible();
  await auditorPage.screenshot({
    path: testInfo.outputPath("auditor-permitted-snapshot.png"),
    fullPage: true,
  });

  const download = auditorPage.waitForEvent("download");
  await auditorPage.getByRole("link", { name: "Download PDF" }).click();
  expect((await download).suggestedFilename()).toMatch(/\.pdf$/i);

  const grantRow = auditorAccess.getByRole("row").filter({ hasText: recipient });
  await expect(grantRow).toBeVisible();
  const revoked = page.waitForResponse(
    (response) =>
      /\/technical-file\/snapshots\/[^/]+\/auditor-grants\/[^/]+\/revoke$/.test(response.url()) &&
      response.request().method() === "POST",
  );
  await grantRow.getByRole("button", { name: "Revoke" }).click();
  expect((await revoked).status()).toBe(200);
  await expect(auditorAccess.getByRole("status")).toContainText(
    "Auditor access was revoked",
  );

  await auditorPage.reload();
  await expect(auditorPage.getByText("This auditor access is unavailable.", { exact: true })).toBeVisible();
  await expect(auditorPage.getByText("Export manifest")).toHaveCount(0);
  await auditorPage.screenshot({
    path: testInfo.outputPath("auditor-access-revoked.png"),
    fullPage: true,
  });
  await auditorContext.close();
});
