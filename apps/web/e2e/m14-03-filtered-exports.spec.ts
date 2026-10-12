import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
/* eslint-disable turbo/no-undeclared-env-vars -- Browser journeys run outside Turbo's cached task graph. */
const origin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3102";

test("owner exports the filtered product registry in both formats with a captured as-of", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  // This test owns its isolated context; it never clears cookies or any other site data.
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto(`${origin}/sign-in`);
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
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.goto(`${origin}/products`);
  await expect(
    page.getByRole("button", { name: "Export list", exact: true }),
  ).toBeVisible();
  await page
    .getByLabel("Search products")
    .fill("m14-export-empty-scope-no-match");
  await expect(
    page.getByText("No products match these filters."),
  ).toBeVisible();
  await page.getByRole("button", { name: "Export list", exact: true }).click();
  const requestKeys = new Set<string>();
  for (const format of ["csv", "xlsx"] as const) {
    await page.getByLabel("Export format").selectOption(format);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/exports") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create export", exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(202);
    const createdJob = (await response.json()).data;
    const request = response.request().postDataJSON();
    expect(request.filters.q).toBe("m14-export-empty-scope-no-match");
    expect(request.scope).toBe("all_filtered");
    expect(request.format).toBe(format);
    expect(requestKeys.has(request.idempotencyKey)).toBe(false);
    requestKeys.add(request.idempotencyKey);
    const status = page.getByLabel("Export status", { exact: true });
    await expect(status.getByRole("status")).toContainText("Ready", {
      timeout: 120_000,
    });
    await expect(status).toContainText("Captured");
    await expect(status).toContainText("No rows matched");
    const download = page.waitForEvent("download");
    await status
      .getByRole("button", { name: new RegExp(`Download .*\\.${format}$`) })
      .click();
    const file = await download;
    expect(await file.failure()).toBeNull();
    await file.saveAs(testInfo.outputPath(`filtered-empty.${format}`));
    const manifestDownload = page.waitForEvent("download");
    await status
      .getByRole("button", { name: "Download manifest JSON", exact: true })
      .click();
    const manifestFile = await manifestDownload;
    expect(await manifestFile.failure()).toBeNull();
    await manifestFile.saveAs(
      testInfo.outputPath(`filtered-${format}-manifest.json`),
    );
    const manifest = JSON.parse(
      await readFile(
        testInfo.outputPath(`filtered-${format}-manifest.json`),
        "utf8",
      ),
    );
    expect(manifest.jobId).toBe(createdJob.id);
    expect(manifest.source).toBe("products.registry");
    expect(manifest.scope).toBe("all_filtered");
    expect(manifest.rowCount).toBe(0);
    expect(manifest.requestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.sourceVersionsDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(Date.parse(manifest.snapshotAsOf)).toBeGreaterThanOrEqual(
      Date.parse(manifest.requestedAt),
    );
    expect(manifest.documentationReadinessOnly).toBe(false);
    expect(manifest.artifacts).toHaveLength(1);
    const contents = await readFile(
      testInfo.outputPath(`filtered-empty.${format}`),
    );
    expect(manifest.artifacts[0].sha256).toBe(
      createHash("sha256").update(contents).digest("hex"),
    );
    expect(manifest.artifacts[0].byteLength).toBe(contents.byteLength);
    expect(JSON.stringify(manifest)).not.toContain("objectPath");
    expect(JSON.stringify(manifest)).not.toContain("filtered-exports");

    await page.screenshot({
      path: testInfo.outputPath(`filtered-${format}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
    ),
  ).toBe(false);
  await page.getByLabel("Export scope").focus();
  await expect(page.getByLabel("Export scope")).toBeFocused();
  await page.screenshot({
    path: testInfo.outputPath("filtered-mobile.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("owner exports canonical product readiness without creating a regulatory decision", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  const productId =
    process.env.E2E_M7_COMPLETE_PRODUCT_ID ??
    "8d45ba58-63ac-4f01-888e-d1257a5c679b";
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto(`${origin}/sign-in`);
  // Confirm hydration before filling a controlled form; server-rendered input values may reset during hydration.
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
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const readiness = await page.request.get(
    `${origin}/api/v1/products/${productId}/technical-file/readiness`,
  );
  expect(readiness.status()).toBe(200);
  const canonical = (await readiness.json()).readiness;
  await page.goto(`${origin}/products/${productId}/technical-file`);
  await page
    .getByRole("button", { name: "Export readiness report", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "Readiness report export" });
  await expect(panel).toContainText(
    "Documentation readiness does not certify conformity",
  );
  const created = page.waitForResponse(
    (response) =>
      response
        .url()
        .endsWith(`/api/v1/products/${productId}/audit-readiness/exports`) &&
      response.request().method() === "POST",
  );
  await panel
    .getByRole("button", { name: "Create export", exact: true })
    .click();
  expect((await created).status()).toBe(202);
  const status = panel.getByLabel("Export status", { exact: true });
  await expect(status.getByRole("status")).toContainText("Ready", {
    timeout: 120_000,
  });
  await expect(status).toContainText("Captured");
  for (const extension of ["pdf", "json"] as const) {
    const downloading = page.waitForEvent("download");
    await status
      .getByRole("button", {
        name: `Download readiness.${extension}`,
        exact: true,
      })
      .click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    await download.saveAs(testInfo.outputPath(`readiness.${extension}`));
  }
  const report = JSON.parse(
    await readFile(testInfo.outputPath("readiness.json"), "utf8"),
  );
  expect(report.documentationReadinessOnly).toBe(true);
  expect(report.product.id).toBe(productId);
  expect(report.canonicalReadiness.overallStatus).toBe(canonical.overallStatus);
  expect(report.canonicalReadiness.sections).toEqual(canonical.sections);
  expect(report.canonicalReadiness.gaps).toEqual(canonical.gaps);
  expect(report.sourceVersions.length).toBeGreaterThan(0);
  expect(Number.isNaN(Date.parse(report.snapshotAsOf))).toBe(false);
  const after = await page.request.get(
    `${origin}/api/v1/products/${productId}/technical-file/readiness`,
  );
  const afterCanonical = (await after.json()).readiness;
  // M7 computes calculatedAt from clock_timestamp() on each read; policy and evidence remain unchanged.
  expect(afterCanonical).toEqual({
    ...canonical,
    calculatedAt: afterCanonical.calculatedAt,
  });
  await page.screenshot({
    path: testInfo.outputPath("readiness-ready.png"),
    fullPage: true,
    animations: "disabled",
  });
});

test("one-time delivery and manifest deny a revoked isolated owner session", async ({
  page,
  browser,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const publicAnonKey = process.env.E2E_SUPABASE_ANON_KEY;
  test.skip(
    !publicAnonKey,
    "Local Supabase public anon key is required for scope=local revocation.",
  );
  const supabaseOrigin =
    process.env.E2E_SUPABASE_ORIGIN ?? "http://127.0.0.1:54321";
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  expect(["localhost", "127.0.0.1"]).toContain(
    new URL(supabaseOrigin).hostname,
  );
  // Both contexts belong exclusively to this test. Global CRA sign-out is intentionally not used.
  const unaffected = await browser.newContext();
  try {
    const login = {
      email: "owner@cra.test",
      password: "Password123",
      remember: true,
    };
    expect(
      (
        await page.request.post(`${origin}/api/v1/auth/sign-in`, {
          data: login,
        })
      ).status(),
    ).toBe(200);
    expect(
      (
        await unaffected.request.post(`${origin}/api/v1/auth/sign-in`, {
          data: login,
        })
      ).status(),
    ).toBe(200);
    await page.goto(`${origin}/products`);
    await page
      .getByLabel("Search products")
      .fill("m14-export-empty-scope-no-match");
    await expect(
      page.getByText("No products match these filters."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Export list", exact: true })
      .click();
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/exports") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create export", exact: true })
      .click();
    const creation = await created;
    expect(creation.status()).toBe(202);
    const job = (await creation.json()).data;
    await expect(
      page.getByLabel("Export status").getByRole("status"),
    ).toContainText("Ready", { timeout: 120_000 });
    const ready = (
      await (
        await page.request.get(`${origin}/api/v1/exports/${job.id}`)
      ).json()
    ).data;
    const issue = async () => {
      const response = await page.request.post(
        `${origin}/api/v1/exports/${job.id}/download-grants`,
        { data: { artifactId: ready.artifacts[0].id } },
      );
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    };
    const consumed = await issue();
    const privateCookies = (await context.cookies()).filter((cookie) =>
      cookie.path.includes(`/exports/${job.id}/download/`),
    );
    expect(privateCookies.length).toBe(1);
    const first = await page.request.get(`${origin}${consumed.downloadPath}`);
    expect(first.status()).toBe(200);
    // Restore only this test's opaque delivery cookie to demonstrate server-side consumption, not merely cookie deletion.
    await context.addCookies(privateCookies);
    const replay = await page.request.get(`${origin}${consumed.downloadPath}`);
    expect([401, 403, 404]).toContain(replay.status());
    const unused = await issue();
    const ownAccess = (await context.cookies()).find(
      (cookie) => cookie.name === "cra_at",
    )?.value;
    if (!ownAccess)
      throw new Error("The isolated test session is unavailable.");
    const revoked = await page.request.post(
      `${supabaseOrigin}/auth/v1/logout?scope=local`,
      {
        headers: {
          apikey: publicAnonKey!,
          authorization: `Bearer ${ownAccess}`,
        },
      },
    );
    expect(revoked.status()).toBe(204);
    const deliveryDenied = await page.request.get(
      `${origin}${unused.downloadPath}`,
    );
    expect([401, 403, 404]).toContain(deliveryDenied.status());
    const manifestDenied = await page.request.get(
      `${origin}/api/v1/exports/${job.id}/manifest`,
    );
    expect([401, 403, 404]).toContain(manifestDenied.status());
    const statusDenied = await page.request.get(
      `${origin}/api/v1/exports/${job.id}`,
    );
    expect([401, 403, 404]).toContain(statusDenied.status());
    expect(
      (await unaffected.request.get(`${origin}/api/v1/auth/session`)).status(),
    ).toBe(200);
    const freshManifest = await unaffected.request.get(
      `${origin}/api/v1/exports/${job.id}/manifest`,
    );
    expect([401, 403, 404]).toContain(freshManifest.status());
    await page
      .getByRole("button", { name: "Download manifest JSON", exact: true })
      .click();
    await expect(
      page.getByRole("region", { name: "List export" }).getByRole("alert"),
    ).toContainText("permission or session changed");
    await expect(page.getByLabel("Export status")).toHaveCount(0);
    await page.screenshot({
      path: testInfo.outputPath("revoked-export.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    await unaffected.close();
  }
});

test("supplier exports only its scoped checklist through private delivery", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixturePath = process.env.E2E_SUPPLIER_PORTAL_FIXTURE;
  test.skip(
    !fixturePath,
    "A fresh, test-owned supplier invitation fixture is required.",
  );
  const fixture = JSON.parse(await readFile(fixturePath!, "utf8")) as {
    link: string;
    title: string;
  };
  if (new URL(fixture.link).origin !== origin)
    throw new Error(
      "The scoped portal fixture must use the local test origin.",
    );
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  // Capability values stay in this isolated browser's memory and are never logged.
  try {
    await page.goto(fixture.link);
  } catch {
    throw new Error("The scoped supplier fixture could not be opened.");
  }
  await expect(
    page.getByRole("heading", { name: fixture.title, exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Export checklist", exact: true })
    .click();
  const panel = page.getByRole("region", { name: "List export" }).first();
  const keys = new Set<string>();
  for (const format of ["csv", "xlsx"] as const) {
    await panel.getByLabel("Export format").selectOption(format);
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/supplier-evidence-portal/exports") &&
        response.request().method() === "POST",
    );
    await panel
      .getByRole("button", { name: "Create export", exact: true })
      .click();
    const creation = await created;
    expect(creation.status()).toBe(202);
    const requested = creation.request().postDataJSON();
    expect(requested.source).toBe("supplier_evidence.portal_items");
    expect(requested.context).toEqual({});
    expect(requested.scope).toBe("all_filtered");
    expect(keys.has(requested.idempotencyKey)).toBe(false);
    keys.add(requested.idempotencyKey);
    const status = panel.getByLabel("Export status", { exact: true });
    await expect(status.getByRole("status")).toContainText("Ready", {
      timeout: 120_000,
    });
    await expect(status).toContainText(/1 rows?/);
    const downloading = page.waitForEvent("download");
    await status
      .getByRole("button", { name: new RegExp(`Download .*\\.${format}$`) })
      .click();
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    await download.saveAs(testInfo.outputPath(`supplier-checklist.${format}`));
    const manifestDownloading = page.waitForEvent("download");
    await status
      .getByRole("button", { name: "Download manifest JSON", exact: true })
      .click();
    const manifestFile = await manifestDownloading;
    expect(await manifestFile.failure()).toBeNull();
    await manifestFile.saveAs(
      testInfo.outputPath(`supplier-${format}-manifest.json`),
    );
    const manifest = JSON.parse(
      await readFile(
        testInfo.outputPath(`supplier-${format}-manifest.json`),
        "utf8",
      ),
    );
    expect(manifest.source).toBe("supplier_evidence.portal_items");
    expect(manifest.rowCount).toBe(1);
    const bytes = await readFile(
      testInfo.outputPath(`supplier-checklist.${format}`),
    );
    expect(manifest.artifacts[0].sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    expect(manifest.artifacts[0].byteLength).toBe(bytes.byteLength);
    if (format === "csv") expect(bytes.toString("utf8")).toContain("Ω");
    expect(JSON.stringify(manifest)).not.toContain("objectPath");
    await page.screenshot({
      path: testInfo.outputPath(`supplier-${format}.png`),
      fullPage: true,
      animations: "disabled",
    });
  }
});

test("trend export captures the displayed signed dataset and source versions", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(180_000);
  expect(["localhost", "127.0.0.1"]).toContain(new URL(origin).hostname);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    return url.origin === origin || !["http:", "https:"].includes(url.protocol)
      ? route.continue()
      : route.abort("blockedbyclient");
  });
  await page.goto(`${origin}/sign-in`);
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
  await page.getByTestId("si-identifier").fill("owner@cra.test");
  await page.getByTestId("si-password").fill("Password123");
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const panel = page.getByTestId("dashboard-trends");
  await expect(panel.getByRole("table")).toHaveCount(5);
  await panel.getByLabel("From date", { exact: true }).fill("2026-10-01");
  await panel.getByLabel("To date", { exact: true }).fill("2026-10-09");
  await panel.getByLabel("Timezone", { exact: true }).fill("UTC");
  await panel.getByLabel("Time bucket").selectOption("day");
  const loaded = page.waitForResponse(
    (response) =>
      response.url().includes("/api/v1/dashboard/trends?") &&
      response.status() === 200,
  );
  await panel
    .getByRole("button", { name: "Apply trend filters", exact: true })
    .click();
  const dataset = await (await loaded).json();
  await panel
    .getByRole("button", { name: "Export trends", exact: true })
    .click();
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith("/api/v1/exports") &&
      response.request().method() === "POST",
  );
  await panel
    .getByRole("button", { name: "Create export", exact: true })
    .click();
  const creation = await created;
  expect(creation.status()).toBe(202);
  const request = creation.request().postDataJSON();
  // Compare opaque signed values without exposing them in an assertion failure.
  expect(request.filters.datasetToken === dataset.datasetToken).toBe(true);
  expect({ ...request.filters, datasetToken: undefined }).toEqual({
    ...dataset.filters,
    datasetToken: undefined,
  });
  expect(request.scope).toBe("all_filtered");
  const expectedRows = Object.values(
    dataset.series as Record<string, { buckets: unknown[] }>,
  ).reduce((total, series) => total + series.buckets.length, 0);
  const status = panel.getByLabel("Export status", { exact: true });
  await expect(status.getByRole("status")).toContainText("Ready", {
    timeout: 120_000,
  });
  await expect(status).toContainText(`${expectedRows} rows`);
  const downloading = page.waitForEvent("download");
  await status.getByRole("button", { name: /Download .*\.csv$/ }).click();
  const download = await downloading;
  expect(await download.failure()).toBeNull();
  await download.saveAs(testInfo.outputPath("pinned-trends.csv"));
  const manifestDownloading = page.waitForEvent("download");
  await status
    .getByRole("button", { name: "Download manifest JSON", exact: true })
    .click();
  const manifestFile = await manifestDownloading;
  expect(await manifestFile.failure()).toBeNull();
  await manifestFile.saveAs(testInfo.outputPath("pinned-trends-manifest.json"));
  const manifest = JSON.parse(
    await readFile(testInfo.outputPath("pinned-trends-manifest.json"), "utf8"),
  );
  expect(manifest.source).toBe("dashboard.trends");
  expect(manifest.rowCount).toBe(expectedRows);
  const bytes = await readFile(testInfo.outputPath("pinned-trends.csv"));
  expect(manifest.artifacts[0].sha256).toBe(
    createHash("sha256").update(bytes).digest("hex"),
  );
  expect(bytes.toString("utf8")).toContain(dataset.datasetRevision);
  await writeFile(
    testInfo.outputPath("pinned-trends-expected.json"),
    JSON.stringify(
      {
        generatedAt: dataset.generatedAt,
        datasetRevision: dataset.datasetRevision,
        filters: dataset.filters,
        series: dataset.series,
      },
      null,
      2,
    ),
  );
  await panel.screenshot({
    path: testInfo.outputPath("pinned-trends-ready.png"),
    animations: "disabled",
  });
});

test("auditor exports only its permitted immutable artifact list", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const productId =
    process.env.E2E_M7_COMPLETE_PRODUCT_ID ??
    "8d45ba58-63ac-4f01-888e-d1257a5c679b";
  const snapshotId =
    process.env.E2E_M7_AUDITOR_SNAPSHOT_ID ??
    "75d34533-3750-4b57-be64-7771ba5911e9";
  const exportId =
    process.env.E2E_M7_AUDITOR_EXPORT_ID ??
    "4c30fbd8-ffff-4f8a-9c3b-b75a8bd35db7";
  expect(
    (
      await page.request.post(`${origin}/api/v1/auth/sign-in`, {
        data: {
          email: "owner@cra.test",
          password: "Password123",
          remember: true,
        },
      })
    ).status(),
  ).toBe(200);
  const base = `${origin}/api/v1/products/${productId}/technical-file/snapshots/${snapshotId}/auditor-grants`;
  const preview = await page.request.get(
    `${base}/preview?exportId=${exportId}`,
  );
  expect(preview.status()).toBe(200);
  const created = await page.request.post(base, {
    data: {
      exportId,
      recipientEmail: `m14-auditor-${Date.now()}@example.test`,
      purpose:
        "Isolated M14 artifact list export verification; existing immutable snapshot only.",
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      idempotencyKey: crypto.randomUUID(),
    },
  });
  expect(created.status()).toBe(201);
  const issued = await created.json();
  const auditorContext = await browser.newContext();
  try {
    await auditorContext.route("**/*", (route) => {
      const url = new URL(route.request().url());
      return url.origin === origin ||
        !["http:", "https:"].includes(url.protocol)
        ? route.continue()
        : route.abort("blockedbyclient");
    });
    const auditor = await auditorContext.newPage();
    // Capability tokens remain in memory; use only the scoped local delivery URL.
    const delivery = new URL(issued.deliveryUrl);
    expect(["localhost", "127.0.0.1"]).toContain(delivery.hostname);
    try {
      await auditor.goto(`${origin}${delivery.pathname}${delivery.search}`);
    } catch {
      throw new Error("The scoped auditor invitation could not be redeemed.");
    }
    await expect(
      auditor.getByRole("heading", {
        name: "Permitted technical-file snapshot",
        exact: true,
      }),
    ).toBeVisible();
    await expect(auditor).toHaveURL(`${origin}/auditor`);
    await expect(auditor.locator("nav")).toHaveCount(0);
    const nativeResponse = await auditor.request.get(
      `${origin}/api/v1/auditor/snapshot/manifest`,
    );
    expect(nativeResponse.status()).toBe(200);
    const native = (await nativeResponse.json()).manifest;
    await writeFile(
      testInfo.outputPath("auditor-permitted-source.json"),
      JSON.stringify(native, null, 2),
    );
    await auditor
      .getByRole("button", { name: "Export artifact list", exact: true })
      .click();
    const panel = auditor.getByRole("region", { name: "List export" });
    const keys = new Set<string>();
    for (const format of ["csv", "xlsx"] as const) {
      await panel.getByLabel("Export format").selectOption(format);
      const creating = auditor.waitForResponse(
        (response) =>
          response.url().endsWith("/api/v1/auditor/exports") &&
          response.request().method() === "POST",
      );
      await panel
        .getByRole("button", { name: "Create export", exact: true })
        .click();
      const response = await creating;
      expect(response.status()).toBe(202);
      const request = response.request().postDataJSON();
      expect(request.source).toBe("technical_file.auditor_manifest_artifacts");
      expect(request.context).toEqual({});
      expect(request.scope).toBe("all_filtered");
      expect(keys.has(request.idempotencyKey)).toBe(false);
      keys.add(request.idempotencyKey);
      const status = panel.getByLabel("Export status", { exact: true });
      await expect(status.getByRole("status")).toContainText("Ready", {
        timeout: 120_000,
      });
      await expect(status).toContainText(`${native.artifacts.length} rows`);
      const downloading = auditor.waitForEvent("download");
      await status
        .getByRole("button", { name: new RegExp(`Download .*\\.${format}$`) })
        .click();
      const download = await downloading;
      expect(await download.failure()).toBeNull();
      await download.saveAs(testInfo.outputPath(`auditor-artifacts.${format}`));
      const manifestDownloading = auditor.waitForEvent("download");
      await status
        .getByRole("button", { name: "Download manifest JSON", exact: true })
        .click();
      const manifestDownload = await manifestDownloading;
      expect(await manifestDownload.failure()).toBeNull();
      await manifestDownload.saveAs(
        testInfo.outputPath(`auditor-${format}-manifest.json`),
      );
      const manifest = JSON.parse(
        await readFile(
          testInfo.outputPath(`auditor-${format}-manifest.json`),
          "utf8",
        ),
      );
      expect(manifest.source).toBe("technical_file.auditor_manifest_artifacts");
      expect(manifest.rowCount).toBe(native.artifacts.length);
      const bytes = await readFile(
        testInfo.outputPath(`auditor-artifacts.${format}`),
      );
      expect(manifest.artifacts[0].sha256).toBe(
        createHash("sha256").update(bytes).digest("hex"),
      );
      expect(manifest.artifacts[0].byteLength).toBe(bytes.byteLength);
      expect(JSON.stringify(manifest)).not.toContain("objectPath");
      await auditor.screenshot({
        path: testInfo.outputPath(`auditor-${format}.png`),
        fullPage: true,
        animations: "disabled",
      });
    }
  } finally {
    await auditorContext.close();
  }
});
