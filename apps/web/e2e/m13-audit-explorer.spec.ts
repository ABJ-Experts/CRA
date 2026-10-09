import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Page,
} from "@playwright/test";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo. */

const webOrigin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3100";
const apiOrigin = process.env.E2E_API_ORIGIN ?? "http://localhost:3333";
const repoRoot = resolve(new URL("../../..", import.meta.url).pathname);
const artifactsDir =
  process.env.E2E_ARTIFACTS_DIR ?? join(repoRoot, "artifacts", "m13-03");
const authenticatedRequestOrigin =
  new URL(apiOrigin).hostname === new URL(webOrigin).hostname
    ? apiOrigin
    : webOrigin;
const ownerEmail = "owner@cra.test";
const viewerEmail = "viewer@cra.test";
const password = "Password123";
const crossBrowserMatrix = process.env.E2E_CROSS_BROWSER === "true";

type ExportFormat = "csv" | "json";

function pathOf(url: string): string {
  return new URL(url).pathname;
}

function isLocalHttp(url: string): boolean {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) return true;
  return ["localhost", "127.0.0.1"].includes(parsed.hostname);
}

async function installExternalEgressBlock(context: BrowserContext) {
  const blocked: string[] = [];
  await context.route("**/*", async (route) => {
    const url = route.request().url();
    if (isLocalHttp(url)) {
      await route.continue();
      return;
    }
    blocked.push(url);
    await route.abort("blockedbyclient");
  });
  return blocked;
}

async function fillInput(
  locator: ReturnType<Page["getByTestId"]>,
  value: string,
) {
  await locator.fill(value);
  if ((await locator.inputValue()) === value) return;
  await locator.click();
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.press("Backspace");
  await locator.pressSequentially(value);
}

async function signInViaUi(page: Page, email: string) {
  await page.goto("/sign-in");
  const identifier = page.getByTestId("si-identifier");
  const passwordInput = page.getByTestId("si-password");
  await fillInput(identifier, email);
  await fillInput(passwordInput, password);
  await expect(identifier).toHaveValue(email);
  await expect(passwordInput).toHaveValue(password);
  await page.getByTestId("si-submit").click();
  await expect(page).toHaveURL(/\/(dashboard|audit)$/);
  const session = await page.request.get(
    `${authenticatedRequestOrigin}/api/v1/auth/session`,
  );
  expect(session.status()).toBe(200);
}

async function ownerContext(browser: Browser) {
  const context = await browser.newContext({
    baseURL: webOrigin,
    acceptDownloads: true,
  });
  const blocked = await installExternalEgressBlock(context);
  const page = await context.newPage();
  await signInViaUi(page, ownerEmail);
  await expect(page).toHaveURL(/\/dashboard$/);
  return { context, page, blocked };
}

async function viewerDenied(browser: Browser) {
  const context = await browser.newContext({ baseURL: webOrigin });
  try {
    const page = await context.newPage();
    await signInViaUi(page, viewerEmail);
    await page.goto("/audit");
    await expect(
      page.getByText("You do not have permission to view the audit trail."),
    ).toBeVisible({ timeout: 15_000 });
  } finally {
    await context.close();
  }
}

async function createAuditSnapshot(
  page: Page,
  filters: Readonly<{ action?: string; resourceType?: string }> = {
    action: "audit.search.page",
  },
) {
  await page.goto("/audit");
  await expect(
    page.getByRole("heading", { name: "Audit trail" }),
  ).toBeVisible();
  await page.getByLabel("Action").fill(filters.action ?? "");
  await page.getByLabel("Resource type").fill(filters.resourceType ?? "");
  const search = page.waitForResponse(
    (response) =>
      pathOf(response.url()) === "/api/v1/audit/searches" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Search audit trail" }).click();
  expect((await search).status()).toBe(200);
  const firstPage = await page.waitForResponse(
    (response) =>
      pathOf(response.url()).startsWith("/api/v1/audit/searches/") &&
      pathOf(response.url()).endsWith("/events") &&
      response.request().method() === "GET",
  );
  expect(firstPage.status()).toBe(200);
  await expect(page.getByText(/rows on this page/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open" }).first(),
  ).toBeVisible();
}

async function exerciseDetailAndVerify(page: Page) {
  const firstOpen = page.getByRole("button", { name: "Open" }).first();
  await firstOpen.focus();
  const detail = page.waitForResponse(
    (response) =>
      pathOf(response.url()).includes("/audit/searches/") &&
      /\/events\/[0-9a-f-]{36}$/i.test(pathOf(response.url())) &&
      response.request().method() === "GET",
  );
  await firstOpen.click();
  expect((await detail).status()).toBe(200);
  const dialog = page.getByRole("dialog", { name: "Audit event detail" });
  await expect(dialog).toBeVisible();
  await page.screenshot({
    path: join(artifactsDir, "m13-audit-detail-panel.png"),
    fullPage: true,
    animations: "disabled",
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect
    .poll(async () =>
      page.evaluate(() => document.activeElement?.textContent?.trim()),
    )
    .toBe("Open");

  await page
    .getByRole("checkbox", { name: /select audit\.search\./i })
    .first()
    .check();
  const verify = page.waitForResponse(
    (response) =>
      pathOf(response.url()).includes("/audit/searches/") &&
      pathOf(response.url()).endsWith("/verify") &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Verify selected" }).click();
  expect((await verify).status()).toBe(200);
  await expect(
    page.getByText(/selected event hashes were checked/i),
  ).toBeVisible();
}

function runExportWorkerOnce() {
  const result = spawnSync(
    "pnpm",
    ["--filter", "api", "worker:audit-export", "--once"],
    {
      cwd: repoRoot,
      env: process.env,
      encoding: "utf8",
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    },
  );
  expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
}

async function queueAndDownloadExport(
  page: Page,
  format: ExportFormat,
): Promise<string> {
  await page.getByLabel("Format").selectOption(format);
  const queued = page.waitForResponse(
    (response) =>
      pathOf(response.url()) === "/api/v1/audit/exports" &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Queue export" }).click();
  const queuedResponse = await queued;
  expect(queuedResponse.status()).toBe(202);
  const queuedJob = (await queuedResponse.json()) as { id: string };

  let workerRuns = 0;
  await expect
    .poll(
      async () => {
        const response = await page.request.get(
          `${authenticatedRequestOrigin}/api/v1/audit/exports/${queuedJob.id}?requestId=${randomUUID()}`,
        );
        if (response.status() !== 200) return `http-${response.status()}`;
        const body = (await response.json()) as { status: string };
        if (["queued", "processing"].includes(body.status) && workerRuns < 10) {
          workerRuns += 1;
          runExportWorkerOnce();
        }
        return body.status;
      },
      { timeout: 120_000, intervals: [500, 1_000, 2_000] },
    )
    .toBe("ready");
  await expect(
    page.getByRole("button", { name: "Authorize download" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.screenshot({
    path: join(artifactsDir, `m13-audit-${format}-ready.png`),
    fullPage: true,
    animations: "disabled",
  });

  const grant = page.waitForResponse(
    (response) =>
      pathOf(response.url()) ===
        `/api/v1/audit/exports/${queuedJob.id}/download-grants` &&
      response.request().method() === "POST",
  );
  const downloadRequest = page.waitForRequest(
    (request) =>
      pathOf(request.url()) ===
        `/api/v1/audit/exports/${queuedJob.id}/download` &&
      request.method() === "GET",
    { timeout: 15_000 },
  );
  const browserDownload = page.waitForEvent("download", { timeout: 15_000 });
  await page.getByRole("button", { name: "Authorize download" }).click();
  expect((await grant).status()).toBe(200);
  const request = await downloadRequest;
  expect(new URL(request.url()).searchParams.get("requestId")).toMatch(
    /^[0-9a-f-]{36}$/i,
  );
  const download = await browserDownload;
  expect(download.suggestedFilename()).toMatch(
    /^cra-audit-export-[0-9a-f-]{36}\.zip$/,
  );
  const zipPath = join(artifactsDir, `audit-${format}.zip`);
  await download.saveAs(zipPath);
  return zipPath;
}

function run(command: string, args: readonly string[], cwd = repoRoot) {
  const result = spawnSync(command, [...args], {
    cwd,
    env: process.env,
    encoding: "utf8",
    timeout: 120_000,
    maxBuffer: 1024 * 1024,
  });
  expect(
    result.status,
    `${command} ${args.join(" ")}\n${result.stdout}\n${result.stderr}`,
  ).toBe(0);
  return result;
}

async function verifyArchive(format: ExportFormat, zipPath: string) {
  const extractDir = join(artifactsDir, `extract-${format}`);
  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  run("unzip", ["-q", "-o", zipPath, "-d", extractDir]);
  const events = join(extractDir, `events.${format}`);
  const verified = run("node", [
    join(extractDir, "verify.mjs"),
    join(extractDir, "manifest.json"),
    join(extractDir, "manifest.sha256"),
    events,
    join(extractDir, "proofs.ndjson"),
  ]);
  const reportMatch = verified.stdout.match(/\{.*\}/s);
  expect(reportMatch?.[0]).toBeDefined();
  const report = JSON.parse(reportMatch?.[0] ?? "{}") as {
    artifactHashesChecked?: boolean;
    eventProofsChecked?: number;
    proofsUnavailable?: number;
    legacyUnchained?: number;
    authenticityProven?: boolean;
    completenessProven?: boolean;
  };
  expect(report.artifactHashesChecked).toBe(true);
  expect(report.eventProofsChecked).toBeGreaterThan(0);
  if (!crossBrowserMatrix) {
    expect(report.proofsUnavailable).toBe(0);
    expect(report.legacyUnchained).toBe(0);
  } else {
    expect(report.proofsUnavailable).toBeGreaterThanOrEqual(0);
    expect(report.legacyUnchained).toBeGreaterThanOrEqual(0);
  }
  expect(report.authenticityProven).toBe(false);
  expect(report.completenessProven).toBe(false);

  const corruptDir = join(artifactsDir, `corrupt-${format}`);
  await rm(corruptDir, { recursive: true, force: true });
  await mkdir(corruptDir, { recursive: true });
  run("unzip", ["-q", "-o", zipPath, "-d", corruptDir]);
  const corruptEvents = join(corruptDir, `events.${format}`);
  const original = await readFile(corruptEvents, "utf8");
  await writeFile(corruptEvents, `${original}\n`, "utf8");
  const negative = spawnSync(
    "node",
    [
      join(corruptDir, "verify.mjs"),
      join(corruptDir, "manifest.json"),
      join(corruptDir, "manifest.sha256"),
      corruptEvents,
      join(corruptDir, "proofs.ndjson"),
    ],
    { cwd: repoRoot, env: process.env, encoding: "utf8", timeout: 120_000 },
  );
  expect(negative.status).not.toBe(0);
  expect(`${negative.stdout}\n${negative.stderr}`).toMatch(
    /hash mismatch|row count mismatch|artifact hash mismatch/i,
  );
}

async function refreshAfterClearingAccessCookie(page: Page) {
  const cookies = await page.context().cookies(webOrigin);
  await page.context().clearCookies({ name: "cra_at" });
  expect(cookies.some((cookie) => cookie.name === "cra_at")).toBe(true);

  const unauthorized = page.waitForResponse(
    (response) =>
      pathOf(response.url()).includes("/api/v1/audit/searches/") &&
      pathOf(response.url()).endsWith("/events") &&
      response.status() === 401,
  );
  const refresh = page.waitForResponse(
    (response) =>
      pathOf(response.url()) === "/api/v1/auth/refresh" &&
      response.request().method() === "POST",
  );
  const retried = page.waitForResponse(
    (response) =>
      pathOf(response.url()).includes("/api/v1/audit/searches/") &&
      pathOf(response.url()).endsWith("/events") &&
      response.status() === 200,
  );
  await page.getByRole("button", { name: "Next", exact: true }).click();
  expect((await unauthorized).status()).toBe(401);
  expect((await refresh).status()).toBe(200);
  expect((await retried).status()).toBe(200);
}

test.describe("M13 audited audit explorer", () => {
  test("owner searches, verifies, exports CSV/JSON and denied viewer cannot read", async ({
    browser,
  }) => {
    test.setTimeout(300_000);
    expect(new URL(webOrigin).port).toBe("3100");
    expect(new URL(apiOrigin).port).toBe("3333");
    await mkdir(artifactsDir, { recursive: true });

    await viewerDenied(browser);
    const owner = await ownerContext(browser);
    try {
      await createAuditSnapshot(owner.page);
      await exerciseDetailAndVerify(owner.page);
      await refreshAfterClearingAccessCookie(owner.page);
      await owner.page.screenshot({
        path: join(artifactsDir, "m13-audit-search-results.png"),
        fullPage: true,
        animations: "disabled",
      });
      await createAuditSnapshot(owner.page, {
        action: "organization.audit_export_verification_fixture",
        resourceType: "organization",
      });
      const csv = await queueAndDownloadExport(owner.page, "csv");
      await verifyArchive("csv", csv);

      await createAuditSnapshot(owner.page, {
        action: "organization.audit_export_verification_fixture",
        resourceType: "organization",
      });
      const json = await queueAndDownloadExport(owner.page, "json");
      await verifyArchive("json", json);

      expect(
        owner.blocked,
        `External browser egress: ${owner.blocked.join(", ")}`,
      ).toEqual([]);
    } finally {
      await owner.context.close();
    }
  });
});
