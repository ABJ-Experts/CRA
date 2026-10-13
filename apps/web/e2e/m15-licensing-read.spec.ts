import { expect, test, type Page } from "@playwright/test";
import {
  licenseCurrentResponseSchema,
  licenseHistoryResponseSchema,
  licensePolicyResponseSchema,
} from "@repo/contracts/licensing/schemas";

const policyLabels = {
  missing: "No licence activated",
  active: "Active",
  grace: "Grace period",
  expired_read_only: "Expired · read-only",
  invalid: "Invalid licence",
  clock_untrusted: "Clock requires review",
} as const;
const readRoutes = [
  "/dashboard",
  "/products",
  "/suppliers",
  "/frameworks",
  "/findings",
  "/reporting",
  "/tasks",
  "/connectors",
  "/audit",
  "/management",
  "/account",
  "/security",
] as const;

async function visit(page: Page, route: string) {
  // These smoke checks replace the document. Let the current session queries
  // and Next production prefetches finish before tearing that document down.
  // WebKit reports cancelled teardown fetches as "access control checks".
  await page.waitForLoadState("networkidle");
  const response = await page.goto(route);
  await page.waitForLoadState("networkidle");
  return response;
}

async function signIn(page: Page, email: string) {
  await visit(page, "/sign-in");
  await page.getByTestId("si-identifier").fill(email);
  await page.getByTestId("si-password").fill("Password123");
  const signedIn = page.waitForResponse((response) => {
    return new URL(response.url()).pathname === "/api/v1/auth/sign-in";
  });
  await page.getByTestId("si-submit").click();
  expect((await signedIn).status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("main").first()).toBeVisible();
  await page.waitForLoadState("networkidle");
}

test.beforeEach(async ({ context, baseURL }) => {
  expect(baseURL).toBeDefined();
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  // Leave local requests outside Playwright's interceptor: globally pausing
  // WebKit fetches introduces additional cancellation during document teardown.
  await context.route(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort("blockedbyclient"),
  );
});

test("owner reads licence state and workspace pages without browser runtime errors", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await signIn(page, "owner@cra.test");

  const policyResponse = await page.request.get("/api/v1/licensing/policy");
  expect(policyResponse.status()).toBe(200);
  const policy = licensePolicyResponseSchema.parse(await policyResponse.json());
  const currentResponse = await page.request.get("/api/v1/licensing/current");
  expect(currentResponse.status()).toBe(200);
  const current = licenseCurrentResponseSchema.parse(
    await currentResponse.json(),
  );
  expect(current.policy.state).toBe(policy.state);
  const historyResponse = await page.request.get(
    "/api/v1/licensing/history?limit=10",
  );
  expect(historyResponse.status()).toBe(200);
  const history = licenseHistoryResponseSchema.parse(
    await historyResponse.json(),
  );
  expect(history.items.length).toBeLessThanOrEqual(10);

  await visit(page, "/organization?settings=licence");
  await expect(
    page.getByRole("heading", {
      name: policyLabels[policy.state],
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Licence capacity" }),
  ).toBeVisible();
  const artifact = page.getByLabel("Signed licence artifact", { exact: true });
  await expect(artifact).toBeVisible();
  await artifact.fill("keyboard-local-draft");
  const navigationKey = testInfo.project.name === "webkit" ? "Alt+Tab" : "Tab";
  await artifact.focus();
  await page.keyboard.press(navigationKey);
  await expect(page.getByLabel("Upload licence file")).toBeFocused();
  await page.keyboard.press(navigationKey);
  await expect(
    page.getByRole("button", { name: "Activate licence", exact: true }),
  ).toBeFocused();
  await artifact.fill("");
  await expect(
    page.getByRole("button", { name: "Activate licence", exact: true }),
  ).toBeDisabled();
  await page.screenshot({
    path: testInfo.outputPath("licence-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });

  for (const route of readRoutes) {
    await test.step(`Read ${route}`, async () => {
      const response = await visit(page, route);
      expect(response?.status()).toBe(200);
      expect(new URL(page.url()).pathname).toBe(route);
      await expect(page.locator("main").first()).toBeVisible();
      await expect(
        page.getByText("Application error:", { exact: false }),
      ).toHaveCount(0);
    });
  }

  await context.clearCookies({ name: "cra_at" });
  const refreshed = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return (
      url.pathname === "/api/v1/auth/refresh" &&
      url.searchParams.get("redirectTo") === "/dashboard?from=m15-browser"
    );
  });
  await visit(page, "/dashboard?from=m15-browser");
  expect((await refreshed).status()).toBe(302);
  await expect(page).toHaveURL(/\/dashboard\?from=m15-browser$/);
  expect(
    (await page.request.post("/api/v1/auth/sign-out", { data: {} })).status(),
  ).toBe(200);
  await visit(page, "/organization?settings=licence");
  await expect(page).toHaveURL(/\/sign-in\?/);
  await page.waitForLoadState("networkidle");
  expect(
    runtimeErrors,
    "Owner journey must not emit uncaught browser errors",
  ).toEqual([]);
});

test("owner reads licence capacity within the mobile viewport without runtime errors", async ({
  page,
}, testInfo) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  // Set the viewport before opening the app. Resizing an existing sidebar
  // schedules new Link prefetches that a subsequent hard navigation cancels.
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page, "owner@cra.test");
  await visit(page, "/organization?settings=licence");
  await expect(
    page.getByRole("table", { name: "Licence capacity" }),
  ).toBeVisible();
  const artifact = page.getByLabel("Signed licence artifact", { exact: true });
  await artifact.scrollIntoViewIfNeeded();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const bounds = await artifact.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.screenshot({
    path: testInfo.outputPath("licence-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.waitForLoadState("networkidle");
  expect(
    runtimeErrors,
    "Mobile journey must not emit uncaught browser errors",
  ).toEqual([]);
});

test("viewer reads policy while licence management remains denied without runtime errors", async ({
  page,
}) => {
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await signIn(page, "viewer@cra.test");
  const policy = await page.request.get("/api/v1/licensing/policy");
  expect(policy.status()).toBe(200);
  licensePolicyResponseSchema.parse(await policy.json());
  for (const endpoint of ["current", "history?limit=10"]) {
    expect(
      (await page.request.get(`/api/v1/licensing/${endpoint}`)).status(),
    ).toBe(403);
  }
  await visit(page, "/organization?settings=licence");
  await expect(
    page
      .getByRole("alert")
      .filter({ hasText: "You do not have permission to view licences." }),
  ).toBeVisible();
  await expect(
    page.getByLabel("Signed licence artifact", { exact: true }),
  ).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  expect(
    runtimeErrors,
    "Viewer journey must not emit uncaught browser errors",
  ).toEqual([]);
});
