import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { decodeJwt } from "jose";
import {
  expect,
  test,
  type APIRequestContext,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { sessionResponseSchema } from "@repo/contracts/auth/schemas";
import {
  licenseUsageSnapshotSchema,
  licenseUsageOperationInputSchema,
  licenseUsageExportResponseSchema,
  licenseUsageReconciliationResponseSchema,
} from "@repo/contracts/licensing/schemas";
import type {
  LicenseUsageSnapshot,
  LicenseUsageOperationInput,
  LicenseUsageExportResponse,
} from "@repo/contracts/licensing/types";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright journeys run outside Turbo's cached task graph. */
const usagePath = "/api/v1/licensing/usage";
const owner = "owner@cra.test";
const labels = {
  seats: "Active members and reserved invitations",
  products: "Nonarchived products",
  storage: "Customer storage bytes",
  protected_storage: "Protected storage",
};
const statusLabels = {
  normal: "Within limit",
  near_limit: "Near limit",
  at_limit: "At limit",
  over_limit: "Over limit",
  unavailable: "Unavailable",
};

// All owned UI/API sign-ins share this worker-local schedule. The existing
// Playwright config runs one worker; reserve the next slot before awaiting so
// concurrent helpers cannot accidentally submit within the same eight seconds.
let nextOwnedSignInAt = 0;
async function paceOwnedSignIn() {
  const now = Date.now();
  const wait = Math.max(0, nextOwnedSignInAt - now);
  nextOwnedSignInAt = Math.max(now, nextOwnedSignInAt) + 8_000;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
}

function recordOwnedSignInCompletion() {
  // Measure the conservative gap from the completed request, so browser click
  // latency cannot shorten the interval between actual sign-in submissions.
  nextOwnedSignInAt = Math.max(nextOwnedSignInAt, Date.now() + 8_000);
}

async function localEgress(context: BrowserContext) {
  await context.route(
    (url) =>
      ["http:", "https:"].includes(url.protocol) &&
      !["localhost", "127.0.0.1"].includes(url.hostname),
    (route) => route.abort("blockedbyclient"),
  );
}
async function signIn(page: Page, email = owner) {
  await page.goto("/sign-in");
  // Exercise a hydrated control before filling the controlled sign-in inputs.
  await page
    .getByRole("button", { name: "Show password", exact: true })
    .click();
  await expect(page.getByTestId("si-password")).toHaveAttribute("type", "text");
  await page
    .getByRole("button", { name: "Hide password", exact: true })
    .click();
  await page.getByTestId("si-identifier").fill(email);
  await page.getByTestId("si-password").fill("Password123");
  await paceOwnedSignIn();
  const response = page.waitForResponse(
    (candidate) =>
      new URL(candidate.url()).pathname === "/api/v1/auth/sign-in" &&
      candidate.request().method() === "POST",
  );
  await page.getByTestId("si-submit").click();
  const completed = await response;
  recordOwnedSignInCompletion();
  expect(completed.status()).toBe(200);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.waitForLoadState("networkidle");
}
async function apiSignIn(request: APIRequestContext, email: string) {
  await paceOwnedSignIn();
  const response = await request.post("/api/v1/auth/sign-in", {
    data: { email, password: "Password123", remember: true },
  });
  recordOwnedSignInCompletion();
  expect(response.status()).toBe(200);
}
async function readUsage(
  request: APIRequestContext,
): Promise<LicenseUsageSnapshot> {
  const response = await request.get(usagePath);
  expect(response.status()).toBe(200);
  return licenseUsageSnapshotSchema.parse(await response.json());
}
function inputFor(snapshot: LicenseUsageSnapshot): LicenseUsageOperationInput {
  return licenseUsageOperationInputSchema.parse({
    expectedLicenseVersion: snapshot.license.version,
    expectedMeterVersion: snapshot.meterVersion,
    idempotencyKey: randomUUID(),
  });
}
function postResponse(page: Page, action: "export" | "reconcile") {
  return page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${usagePath}/${action}` &&
      response.request().method() === "POST",
  );
}
async function replayExport(
  request: APIRequestContext,
  input: LicenseUsageOperationInput,
  original: LicenseUsageExportResponse,
) {
  const response = await request.post(`${usagePath}/export`, { data: input });
  expect(response.status()).toBe(200);
  expect(licenseUsageExportResponseSchema.parse(await response.json())).toEqual(
    { ...original, replayed: true },
  );
}
function csvRows(content: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [],
    cell = "",
    quoted = false;
  for (let index = 0; index < content.length; index++) {
    const character = content[index];
    if (character === '"') {
      if (quoted && content[index + 1] === '"') {
        cell += '"';
        index++;
      } else quoted = !quoted;
    } else if (!quoted && character === ",") {
      row.push(cell);
      cell = "";
    } else if (!quoted && character === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (quoted || character !== "\r") cell += character;
  }
  expect(quoted).toBe(false);
  if (cell || row.length) rows.push([...row, cell]);
  return rows;
}
function assertCsv(content: string, receipt: LicenseUsageExportResponse) {
  const [header, ...rows] = csvRows(content);
  expect(rows).toHaveLength(4);
  const get = (row: string[], column: string) => row[header!.indexOf(column)];
  for (const [index, row] of rows.entries()) {
    const counter = receipt.snapshot.counters[index]!;
    expect(get(row, "counterId")).toBe(counter.id);
    expect(get(row, "definition")).toBe(counter.definition);
    expect(get(row, "unit")).toBe(counter.unit);
    expect(get(row, "value")).toBe(String(counter.value));
    expect(get(row, "components")).toBe(JSON.stringify(counter.components));
    expect(get(row, "availability")).toBe(counter.availability);
    expect(get(row, "state")).toBe(counter.state);
    expect(get(row, "limitKind")).toBe(counter.limit.kind);
    expect(get(row, "limitValue")).toBe(String(counter.limit.value));
    expect(get(row, "period")).toBe("current_state");
    expect(get(row, "resetRule")).toBe("source_changes_only");
    expect(get(row, "nextResetAt")).toBe("null");
    expect(get(row, "observedAt")).toBe(receipt.snapshot.observedAt);
    expect(get(row, "meterVersion")).toBe(
      String(receipt.snapshot.meterVersion),
    );
    expect(get(row, "licenseVersion")).toBe(
      String(receipt.snapshot.license.version),
    );
    expect(get(row, "policyRevision")).toBe(
      String(receipt.snapshot.license.policyRevision),
    );
    expect(get(row, "auditEventId")).toBe(receipt.auditEventId);
  }
}

test.beforeEach(async ({ context, baseURL }) => {
  expect(baseURL).toBeDefined();
  expect(["localhost", "127.0.0.1"]).toContain(new URL(baseURL!).hostname);
  await localEgress(context);
});

test("owner reads authoritative gauges and downloads audited JSON and CSV with exact provenance", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const runtimeErrors: string[] = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  await signIn(page);
  const sessionResponse = await page.request.get("/api/v1/auth/session");
  expect(sessionResponse.status()).toBe(200);
  const session = sessionResponseSchema.parse(await sessionResponse.json());
  const initial = await readUsage(page.request);
  expect(initial.organizationId).toBe(session.organization!.id);
  await page.goto("/organization?settings=licence");
  const table = page.getByRole("table", { name: "Licence capacity" });
  await expect(table).toBeVisible();
  await expect(table.getByRole("row")).toHaveCount(5);
  await expect(page.getByText(/No calendar reset/)).toBeVisible();
  await expect(page.getByText(/Licence policy never replaces/)).toBeVisible();
  for (const counter of initial.counters) {
    const row = table.getByRole("row").filter({ hasText: labels[counter.id] });
    await expect(row).toContainText(counter.definition);
    await expect(row).toContainText(
      counter.limit.kind === "exempt" && counter.state === "normal"
        ? "Informational"
        : statusLabels[counter.state],
    );
    if (counter.value !== null && counter.unit === "bytes")
      await expect(
        row
          .getByLabel(`${counter.value.toLocaleString("en-US")} bytes`, {
            exact: true,
          })
          .first(),
      ).toBeVisible();
    if (counter.availability === "unavailable")
      await expect(row).toContainText("Unavailable");
  }
  const draft = page.getByLabel("Signed licence artifact", { exact: true });
  await draft.fill("m15-02-preserved-local-draft");
  for (const format of ["json", "csv"] as const) {
    const button = page.getByRole("button", {
      name: `Export ${format.toUpperCase()}`,
      exact: true,
    });
    await expect(button).toBeEnabled();
    const posted = postResponse(page, "export");
    const downloading = page.waitForEvent("download");
    await button.click();
    const response = await posted;
    expect(response.status()).toBe(200);
    const input = licenseUsageOperationInputSchema.parse(
      response.request().postDataJSON(),
    );
    const receipt = licenseUsageExportResponseSchema.parse(
      await response.json(),
    );
    expect(receipt.snapshot.organizationId).toBe(initial.organizationId);
    expect(receipt.snapshot.license.version).toBe(input.expectedLicenseVersion);
    expect(receipt.snapshot.meterVersion).toBe(input.expectedMeterVersion);
    const download = await downloading;
    expect(await download.failure()).toBeNull();
    expect(download.suggestedFilename()).toMatch(
      new RegExp(`^licence-usage-[0-9TZ-]+\\.${format}$`),
    );
    const filename = testInfo.outputPath(`audited-usage.${format}`);
    await download.saveAs(filename);
    const contents = await readFile(filename, "utf8");
    if (format === "json")
      expect(
        licenseUsageExportResponseSchema.parse(JSON.parse(contents)),
      ).toEqual(receipt);
    else assertCsv(contents, receipt);
    await replayExport(page.request, input, receipt);
    await expect(draft).toHaveValue("m15-02-preserved-local-draft");
    await expect(
      page.getByRole("status").filter({
        hasText: `${format.toUpperCase()} usage snapshot downloaded`,
      }),
    ).toBeFocused();
  }
  expect(runtimeErrors).toEqual([]);
});

test("owner reconciles explicitly, replays its durable receipt and rejects stale or changed intent", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await signIn(page);
  await page.goto("/organization?settings=licence");
  const draft = page.getByLabel("Signed licence artifact", { exact: true });
  await draft.fill("m15-02-reconciliation-keeps-this-draft");
  const button = page.getByRole("button", {
    name: "Reconcile usage",
    exact: true,
  });
  await expect(button).toBeEnabled();
  const posted = postResponse(page, "reconcile");
  await button.click();
  const response = await posted;
  expect(response.status()).toBe(200);
  const input = licenseUsageOperationInputSchema.parse(
    response.request().postDataJSON(),
  );
  const receipt = licenseUsageReconciliationResponseSchema.parse(
    await response.json(),
  );
  expect(receipt.checked).toBeLessThanOrEqual(100);
  expect(receipt.released).toBeLessThanOrEqual(100);
  await expect(
    page.getByRole("status").filter({ hasText: /Reconciliation completed/ }),
  ).toBeFocused();
  await expect(draft).toHaveValue("m15-02-reconciliation-keeps-this-draft");
  const replay = await page.request.post(`${usagePath}/reconcile`, {
    data: input,
  });
  expect(replay.status()).toBe(200);
  expect(
    licenseUsageReconciliationResponseSchema.parse(await replay.json()),
  ).toEqual({ ...receipt, replayed: true });
  const after = await readUsage(page.request);
  expect(after.meterVersion).toBe(receipt.meterVersion);
  expect(after.reconciledAt).not.toBeNull();
  const changedIntent = await page.request.post(`${usagePath}/reconcile`, {
    data: {
      ...input,
      expectedMeterVersion: input.expectedMeterVersion === 0 ? 1 : 0,
    },
  });
  expect(changedIntent.status()).toBe(409);
  expect(await changedIntent.json()).toMatchObject({
    code: "license_usage_conflict",
  });
  for (const action of ["export", "reconcile"]) {
    const stale = await page.request.post(`${usagePath}/${action}`, {
      data: {
        ...inputFor(after),
        expectedMeterVersion: after.meterVersion === 0 ? 1 : 0,
      },
    });
    expect(stale.status()).toBe(409);
    expect(await stale.json()).toMatchObject({
      code: "license_usage_conflict",
    });
  }
  await expect(draft).toHaveValue("m15-02-reconciliation-keeps-this-draft");
});

test("usage remains keyboard readable within a narrow viewport with reduced motion", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await signIn(page);
  await page.goto("/organization?settings=licence");
  const region = page.getByRole("region", {
    name: "Usage readings, scroll horizontally if needed",
    exact: true,
  });
  await expect(
    page.getByRole("table", { name: "Licence capacity" }),
  ).toBeVisible();
  await region.focus();
  await expect(region).toBeFocused();
  await page.keyboard.press("ArrowRight");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const artifact = page.getByLabel("Signed licence artifact", { exact: true });
  await artifact.scrollIntoViewIfNeeded();
  const bounds = await artifact.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
});

test("viewer and anonymous requests cannot read, export or reconcile another scope", async ({
  page,
  browser,
  baseURL,
}) => {
  const anonymous = await browser.newContext({ baseURL });
  try {
    for (const action of ["export", "reconcile"])
      expect(
        (
          await anonymous.request.post(`${usagePath}/${action}`, {
            data: {
              expectedLicenseVersion: 0,
              expectedMeterVersion: 0,
              idempotencyKey: randomUUID(),
            },
          })
        ).status(),
      ).toBe(401);
    expect((await anonymous.request.get(usagePath)).status()).toBe(401);
    await signIn(page, "viewer@cra.test");
    expect((await page.request.get(usagePath)).status()).toBe(403);
    for (const action of ["export", "reconcile"])
      expect(
        (
          await page.request.post(`${usagePath}/${action}`, {
            data: {
              expectedLicenseVersion: 0,
              expectedMeterVersion: 0,
              idempotencyKey: randomUUID(),
            },
          })
        ).status(),
      ).toBe(403);
    await page.goto("/organization?settings=licence");
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: "You do not have permission to view licences." }),
    ).toBeVisible();
    await expect(
      page.getByRole("table", { name: "Licence capacity" }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Export JSON", exact: true }),
    ).toHaveCount(0);
  } finally {
    await anonymous.close();
  }
});

test("owner cannot inject a foreign organization or replay another actor's audited export", async ({
  page,
  browser,
  baseURL,
}) => {
  await signIn(page);
  const snapshot = await readUsage(page.request);
  const foreign = randomUUID();
  expect(foreign).not.toBe(snapshot.organizationId);
  expect(
    (await page.request.get(`${usagePath}?organizationId=${foreign}`)).status(),
  ).toBe(400);
  const input = inputFor(snapshot);
  for (const action of ["export", "reconcile"])
    expect(
      (
        await page.request.post(`${usagePath}/${action}`, {
          data: { ...input, organizationId: foreign },
        })
      ).status(),
    ).toBe(400);
  const response = await page.request.post(`${usagePath}/export`, {
    data: input,
  });
  expect(response.status()).toBe(200);
  const receipt = licenseUsageExportResponseSchema.parse(await response.json());
  const admin = await browser.newContext({ baseURL });
  try {
    await apiSignIn(admin.request, "admin@cra.test");
    const replay = await admin.request.post(`${usagePath}/export`, {
      data: input,
    });
    expect(replay.status()).toBe(409);
    expect(await replay.json()).toMatchObject({
      code: "license_usage_conflict",
    });
    await replayExport(page.request, input, receipt);
  } finally {
    await admin.close();
  }
});

test("revoking only this owner session blocks receipt replay and clears cached UI while another session works", async ({
  page,
  context,
  browser,
  baseURL,
}) => {
  test.setTimeout(120_000);
  const anonKey = process.env.E2E_SUPABASE_ANON_KEY;
  test.skip(
    !anonKey,
    "Scoped provider revocation requires the local public Supabase anon key.",
  );
  const supabaseOrigin =
    process.env.E2E_SUPABASE_ORIGIN ?? "http://127.0.0.1:54321";
  expect(["localhost", "127.0.0.1"]).toContain(
    new URL(supabaseOrigin).hostname,
  );
  const unaffected = await browser.newContext({ baseURL });
  try {
    await apiSignIn(unaffected.request, owner);
    await signIn(page);
    const snapshot = await readUsage(page.request);
    const input = inputFor(snapshot);
    const exported = await page.request.post(`${usagePath}/export`, {
      data: input,
    });
    expect(exported.status()).toBe(200);
    licenseUsageExportResponseSchema.parse(await exported.json());
    await page.goto("/organization?settings=licence");
    const exportButton = page.getByRole("button", {
      name: "Export JSON",
      exact: true,
    });
    await expect(exportButton).toBeEnabled();
    const access = (await context.cookies()).find(
      (cookie) => cookie.name === "cra_at",
    )?.value;
    if (!access) throw new Error("The isolated owner session is unavailable.");
    const survivingAccess = (await unaffected.cookies()).find(
      (cookie) => cookie.name === "cra_at",
    )?.value;
    if (!survivingAccess)
      throw new Error(
        "The independently owned surviving session is unavailable.",
      );
    const isolatedSessionId = decodeJwt(access).session_id;
    const survivingSessionId = decodeJwt(survivingAccess).session_id;
    if (
      typeof isolatedSessionId !== "string" ||
      typeof survivingSessionId !== "string"
    )
      throw new Error("The owned test sessions have no session identity.");
    // Compare privately: never print or persist access tokens or session IDs.
    expect(isolatedSessionId !== survivingSessionId).toBe(true);
    // This direct GoTrue local logout owns only the freshly signed-in page session.
    // It does not invoke CRA's global sign-out/epoch endpoint or change tenant policy.
    const revoked = await page.request.post(
      `${supabaseOrigin}/auth/v1/logout?scope=local`,
      { headers: { apikey: anonKey!, authorization: `Bearer ${access}` } },
    );
    expect(revoked.status()).toBe(204);
    for (const action of ["export", "reconcile"])
      expect([401, 403]).toContain(
        (
          await page.request.post(`${usagePath}/${action}`, { data: input })
        ).status(),
      );
    expect([401, 403]).toContain((await page.request.get(usagePath)).status());
    expect(
      (await unaffected.request.get("/api/v1/auth/session")).status(),
    ).toBe(200);
    expect((await unaffected.request.get(usagePath)).status()).toBe(200);
    const posted = postResponse(page, "export");
    await exportButton.click();
    expect([401, 403]).toContain((await posted).status());
    await expect(
      page.getByRole("table", { name: "Licence capacity" }),
    ).toHaveCount(0);
    await expect(
      page.getByLabel("Signed licence artifact", { exact: true }),
    ).toHaveCount(0);
  } finally {
    await unaffected.close();
  }
});
