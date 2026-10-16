import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { unlink, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";

import {
  LIVE_API_ORIGIN,
  RunScopedAccounts,
  type TestAccount,
} from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const SUPABASE_ORIGIN = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const execFileAsync = promisify(execFile);
const artifactBucket = "evidence-documents";
const exportBucket = "tenant-exports";

function localSupabaseRequest(
  path: string,
  init: RequestInit = {},
): Promise<Response> {
  if (
    !SERVICE_ROLE_KEY ||
    !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(SUPABASE_ORIGIN)
  ) {
    throw new Error(
      "M1 export E2E requires the local CRA Supabase service role configuration.",
    );
  }
  return fetch(`${SUPABASE_ORIGIN}${path}`, {
    ...init,
    headers: {
      apikey: SERVICE_ROLE_KEY,
      authorization: `Bearer ${SERVICE_ROLE_KEY}`,
      ...init.headers,
    },
  });
}

async function scopedObjects(
  bucket: string,
  prefix: string,
): Promise<string[]> {
  const names: string[] = [];
  for (let offset = 0; ; offset += 1000) {
    const response = await localSupabaseRequest(
      `/storage/v1/object/list/${bucket}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefix, limit: 1000, offset }),
      },
    );
    if (!response.ok)
      throw new Error(`Cannot list test-scoped ${bucket} objects.`);
    const entries = (await response.json()) as {
      name?: string;
      id?: string | null;
    }[];
    for (const entry of entries) {
      if (
        !entry.name ||
        entry.name.includes("..") ||
        entry.name.includes("/")
      ) {
        throw new Error("Unsafe test storage path.");
      }
      const path = `${prefix}${entry.name}`;
      if (entry.id === null)
        names.push(...(await scopedObjects(bucket, `${path}/`)));
      else names.push(path);
    }
    if (entries.length < 1000) return names;
  }
}

async function removeScopedObjects(
  bucket: string,
  organizationId: string,
): Promise<void> {
  const prefix = `${organizationId}/`;
  const names = await scopedObjects(bucket, prefix);
  if (names.some((name) => !name.startsWith(prefix)))
    throw new Error("Out-of-scope storage cleanup refused.");
  for (let index = 0; index < names.length; index += 1000) {
    const response = await localSupabaseRequest(
      `/storage/v1/object/${bucket}`,
      {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prefixes: names.slice(index, index + 1000) }),
      },
    );
    if (!response.ok)
      throw new Error(`Cannot remove test-scoped ${bucket} objects.`);
  }
  if ((await scopedObjects(bucket, prefix)).length !== 0) {
    throw new Error("Test-scoped storage cleanup did not complete.");
  }
}

async function assertOnlyThisWorkerJobIsDue(
  organizationId: string,
): Promise<void> {
  const now = encodeURIComponent(new Date().toISOString());
  for (const [table, statuses] of [
    ["organization_export_jobs", "queued,running"],
    ["retention_cleanup_runs", "queued,retry,running"],
    ["organization_purge_jobs", "scheduled,retry,running"],
  ] as const) {
    const response = await localSupabaseRequest(
      `/rest/v1/${table}?select=organization_id&status=in.(${statuses})&available_at=lte.${now}&limit=1001`,
    );
    if (!response.ok) throw new Error("Cannot verify local worker isolation.");
    const rows = (await response.json()) as { organization_id: string }[];
    if (
      rows.length > 1000 ||
      rows.some((row) => row.organization_id !== organizationId)
    ) {
      throw new Error(
        "Local worker has unrelated due jobs; refusing to run E2E worker.",
      );
    }
  }
  const artifactWork = await localSupabaseRequest(
    `/rest/v1/organization_deletion_artifact_work?select=id&status=in.(queued,retry,running)&available_at=lte.${now}&limit=1`,
  );
  if (!artifactWork.ok)
    throw new Error("Cannot verify local artifact-work isolation.");
  if (((await artifactWork.json()) as unknown[]).length !== 0) {
    throw new Error(
      "Local worker has unrelated deletion work; refusing to run E2E worker.",
    );
  }
}

interface SettingsCatalogResponse {
  readonly catalog: {
    readonly timezones: readonly string[];
    readonly notificationChannels: readonly string[];
    readonly aiProviders: readonly string[];
    readonly dataResidencies: readonly string[];
    readonly minimumSessionAgeMinutes: number;
  };
}

interface OrganizationResponse {
  readonly id: string;
  readonly name: string;
}

function responsePath(response: { url(): string }): string {
  return new URL(response.url()).pathname;
}

function firstCatalogValue(values: readonly string[], label: string): string {
  const value = values[0];
  if (!value) {
    throw new Error(`The settings catalog returned no ${label}.`);
  }
  return value;
}

function labelize(value: string): string {
  return value
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => `${part[0]?.toUpperCase() ?? ""}${part.slice(1)}`)
    .join(" ");
}

async function selectCatalogValue(
  page: Page | Locator,
  label: string,
  value: string,
): Promise<void> {
  const control = page.getByRole("combobox", { name: label, exact: true });
  const tagName = await control.evaluate((element) => element.tagName);

  if (tagName === "SELECT") {
    await control.selectOption(value);
    return;
  }

  await control.click();
  await page
    .getByRole("option", { name: labelize(value), exact: true })
    .click();
}

async function createOrganization(
  context: BrowserContext,
  fixtures: RunScopedAccounts,
  account: TestAccount,
  legalName: string,
): Promise<OrganizationResponse> {
  const response = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/organizations`,
    {
      data: {
        idempotencyKey: randomUUID(),
        legalName,
        registeredAddress: {
          addressLine1: "100 Evidence Street",
          locality: "London",
          postalCode: "SW1A 1AA",
          country: "GB",
        },
        mainEstablishmentCountry: "GB",
        manufacturerContactName: "Tenant Administration Owner",
        manufacturerContactEmail: account.email,
      },
    },
  );
  expect(response.status()).toBe(201);

  const organization = (await response.json()) as OrganizationResponse;
  fixtures.trackOrganization(organization.id);
  return organization;
}

async function waitForAdministrationReads(page: Page): Promise<void> {
  const current = page.waitForResponse(
    (response) =>
      responsePath(response) === "/api/v1/organizations/current" &&
      response.request().method() === "GET",
  );
  const settings = page.waitForResponse(
    (response) =>
      responsePath(response) === "/api/v1/organizations/current/settings" &&
      response.request().method() === "GET",
  );
  const catalog = page.waitForResponse(
    (response) =>
      responsePath(response) ===
        "/api/v1/organizations/current/settings/catalog" &&
      response.request().method() === "GET",
  );
  const retention = page.waitForResponse(
    (response) =>
      responsePath(response) === "/api/v1/organizations/current/retention" &&
      response.request().method() === "GET",
  );
  const lifecycle = page.waitForResponse(
    (response) =>
      responsePath(response) === "/api/v1/organizations/current/lifecycle" &&
      response.request().method() === "GET",
  );
  await page.goto("/organization");
  for (const response of await Promise.all([
    current,
    settings,
    catalog,
    retention,
    lifecycle,
  ])) {
    expect(response.status()).toBe(200);
  }
}

test("an owner opens tenant administration and persists catalog-backed settings", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  try {
    const account = await fixtures.createVerified(
      context,
      "tenant-administration-owner",
    );
    const legalName = `E2E Tenant Administration ${testInfo.parallelIndex}-${Date.now()}`;
    const organization = await createOrganization(
      context,
      fixtures,
      account,
      legalName,
    );
    expect(organization.name).toBe(legalName);

    const catalogResponse = await context.request.get(
      `${LIVE_API_ORIGIN}/api/v1/organizations/current/settings/catalog`,
    );
    expect(catalogResponse.status()).toBe(200);
    const { catalog } =
      (await catalogResponse.json()) as SettingsCatalogResponse;
    const timezone = firstCatalogValue(catalog.timezones, "timezones");
    const aiProvider = firstCatalogValue(catalog.aiProviders, "AI providers");
    const residency = firstCatalogValue(
      catalog.dataResidencies,
      "data residencies",
    );

    const page = await context.newPage();
    await waitForAdministrationReads(page);

    await expect(
      page.getByRole("heading", {
        name: "Organization administration",
        exact: true,
      }),
    ).toBeVisible();
    // The name legitimately renders in several landmarks on this page, so
    // scope to the page heading instead of a bare text match.
    await expect(
      page.getByRole("heading", { name: legalName, exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Organization settings", exact: true })
      .click();
    const settingsDialog = page.getByRole("dialog", {
      name: "Organization settings",
      exact: true,
    });
    await expect(settingsDialog).toBeVisible();
    await expect(
      settingsDialog.getByRole("button", {
        name: "Save settings",
        exact: true,
      }),
    ).toBeVisible();

    await selectCatalogValue(settingsDialog, "IANA timezone", timezone);
    await settingsDialog
      .getByRole("spinbutton", {
        name: "Maximum session age minutes",
        exact: true,
      })
      .fill(String(catalog.minimumSessionAgeMinutes));
    await selectCatalogValue(settingsDialog, "AI provider", aiProvider);
    await selectCatalogValue(
      settingsDialog,
      "Data residency indicator",
      residency,
    );
    await settingsDialog
      .getByRole("checkbox", { name: "Monday", exact: true })
      .click();

    const persisted = page.waitForResponse(
      (response) =>
        responsePath(response) === "/api/v1/organizations/current/settings" &&
        response.request().method() === "PATCH",
    );
    const refreshed = page.waitForResponse(
      (response) =>
        responsePath(response) === "/api/v1/organizations/current/settings" &&
        response.request().method() === "GET",
    );
    await settingsDialog
      .getByRole("button", { name: "Save settings", exact: true })
      .click();

    const persistedResponse = await persisted;
    expect(persistedResponse.status()).toBe(200);
    expect(await persistedResponse.json()).toMatchObject({
      settings: {
        status: "configured",
        version: 1,
        values: {
          timezone,
          workingDays: ["monday"],
          maximumSessionAgeMinutes: catalog.minimumSessionAgeMinutes,
          aiProviderId: aiProvider,
          dataResidencyId: residency,
        },
      },
    });
    expect((await refreshed).status()).toBe(200);
    await expect(
      settingsDialog.getByText("Version 1", { exact: true }),
    ).toBeVisible();

    await settingsDialog
      .getByRole("tab", { name: "Exports", exact: true })
      .click();

    const requested = page.waitForResponse(
      (response) =>
        responsePath(response) === "/api/v1/organizations/current/exports" &&
        response.request().method() === "POST",
    );
    await settingsDialog
      .getByRole("button", { name: "Request export", exact: true })
      .click();
    expect((await requested).status()).toBe(201);

    await page.reload();
    const restoredLatest = page.waitForResponse(
      (response) =>
        responsePath(response) ===
          "/api/v1/organizations/current/exports/latest" &&
        response.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Organization settings", exact: true })
      .click();
    expect((await restoredLatest).status()).toBe(200);
    const restoredSettingsDialog = page.getByRole("dialog", {
      name: "Organization settings",
      exact: true,
    });
    await restoredSettingsDialog
      .getByRole("tab", { name: "Exports", exact: true })
      .click();
    await expect(
      restoredSettingsDialog.getByText("Status: Queued", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await fixtures.cleanup();
  }
});

test("an owner downloads a completed tenant export with a verified private artifact", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  let organizationId: string | null = null;

  try {
    const account = await fixtures.createVerified(context, "m1-export-owner");
    const organization = await createOrganization(
      context,
      fixtures,
      account,
      `E2E M1 export ${testInfo.parallelIndex}-${Date.now()}`,
    );
    organizationId = organization.id;
    const sourcePath = `${organizationId}/e2e-${randomUUID()}.txt`;
    const artifactBytes = Buffer.from(
      "M1 run-scoped export artifact\n",
      "utf8",
    );
    const upload = await localSupabaseRequest(
      `/storage/v1/object/${artifactBucket}/${sourcePath}`,
      {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: artifactBytes,
      },
    );
    expect(upload.ok).toBeTruthy();

    const page = await context.newPage();
    await waitForAdministrationReads(page);
    await page
      .getByRole("button", { name: "Organization settings", exact: true })
      .click();
    const dialog = page.getByRole("dialog", {
      name: "Organization settings",
      exact: true,
    });
    await dialog.getByRole("tab", { name: "Exports", exact: true }).click();
    const requested = page.waitForResponse(
      (response) =>
        responsePath(response) === "/api/v1/organizations/current/exports" &&
        response.request().method() === "POST",
    );
    await dialog
      .getByRole("button", { name: "Request export", exact: true })
      .click();
    const requestResponse = await requested;
    expect(requestResponse.status()).toBe(201);
    const requestBody = (await requestResponse.json()) as {
      export: { id: string };
    };
    expect(requestBody.export.id).toMatch(/^[0-9a-f-]{36}$/i);
    await expect(
      dialog.getByText("Status: Queued", { exact: true }),
    ).toBeVisible();

    await assertOnlyThisWorkerJobIsDue(organizationId);
    await execFileAsync("node", ["dist/tenant-lifecycle-worker.js", "--once"], {
      cwd: fileURLToPath(new URL("../../api/", import.meta.url)),
      env: process.env,
      timeout: 120_000,
      maxBuffer: 1024 * 1024,
    });
    const status = await context.request.get(
      `${LIVE_API_ORIGIN}/api/v1/organizations/current/exports/${requestBody.export.id}`,
    );
    expect(status.status()).toBe(200);
    const statusBody = (await status.json()) as {
      export: { status: string; manifest: { fileCount: number } | null };
    };
    if (statusBody.export.status !== "completed") {
      const jobResponse = await localSupabaseRequest(
        `/rest/v1/organization_export_jobs?select=status,safe_error_code,attempt_count,checkpoint_version,lease_owner,lease_expires_at&organization_id=eq.${organizationId}&id=eq.${requestBody.export.id}`,
      );
      const rows = jobResponse.ok
        ? ((await jobResponse.json()) as {
            status: string;
            safe_error_code: string | null;
            attempt_count: number;
            checkpoint_version: number;
            lease_owner: string | null;
            lease_expires_at: string | null;
          }[])
        : [];
      const snapshotResponse = await localSupabaseRequest(
        `/rest/v1/organization_export_snapshots?select=materialized_at,artifact_inventory&organization_id=eq.${organizationId}&export_job_id=eq.${requestBody.export.id}`,
      );
      const snapshots = snapshotResponse.ok
        ? ((await snapshotResponse.json()) as {
            materialized_at: string | null;
            artifact_inventory: unknown[];
          }[])
        : [];
      throw new Error(
        `Export did not complete: ${JSON.stringify(
          rows.map((row) => ({
            status: row.status,
            safeErrorCode: row.safe_error_code,
            attemptCount: row.attempt_count,
            checkpointVersion: row.checkpoint_version,
          })),
        )}; snapshots=${JSON.stringify(
          snapshots.map((snapshot) => ({
            materialized: snapshot.materialized_at !== null,
            inventoryCount: snapshot.artifact_inventory.length,
          })),
        )}`,
      );
    }
    expect(statusBody.export.manifest?.fileCount).toBeGreaterThan(1);

    await page.reload();
    await page
      .getByRole("button", { name: "Organization settings", exact: true })
      .click();
    const completedDialog = page.getByRole("dialog", {
      name: "Organization settings",
      exact: true,
    });
    await completedDialog
      .getByRole("tab", { name: "Exports", exact: true })
      .click();
    await expect(
      completedDialog.getByText("Status: Completed", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m1-export-completed-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });

    const downloadResponse = page.waitForResponse(
      (response) =>
        responsePath(response) ===
          `/api/v1/organizations/current/exports/${requestBody.export.id}/download` &&
        response.request().method() === "GET",
    );
    const browserDownload = page.waitForEvent("download");
    await completedDialog
      .getByRole("button", { name: "Download export", exact: true })
      .click();
    const attachment = await downloadResponse;
    expect(attachment.status()).toBe(200);
    expect((await browserDownload).suggestedFilename()).toBe(
      "organization-export-v1.zip",
    );
    const attachmentBody = (await attachment.json()) as { url: string };
    const archiveResponse = await context.request.get(attachmentBody.url);
    expect(archiveResponse.status()).toBe(200);
    const archivePath = testInfo.outputPath("m1-export-completed.zip");
    await writeFile(archivePath, await archiveResponse.body());
    const { stdout: manifestText } = await execFileAsync("unzip", [
      "-p",
      archivePath,
      "manifest.json",
    ]);
    const manifest = JSON.parse(manifestText) as {
      organizationId: string;
      verification: { status: string };
      files: {
        path: string;
        source?: { bucket?: string; sourcePath?: string };
        sha256: string;
      }[];
    };
    expect(manifest.organizationId).toBe(organizationId);
    expect(manifest.verification.status).toBe("verified");
    const copied = manifest.files.find(
      (file) =>
        file.source?.bucket === artifactBucket &&
        file.source.sourcePath === sourcePath,
    );
    expect(copied).toBeDefined();
    expect(copied?.path).toMatch(/^artifacts\//);
    const { stdout: artifactText } = await execFileAsync("unzip", [
      "-p",
      archivePath,
      copied!.path,
    ]);
    expect(artifactText).toBe(artifactBytes.toString("utf8"));
    expect(copied?.sha256).toBe(
      createHash("sha256").update(artifactBytes).digest("hex"),
    );
    await unlink(archivePath);

    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      completedDialog.getByText("Status: Completed", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m1-export-completed-mobile.png"),
      fullPage: true,
      animations: "disabled",
    });
  } finally {
    try {
      if (organizationId) {
        await removeScopedObjects(exportBucket, organizationId);
        await removeScopedObjects(artifactBucket, organizationId);
      }
      await fixtures.cleanup();
    } finally {
      await context.close().catch(() => undefined);
    }
  }
});
