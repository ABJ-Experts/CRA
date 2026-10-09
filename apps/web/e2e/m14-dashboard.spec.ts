import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { expect, test, type Page } from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Browser verification runs outside Turbo. */
const origin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3102";
const evidence = process.env.M14_EVIDENCE_DIR ?? "/tmp/cra-m14-01-evidence";
test.use({ screenshot: "off", video: "off", trace: "off" });

async function signIn(page: Page, email: string) {
  await page.goto(`${origin}/sign-in`);
  await page.getByTestId("si-identifier").fill(email);
  await page.getByTestId("si-password").fill("Password123");
  await expect(page.getByTestId("si-identifier")).toHaveValue(email);
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test.beforeEach(async ({ context }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
});

test("owner receives the live dashboard and preserved demo; scope stays server-authoritative", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "owner@cra.test");
  await expect(page.getByTestId("dashboard-overview")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "CRA dashboard", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Total revenue", { exact: true })).toHaveCount(0);
  const response = await page.request.get(
    `${origin}/api/v1/dashboard/overview`,
  );
  expect(response.status()).toBe(200);
  const overview = await response.json();
  expect(overview.organizationId).toMatch(/^[0-9a-f-]{36}$/);
  expect(Number.isFinite(Date.parse(overview.serverNow))).toBe(true);
  for (const section of [
    "findings",
    "obligations",
    "readiness",
    "sbomCoverage",
    "ingestion",
    "feedFreshness",
  ]) {
    expect(overview[section]).toHaveProperty("state");
    if (["restricted", "unavailable"].includes(overview[section].state)) {
      expect(overview[section]).not.toHaveProperty("data");
    }
  }
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/overview?organizationId=${randomUUID()}`,
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/products/${randomUUID()}/posture`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(`${origin}/api/v1/dashboard/obligations?limit=101`)
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/readiness?cursor=forged`,
      )
    ).status(),
  ).toBe(400);
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "owner-dashboard-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: join(evidence, "owner-dashboard-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.goto(`${origin}/dashboard/ecommerce`);
  await expect(page.getByText("Total revenue", { exact: true })).toBeVisible();
  await page.goto(`${origin}/dashboard/analytics`);
  await expect(page.getByText("Visitors", { exact: true })).toBeVisible();
});

test("restricted account gets no withheld readiness values", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "viewer@cra.test");
  await expect(page.getByTestId("dashboard-overview")).toBeVisible();
  const response = await page.request.get(
    `${origin}/api/v1/dashboard/overview`,
  );
  expect(response.status()).toBe(200);
  const overview = await response.json();
  expect(overview.readiness.state).toBe("restricted");
  expect(overview.readiness).not.toHaveProperty("data");
  const readiness = await page.request.get(
    `${origin}/api/v1/dashboard/readiness`,
  );
  expect(readiness.status()).toBe(200);
  expect((await readiness.json()).readiness).not.toHaveProperty("data");
  await mkdir(evidence, { recursive: true });
  await page.screenshot({
    path: join(evidence, "viewer-dashboard.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("transient failure labels retained evidence; forbidden refresh clears it", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "owner@cra.test");
  await expect(
    page.getByRole("table", { name: "Open findings by severity" }),
  ).toBeVisible();
  await page.route("**/api/v1/dashboard/overview", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporarily unavailable" }),
    }),
  );
  await page.getByTestId("dashboard-refresh").click();
  await expect(page.getByText(/Displayed evidence is stale/)).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Open findings by severity" }),
  ).toBeVisible();
  await page.unroute("**/api/v1/dashboard/overview");
  await page.route("**/api/v1/dashboard/overview", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "Access denied" }),
    }),
  );
  await page.getByTestId("dashboard-refresh").click();
  await expect(
    page.getByRole("table", { name: "Open findings by severity" }),
  ).toHaveCount(0);
  await expect(
    page.getByText(
      "Dashboard access is unavailable for the current session and organization.",
    ),
  ).toBeVisible();
});

test("GET refresh preserves narrow cookies and organization switching changes dashboard scope", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  await signIn(page, "owner@cra.test");
  await expect(
    page.getByRole("table", { name: "Open findings by severity" }),
  ).toBeVisible();
  const cookies = await context.cookies([
    origin,
    `${origin}/api/v1/auth/refresh`,
  ]);
  expect(cookies.find((cookie) => cookie.name === "cra_rt")?.path).toBe(
    "/api/v1/auth/refresh",
  );
  const accessCookie = cookies.find((cookie) => cookie.name === "cra_at");
  expect(accessCookie).toBeDefined();
  if (!accessCookie)
    throw new Error("Seeded session did not issue access cookie");
  await context.addCookies([
    { ...accessCookie, value: "expired-dashboard-test-token" },
  ]);
  const refreshed = page.waitForResponse(
    (response) => new URL(response.url()).pathname === "/api/v1/auth/refresh",
  );
  await page.getByTestId("dashboard-refresh").click();
  expect((await refreshed).status()).toBe(200);
  await expect(page.getByTestId("dashboard-refresh")).toBeEnabled();
  expect(
    (await page.request.get(`${origin}/api/v1/dashboard/overview`)).status(),
  ).toBe(200);
  const session = await (
    await page.request.get(`${origin}/api/v1/auth/session`)
  ).json();
  const alternate = session.organizations.find(
    (organization: { id: string }) =>
      organization.id !== session.organization.id,
  );
  expect(
    alternate,
    "Local owner should have a second organization for switch verification",
  ).toBeDefined();
  if (!alternate) throw new Error("Organization-switch fixture unavailable");
  await page.goto(`${origin}/onboarding`);
  await page.getByRole("combobox", { name: "Current organization" }).click();
  const switched = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/organizations/switch",
  );
  await page.getByRole("option", { name: alternate.name, exact: true }).click();
  expect((await switched).status()).toBe(200);
  await page.goto(`${origin}/dashboard`);
  const changed = await page.request.get(`${origin}/api/v1/dashboard/overview`);
  expect(changed.status()).toBe(200);
  expect((await changed.json()).organizationId).toBe(alternate.id);
  expect(
    (await (await page.request.get(`${origin}/api/v1/auth/session`)).json())
      .organization.id,
  ).toBe(alternate.id);
});
