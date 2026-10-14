import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { z } from "zod";
import {
  diagnosticPreviewSchema,
  diagnosticJobSchema,
  diagnosticGrantSchema,
  diagnosticCleanupReviewSchema,
  diagnosticListSchema,
} from "@repo/contracts/support-diagnostics/schemas";

/* eslint-disable turbo/no-undeclared-env-vars -- Explicit task-owned live verification fixture. */
const fixtureSchema = z.object({
  organizationId: z.uuid(),
  purpose: z.literal("m15-04-browser-verification"),
  owner: z.object({ email: z.email(), password: z.string().min(1) }),
});
const base = "/api/v1/system/diagnostics";
const manifestPath = process.env.M15_04_FIXTURE_MANIFEST;
async function fixture() {
  return fixtureSchema.parse(JSON.parse(await readFile(manifestPath!, "utf8")));
}
async function signIn(page: Page) {
  const value = await fixture();
  await page.goto("/sign-in");
  // Waiting for the password toggle proves the controlled form has hydrated
  // before WebKit receives credentials; early fills can be replaced on mount.
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByTestId("si-password")).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await page.getByTestId("si-identifier").fill(value.owner.email);
  await page.getByTestId("si-password").fill(value.owner.password);
  const pacingPath = join(
    dirname(manifestPath!),
    "browser-sign-in-pacing.json",
  );
  const previous = await readFile(pacingPath, "utf8").catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return "0";
      throw error;
    },
  );
  const delay = Math.max(0, Number(previous) + 8_000 - Date.now());
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
  const response = page.waitForResponse(
    (value) =>
      new URL(value.url()).pathname === "/api/v1/auth/sign-in" &&
      value.request().method() === "POST",
  );
  await page.getByTestId("si-submit").click();
  expect((await response).status()).toBe(200);
  await writeFile(pacingPath, String(Date.now()), { mode: 0o600 });
  await expect(page).toHaveURL(/\/dashboard$/, { timeout: 45_000 });
  return value;
}
async function cancelInterruptedFixtureWork(page: Page) {
  const value = await fixture();
  const history = diagnosticListSchema.parse(
    await (await page.request.get(`${base}/bundles?limit=100`)).json(),
  );
  expect(history.organizationId).toBe(value.organizationId);
  for (const item of history.items.filter((job) =>
    ["queued", "running"].includes(job.state),
  )) {
    let job = item;
    const idempotencyKey = randomUUID();
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await page.request.post(
        `${base}/bundles/${job.id}/cancel`,
        { data: { expectedVersion: job.version, idempotencyKey } },
      );
      if (response.status() === 200) break;
      expect(response.status()).toBe(409);
      job = diagnosticJobSchema.parse(
        await (await page.request.get(`${base}/bundles/${job.id}`)).json(),
      );
      if (!["queued", "running"].includes(job.state)) break;
    }
  }
}
// This file never modifies seeded users, organization grants, licences or source
// records. Every generated bundle belongs to the explicitly supplied test tenant.
test.beforeEach(async ({ context, baseURL }) => {
  test.skip(
    !manifestPath,
    "Requires M15_04_FIXTURE_MANIFEST with a task-owned owner and organizationId; no seeded-owner fallback.",
  );
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  await context.route(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort("blockedbyclient"),
  );
});

test("task-owned owner reviews static preview, consents, inspects and explicitly downloads a redacted bundle", async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const value = await signIn(page);
  await test.step("Cancel only interrupted task fixture generation", () =>
    cancelInterruptedFixtureWork(page));
  let previewRequests = 0,
    createRequests = 0;
  page.on("request", (request) => {
    const url = new URL(request.url());
    if (request.method() === "POST" && url.pathname === `${base}/preview`)
      previewRequests++;
    if (request.method() === "POST" && url.pathname === `${base}/bundles`)
      createRequests++;
  });
  await page.goto("/organization/health");
  await expect(
    page.getByRole("heading", { name: "Generate diagnostics", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Your diagnostic history" }),
  ).toBeVisible();
  // Settle the existing health table and creator history before the first
  // pointer action: their asynchronous layout expansion can move this form.
  await expect(
    page.getByRole("table", { name: "Components", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Refresh history", exact: true }),
  ).toBeEnabled();
  expect(previewRequests).toBe(0);
  expect(createRequests).toBe(0);
  const previewResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === `${base}/preview`,
  );
  await page
    .getByRole("button", { name: "Preview diagnostic selection", exact: true })
    .click();
  const preview = diagnosticPreviewSchema.parse(
    await (await previewResponse).json(),
  );
  expect(preview.organizationId).toBe(value.organizationId);
  expect(preview.estimate.measured).toBe(false);
  await expect(page.getByLabel(/I consent to collect/)).not.toBeChecked();
  await expect(
    page.getByRole("button", { name: "Create diagnostic bundle", exact: true }),
  ).toBeDisabled();
  expect(createRequests).toBe(0);
  await page.getByLabel(/I consent to collect/).focus();
  await expect(page.getByLabel(/I consent to collect/)).toBeFocused();
  await page.keyboard.press("Space");
  const createdResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname === `${base}/bundles`,
  );
  await page
    .getByRole("button", { name: "Create diagnostic bundle", exact: true })
    .click();
  const job = diagnosticJobSchema.parse(await (await createdResponse).json());
  expect(job.organizationId).toBe(value.organizationId);
  await expect(
    page.getByRole("heading", { name: "Inspect actual bundle content" }),
  ).toBeVisible({ timeout: 65_000 });
  for (const section of [
    "Logs content",
    "Configuration content",
    "Metrics content",
    "Omissions content",
  ]) {
    await page.getByRole("button", { name: section, exact: true }).focus();
    await expect(
      page.getByRole("button", { name: section, exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      page.getByLabel(`${section.split(" ")[0]!.toLowerCase()} content`, {
        exact: true,
      }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("link", { name: "Download authorized diagnostic bundle" }),
  ).toHaveCount(0);
  const grantResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      `${base}/bundles/${job.id}/download-grants`,
  );
  await page
    .getByRole("button", { name: "Authorize bundle download", exact: true })
    .click();
  const grant = diagnosticGrantSchema.parse(await (await grantResponse).json());
  await expect(
    page.getByRole("link", { name: "Download authorized diagnostic bundle" }),
  ).toHaveAttribute("href", grant.downloadPath);
  expect([403, 404]).toContain(
    (
      await page.request.get(
        `${base}/bundles/${job.id}/download/${randomUUID()}`,
      )
    ).status(),
  );
  const downloaded = await page.request.get(grant.downloadPath);
  expect(downloaded.status()).toBe(200);
  expect([403, 404]).toContain(
    (await page.request.get(grant.downloadPath)).status(),
  );
  const current = diagnosticJobSchema.parse(
    await (await page.request.get(`${base}/bundles/${job.id}`)).json(),
  );
  expect(
    createHash("sha256")
      .update(await downloaded.body())
      .digest("hex"),
  ).toBe(current.artifact!.sha256);
  expect(
    (
      await page.request.post(`${base}/bundles/${job.id}/download-grants`, {
        data: {
          expectedVersion: current.version + 1,
          idempotencyKey: randomUUID(),
        },
      })
    ).status(),
  ).toBe(409);
  await page.screenshot({
    path: info.outputPath("support-diagnostics-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("support-diagnostics-mobile.png"),
    fullPage: true,
  });
  const withdraw = page.getByRole("button", {
    name: "Withdraw consent",
    exact: true,
  });
  await withdraw.focus();
  await expect(withdraw).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(
    page.getByText(/Consent withdrawn; generation stopped/),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Authorize bundle download" }),
  ).toHaveCount(0);
  // Cleanup is reviewed and confirmed in the UI; a retention blocker is a valid
  // retained result. No direct storage/object deletion is performed by the test.
  const cleanupReviewResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      new URL(response.url()).pathname ===
        `${base}/bundles/${job.id}/cleanup-review`,
  );
  await page
    .getByRole("button", { name: "Review cleanup", exact: true })
    .click();
  const cleanupReview = diagnosticCleanupReviewSchema.parse(
    await (await cleanupReviewResponse).json(),
  );
  expect(cleanupReview.organizationId).toBe(value.organizationId);
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: /Eligible for cleanup|Retained:/ }),
  ).toBeVisible();
  if (await page.getByLabel(/I confirm permanent cleanup/).count()) {
    await expect(
      page.getByRole("button", { name: "Confirm diagnostic cleanup" }),
    ).toBeDisabled();
    await page.getByLabel(/I confirm permanent cleanup/).check();
    await page
      .getByRole("button", { name: "Confirm diagnostic cleanup" })
      .click();
    await expect(
      page.getByText(
        /Cleanup completed|Cleanup requested|Cleanup deleting|Cleanup blocked/,
      ),
    ).toBeVisible();
  }
});

test("task-owned API boundaries reject tenant injection and missing consent without source mutation", async ({
  page,
  browser,
  baseURL,
}) => {
  const value = await signIn(page);
  const anonymous = await browser.newContext({ baseURL });
  try {
    expect((await anonymous.request.get(`${base}/bundles`)).status()).toBe(401);
  } finally {
    await anonymous.close();
  }
  expect(
    (
      await page.request.get(`${base}/bundles?organizationId=${randomUUID()}`)
    ).status(),
  ).toBe(400);
  const now = new Date(),
    earlier = new Date(now.getTime() - 8 * 86_400_000);
  for (const selection of [
    {
      categories: ["logs"],
      from: earlier.toISOString(),
      to: now.toISOString(),
    },
    { categories: ["logs"], from: now.toISOString(), to: now.toISOString() },
    {
      categories: ["logs", "logs"],
      from: new Date(now.getTime() - 1000).toISOString(),
      to: now.toISOString(),
    },
    {
      categories: ["logs"],
      from: new Date(now.getTime() - 1000).toISOString(),
      to: now.toISOString(),
      organizationId: randomUUID(),
    },
  ])
    expect(
      (
        await page.request.post(`${base}/preview`, { data: selection })
      ).status(),
    ).toBe(400);
  const history = diagnosticListSchema.parse(
    await (await page.request.get(`${base}/bundles`)).json(),
  );
  expect(history.organizationId).toBe(value.organizationId);
  const to = new Date(),
    from = new Date(to.getTime() - 86400000);
  const previewResponse = await page.request.post(`${base}/preview`, {
    data: {
      categories: ["configuration"],
      from: from.toISOString(),
      to: to.toISOString(),
    },
  });
  expect(previewResponse.status()).toBe(200);
  const preview = diagnosticPreviewSchema.parse(await previewResponse.json());
  expect(
    (
      await page.request.post(`${base}/bundles`, {
        data: {
          previewToken: preview.previewToken,
          consent: false,
          idempotencyKey: randomUUID(),
        },
      })
    ).status(),
  ).toBe(400);
  const after = diagnosticListSchema.parse(
    await (await page.request.get(`${base}/bundles`)).json(),
  );
  expect(after.items.map((item) => item.id)).toEqual(
    history.items.map((item) => item.id),
  );
  if (history.items[0]?.state === "ready") {
    const job = history.items[0];
    expect(
      (
        await page.request.get(
          `${base}/bundles/${job.id}/content?section=logs&limit=101`,
        )
      ).status(),
    ).toBe(400);
  }
});

test("task-owned queued generation can be cancelled idempotently and source access is withdrawn", async ({
  page,
}) => {
  await signIn(page);
  await test.step("Cancel only interrupted task fixture generation", () =>
    cancelInterruptedFixtureWork(page));
  const to = new Date(),
    from = new Date(to.getTime() - 86_400_000);
  const selection = {
    categories: ["configuration"],
    from: from.toISOString(),
    to: to.toISOString(),
  };
  const previewResponse = await page.request.post(`${base}/preview`, {
    data: selection,
  });
  expect(previewResponse.status()).toBe(200);
  const preview = diagnosticPreviewSchema.parse(await previewResponse.json());
  const idempotencyKey = randomUUID();
  const created = await page.request.post(`${base}/bundles`, {
    data: { previewToken: preview.previewToken, consent: true, idempotencyKey },
  });
  expect([200, 201, 202]).toContain(created.status());
  let job = diagnosticJobSchema.parse(await created.json());
  const replay = await page.request.post(`${base}/bundles`, {
    data: { previewToken: preview.previewToken, consent: true, idempotencyKey },
  });
  expect([200, 201, 202]).toContain(replay.status());
  expect(diagnosticJobSchema.parse(await replay.json()).id).toBe(job.id);
  const cancelKey = randomUUID();
  for (let attempt = 0; attempt < 5; attempt++) {
    const cancelled = await page.request.post(
      `${base}/bundles/${job.id}/cancel`,
      { data: { expectedVersion: job.version, idempotencyKey: cancelKey } },
    );
    if (cancelled.status() === 409) {
      job = diagnosticJobSchema.parse(
        await (await page.request.get(`${base}/bundles/${job.id}`)).json(),
      );
      continue;
    }
    expect(cancelled.status()).toBe(200);
    job = diagnosticJobSchema.parse(await cancelled.json());
    break;
  }
  expect(job.state).toBe("cancelled");
  const duplicate = await page.request.post(
    `${base}/bundles/${job.id}/cancel`,
    { data: { expectedVersion: 1, idempotencyKey: cancelKey } },
  );
  expect(duplicate.status()).toBe(200);
  expect(diagnosticJobSchema.parse(await duplicate.json()).state).toBe(
    "cancelled",
  );
  expect([403, 404]).toContain(
    (
      await page.request.get(
        `${base}/bundles/${job.id}/content?section=configuration&offset=0&limit=100`,
      )
    ).status(),
  );
  expect([403, 404]).toContain(
    (
      await page.request.post(`${base}/bundles/${job.id}/download-grants`, {
        data: { expectedVersion: job.version, idempotencyKey: randomUUID() },
      })
    ).status(),
  );
  expect(
    (
      await page.request.post(`${base}/bundles/${job.id}/cleanup`, {
        data: {
          expectedVersion: job.version,
          idempotencyKey: randomUUID(),
          reviewFingerprint: "0".repeat(64),
        },
      })
    ).status(),
  ).toBe(409);
});
