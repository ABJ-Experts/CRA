import { randomUUID } from "node:crypto";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import {
  portfolioConcentrationResponseSchema,
  portfolioProductsResponseSchema,
} from "@repo/contracts/dashboard/schemas";

/* eslint-disable turbo/no-undeclared-env-vars -- Local browser gates run outside Turbo. */
const origin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3002";

async function signIn(page: Page, email = "owner@cra.test") {
  await page.goto(`${origin}/sign-in`);
  // WebKit may hydrate the controlled form after the first fill. Wait for
  // retained input values rather than submitting an empty pre-hydration field.
  await expect(async () => {
    await page.getByTestId("si-identifier").fill(email);
    await page.getByTestId("si-password").fill("Password123");
    await expect(page.getByTestId("si-identifier")).toHaveValue(email);
    await expect(page.getByTestId("si-password")).toHaveValue("Password123");
  }).toPass({ timeout: 15_000 });
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

async function blockExternal(context: BrowserContext) {
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
}

test.beforeEach(async ({ context }) => {
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  await blockExternal(context);
});

test("owner compares authorized products and drills through exact shared identity to posture", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  await signIn(page);
  await page.getByRole("link", { name: "Portfolio", exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard\/portfolio$/);
  await expect(
    page.getByRole("heading", { name: "Portfolio posture", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Authorized product comparison" }),
  ).toBeVisible();
  const products = portfolioProductsResponseSchema.parse(
    await (
      await page.request.get(`${origin}/api/v1/dashboard/portfolio/products`)
    ).json(),
  );
  expect(products.scope.includeArchived).toBe(false);
  const response = await page.request.get(
    `${origin}/api/v1/dashboard/portfolio/concentration`,
  );
  expect(response.status()).toBe(200);
  const concentration = portfolioConcentrationResponseSchema.parse(
    await response.json(),
  );
  expect(concentration.organizationId).toBe(products.organizationId);
  if (process.env.E2E_PORTFOLIO_FIXTURE === "true") {
    expect(concentration.concentration.state).toBe("available");
    expect(
      "data" in concentration.concentration &&
        concentration.concentration.data.rows.length,
    ).toBeGreaterThan(0);
  }
  await page.screenshot({
    path: testInfo.outputPath("portfolio-desktop.png"),
    fullPage: true,
    animations: "disabled",
  });
  if (
    concentration.concentration.state === "available" &&
    concentration.concentration.data.rows.length
  ) {
    const rows = concentration.concentration.data.rows;
    const row =
      process.env.E2E_PORTFOLIO_FIXTURE === "true"
        ? rows.find(
            (candidate) =>
              candidate.packageIdentity === "pkg:npm/m14-05-shared" &&
              candidate.version === "1.0.0",
          )!
        : rows[0]!;
    expect(row).toBeDefined();
    if (process.env.E2E_PORTFOLIO_FIXTURE === "true") {
      expect(row.productCount).toBeGreaterThanOrEqual(2);
      expect(
        rows.some(
          (candidate) =>
            candidate.packageIdentity === row.packageIdentity &&
            candidate.version === "2.0.0",
        ),
      ).toBe(true);
      expect(
        rows.some(
          (candidate) =>
            candidate.packageIdentity === "pkg:npm/m14-05-conflict",
        ),
      ).toBe(false);
    }
    await expect(
      page.getByRole("table", { name: "Shared component concentration" }),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: `Inspect ${row.packageIdentity} ${row.version}`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("table", { name: "Affected products and releases" }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("portfolio-drilldown.png"),
      fullPage: true,
      animations: "disabled",
    });
    const posture = page
      .getByRole("table", { name: "Affected products and releases" })
      .locator('a[href^="/products/"][href$="/posture"]')
      .first();
    await posture.click();
    await expect(page).toHaveURL(/\/products\/[0-9a-f-]+\/posture$/);
    await page.goto(`${origin}/dashboard/portfolio`);
  } else {
    testInfo.annotations.push({
      type: "fixture limitation",
      description:
        "No live shared component; sourceful concentration journey requires the isolated M14-05 fixture.",
    });
  }
  await page
    .getByRole("checkbox", {
      name: "Include archived marketed products and releases",
    })
    .check();
  await page.getByRole("button", { name: "Apply scope", exact: true }).click();
  await expect
    .poll(async () => {
      const result = await page.request.get(
        `${origin}/api/v1/dashboard/portfolio/products?includeArchived=true`,
      );
      return result.status();
    })
    .toBe(200);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: testInfo.outputPath("portfolio-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/portfolio/products?organizationId=${randomUUID()}`,
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/portfolio/products?productId=${randomUUID()}`,
      )
    ).status(),
  ).toBe(404);
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/portfolio/concentration/detail?componentRef=forged`,
      )
    ).status(),
  ).toBe(400);
});

test("transient refresh preserves marked evidence; authorization denial erases comparison", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto(`${origin}/dashboard/portfolio`);
  const table = page.getByRole("table", {
    name: "Authorized product comparison",
  });
  await expect(table).toBeVisible();
  await page.route("**/api/v1/dashboard/portfolio/products?**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporarily unavailable" }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh portfolio", exact: true })
    .click();
  await expect(page.getByText(/stale/i).first()).toBeVisible();
  await expect(table).toBeVisible();
  await page.unroute("**/api/v1/dashboard/portfolio/products?**");
  await page.route("**/api/v1/dashboard/portfolio/products?**", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "Access denied" }),
    }),
  );
  await page
    .getByRole("button", { name: "Refresh portfolio", exact: true })
    .click();
  await expect(table).toHaveCount(0);
  await expect(
    page.getByText(/access.*unavailable|access denied|no.*permission/i).first(),
  ).toBeVisible();
});

test("viewer receives no restricted readiness values", async ({ page }) => {
  test.setTimeout(120_000);
  await signIn(page, "viewer@cra.test");
  await page.goto(`${origin}/dashboard/portfolio`);
  await expect(
    page.getByRole("heading", { name: "Portfolio posture", exact: true }),
  ).toBeVisible();
  const result = portfolioProductsResponseSchema.parse(
    await (
      await page.request.get(`${origin}/api/v1/dashboard/portfolio/products`)
    ).json(),
  );
  if (
    ["available", "stale", "empty"].includes(result.products.state) &&
    "data" in result.products
  )
    for (const row of result.products.data.rows) {
      expect(row.readiness.state).toBe("restricted");
      expect(row.readiness).not.toHaveProperty("data");
    }
});
