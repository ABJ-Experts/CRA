import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
/* eslint-disable turbo/no-undeclared-env-vars -- Isolated browser verification outside Turbo. */
const origin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3102";
const evidence = process.env.M14_02_EVIDENCE_DIR ?? "/tmp/cra-m14-02-evidence";
test.use({ screenshot: "off", video: "off", trace: "off" });
test("owner trend filters, source authorization, tables and CSV share one dataset", async ({
  page,
  context,
}) => {
  test.setTimeout(120_000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto(`${origin}/sign-in`);
  await waitForSignInInteractivity(page);
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  await expect(page.getByTestId("si-identifier")).toHaveValue("owner@cra.test");
  await expect(page.getByTestId("si-password")).toHaveValue("Password123");
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const panel = page.getByTestId("dashboard-trends");
  await expect(panel).toBeVisible();
  await expect(panel.getByRole("table")).toHaveCount(5);
  await panel.getByLabel("Timezone", { exact: true }).fill("America/New_York");
  await panel.getByLabel("Time bucket").selectOption("week");
  const responsePromise = page.waitForResponse(
    (r) => r.url().includes("/api/v1/dashboard/trends?") && r.status() === 200,
  );
  await panel.getByRole("button", { name: "Apply trend filters" }).click();
  const response = await responsePromise;
  const dataset = await response.json();
  expect(dataset.filters.timezone).toBe("America/New_York");
  expect(dataset.policyVersion).toBe("m14-02-v1");
  const csv = await page.request.get(
    `${origin}/api/v1/dashboard/trends/export?datasetToken=${encodeURIComponent(dataset.datasetToken)}`,
  );
  expect(csv.status()).toBe(200);
  expect(csv.headers()["content-type"]).toContain("text/csv");
  expect(await csv.text()).toContain(dataset.datasetRevision);
  const source = await page.request.get(
    `${origin}/api/v1/dashboard/trends/sources?datasetToken=${encodeURIComponent(dataset.datasetToken)}&metric=activity`,
  );
  expect(source.status()).toBe(200);
  expect((await source.json()).datasetRevision).toBe(dataset.datasetRevision);
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/trends?from=2026-01-01&to=2026-01-31&organizationId=forged`,
      )
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.get(
        `${origin}/api/v1/dashboard/trends/export?datasetToken=forged`,
      )
    ).status(),
  ).toBeGreaterThanOrEqual(400);
  await mkdir(evidence, { recursive: true });
  await panel.screenshot({
    path: join(evidence, "trends-desktop.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await panel.screenshot({
    path: join(evidence, "trends-mobile.png"),
    animations: "disabled",
  });
  const overflow = await panel.evaluate(
    (el) => el.scrollWidth > el.clientWidth,
  );
  expect(overflow).toBe(false);
  await panel.getByLabel("From date").focus();
  await expect(panel.getByLabel("From date")).toBeFocused();
});

/** A real React interaction establishes hydration before entering credentials.
 * SSR inputs can be painted before their controlled form has hydrated.
 */
async function waitForSignInInteractivity(
  page: import("@playwright/test").Page,
) {
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByTestId("si-password")).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await expect(page.getByTestId("si-password")).toHaveAttribute(
    "type",
    "password",
  );
}

async function openDashboard(
  page: import("@playwright/test").Page,
  email: string,
) {
  await page.goto(`${origin}/sign-in`);
  await waitForSignInInteractivity(page);
  await page.getByTestId("si-identifier").fill(email);
  await page.getByTestId("si-password").fill("Password123");
  await expect(page.getByTestId("si-identifier")).toHaveValue(email);
  await expect(page.getByTestId("si-password")).toHaveValue("Password123");
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(
    page.getByTestId("dashboard-trends").getByRole("table"),
  ).toHaveCount(5);
}

test("viewer and unauthenticated contexts cannot infer restricted snapshot history", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);
  await openDashboard(page, "viewer@cra.test");
  const panel = page.getByTestId("dashboard-trends");
  const filters = await panel.getByLabel("From date").inputValue();
  const to = await panel.getByLabel("To date").inputValue();
  const response = await page.request.get(
    `${origin}/api/v1/dashboard/trends?from=${filters}&to=${to}&timezone=UTC&bucket=day`,
  );
  expect(response.status()).toBe(200);
  const dataset = await response.json();
  expect(dataset.series.readiness.state).toBe("restricted");
  expect(dataset.series.readiness.buckets).toEqual([]);
  await expect(
    panel.getByRole("button", {
      name: "View readiness at snapshot creation sources",
    }),
  ).toBeDisabled();
  const sources = await page.request.get(
    `${origin}/api/v1/dashboard/trends/sources?datasetToken=${encodeURIComponent(dataset.datasetToken)}&metric=readiness`,
  );
  expect(sources.status()).toBe(403);
  expect(await sources.text()).not.toContain("payloadSha256");
  const anonymous = await browser.newContext();
  try {
    expect(
      (
        await anonymous.request.get(
          `${origin}/api/v1/dashboard/trends?from=${filters}&to=${to}`,
        )
      ).status(),
    ).toBe(401);
  } finally {
    await anonymous.close();
  }
  await mkdir(evidence, { recursive: true });
  await panel.screenshot({
    path: join(evidence, "trends-viewer-restricted.png"),
    animations: "disabled",
  });
});

test("fault injection preserves filters and clears forbidden evidence; expired datasets disable actions", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDashboard(page, "owner@cra.test");
  const panel = page.getByTestId("dashboard-trends");
  const from = await panel.getByLabel("From date").inputValue();
  await page.route("**/api/v1/dashboard/trends?*", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ message: "Temporarily unavailable" }),
    }),
  );
  await panel.getByRole("button", { name: "Apply trend filters" }).click();
  await expect(panel.getByRole("alert")).toContainText("filters are preserved");
  await expect(panel.getByLabel("From date")).toHaveValue(from);
  await expect(panel.getByRole("table")).toHaveCount(0);
  await mkdir(evidence, { recursive: true });
  await panel.screenshot({
    path: join(evidence, "trends-degraded-injected.png"),
    animations: "disabled",
  });
  await page.unroute("**/api/v1/dashboard/trends?*");
  await panel.getByRole("button", { name: "Refresh trends" }).click();
  await expect(panel.getByRole("table")).toHaveCount(5);
  await page.route("**/api/v1/dashboard/trends?*", (route) =>
    route.fulfill({
      status: 409,
      contentType: "application/json",
      body: JSON.stringify({
        message: "Dataset expired",
        code: "dataset_expired",
      }),
    }),
  );
  await panel.getByRole("button", { name: "Apply trend filters" }).click();
  await expect(panel.getByRole("alert")).toContainText("access changed");
  await expect(panel.getByLabel("From date")).toHaveValue(from);
  await panel.screenshot({
    path: join(evidence, "trends-conflict-injected.png"),
    animations: "disabled",
  });
  await page.unroute("**/api/v1/dashboard/trends?*");
  await panel.getByRole("button", { name: "Refresh trends" }).click();
  await expect(panel.getByRole("table")).toHaveCount(5);
  await page.clock.install();
  await page.clock.setFixedTime(new Date(Date.now() + 16 * 60 * 1000));
  await panel.getByLabel("Timezone", { exact: true }).fill("UTC ");
  await expect(panel.getByText(/Dataset expired/)).toBeVisible();
  await expect(
    panel.getByRole("button", { name: "Export displayed dataset (CSV)" }),
  ).toBeDisabled();
  await panel.screenshot({
    path: join(evidence, "trends-expired-clock.png"),
    animations: "disabled",
  });
  await page.clock.setFixedTime(new Date());
  await panel.getByLabel("Timezone", { exact: true }).fill("UTC");
  await page.route("**/api/v1/dashboard/trends?*", (route) =>
    route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ message: "Access denied" }),
    }),
  );
  await panel.getByRole("button", { name: "Apply trend filters" }).click();
  await expect(panel).toHaveCount(0);
  await expect(
    page.getByText(
      "Dashboard access is unavailable for the current session and organization.",
    ),
  ).toBeVisible();
  await page.screenshot({
    path: join(evidence, "trends-forbidden-injected.png"),
    animations: "disabled",
    fullPage: true,
  });
});

test("mobile chart tables and filter controls are keyboard accessible without page overflow", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await openDashboard(page, "owner@cra.test");
  const panel = page.getByTestId("dashboard-trends");
  await expect(panel.getByRole("table")).toHaveCount(5);
  for (const title of [
    "Findings opened and closed",
    "Mean time to first triage",
    "Mean time to remediate",
    "SBOM release coverage",
    "Readiness at snapshot creation",
  ]) {
    const table = panel.getByRole("table", { name: `${title} values` });
    await expect(table).toBeVisible();
    expect(
      await table.getByRole("columnheader").count(),
    ).toBeGreaterThanOrEqual(4);
  }
  const labels = [
    "From date",
    "To date",
    "Timezone",
    "Time bucket",
    "Find product",
    "Product cohort",
  ];
  for (const label of labels) {
    const control = panel.getByLabel(label, { exact: true });
    await expect(control).toBeVisible();
    await control.focus();
    await expect(control).toBeFocused();
  }
  expect(await panel.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(
    false,
  );
  const scrollArea = panel.getByRole("region", {
    name: "Findings opened and closed table scroll area",
  });
  await scrollArea.focus();
  await expect(scrollArea).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect
    .poll(() => scrollArea.evaluate((el) => el.scrollLeft))
    .toBeGreaterThan(0);
  await panel
    .getByRole("button", { name: "View findings opened and closed sources" })
    .focus();
  await page.keyboard.press("Enter");
  const sources = panel.getByRole("region", {
    name: "Findings opened and closed source records",
  });
  await expect(sources).toBeFocused();
  await panel.getByRole("button", { name: "Close source records" }).click();
  await expect(
    panel.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  ).toBeFocused();
  await mkdir(evidence, { recursive: true });
  await panel.screenshot({
    path: join(evidence, "trends-mobile-390-fixed.png"),
    animations: "disabled",
  });
  await page.setViewportSize({ width: 320, height: 780 });
  await expect
    .poll(() => panel.evaluate((el) => el.scrollWidth > el.clientWidth))
    .toBe(false);
  await panel.screenshot({
    path: join(evidence, "trends-mobile-320-fixed.png"),
    animations: "disabled",
  });
});

test("an existing authorized M7 source opens its exact immutable snapshot", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await openDashboard(page, "owner@cra.test");
  const productsResponse = await page.request.get(
    `${origin}/api/v1/products?page=1&pageSize=100`,
  );
  expect(productsResponse.status()).toBe(200);
  const products = (await productsResponse.json()).products.rows as {
    id: string;
  }[];
  let target: { id: string; productId: string } | undefined;
  for (const product of products.slice(0, 20)) {
    const response = await page.request.get(
      `${origin}/api/v1/products/${product.id}/technical-file/snapshots`,
    );
    if (response.status() === 404) continue;
    expect(response.status()).toBe(200);
    const snapshots = (await response.json()).snapshots as { id: string }[];
    if (snapshots.length) {
      target = { id: snapshots[0]!.id, productId: product.id };
      break;
    }
  }
  test.skip(
    !target,
    "No existing snapshot is readable among the first twenty authorized products; this read-only test creates no data.",
  );
  if (!target) return;
  const panel = page.getByTestId("dashboard-trends");
  const from = await panel.getByLabel("From date").inputValue(),
    to = await panel.getByLabel("To date").inputValue();
  const trendsResponse = await page.request.get(
    `${origin}/api/v1/dashboard/trends?from=${from}&to=${to}&timezone=UTC&bucket=day&productId=${target.productId}`,
  );
  expect(trendsResponse.status()).toBe(200);
  const trends = await trendsResponse.json();
  const sourceResponse = await page.request.get(
    `${origin}/api/v1/dashboard/trends/sources?datasetToken=${encodeURIComponent(trends.datasetToken)}&metric=readiness&limit=100`,
  );
  expect(sourceResponse.status()).toBe(200);
  const sources = (await sourceResponse.json()).items as {
    sourceId: string;
    href: string | null;
  }[];
  const source = sources.find((item) => item.sourceId === target!.id);
  test.skip(
    !source,
    "The existing readable snapshot is outside the requested source cohort; no snapshot is created/backdated for this test.",
  );
  if (!source) return;
  expect(source.href).toBe(
    `/products/${target.productId}/technical-file#snapshot-${target.id}`,
  );
  await page.goto(`${origin}${source.href}`);
  const row = page.locator(`[id="snapshot-${target.id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toBeFocused();
  await mkdir(evidence, { recursive: true });
  await row.screenshot({
    path: join(evidence, "trends-m7-exact-snapshot.png"),
    animations: "disabled",
  });
});
