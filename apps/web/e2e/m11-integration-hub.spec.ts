import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type APIResponse,
  type TestInfo,
} from "@playwright/test";
import {
  connectorCatalogueResponseSchema,
  connectorOverviewResponseSchema,
  connectorOverviewsResponseSchema,
  connectorResponseSchema,
  diagnosticsExportResponseSchema,
} from "@repo/contracts/connectors/schemas";
import {
  LIVE_API_ORIGIN,
  RunScopedAccounts,
  type TestAccount,
} from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live Playwright fixtures run outside Turbo. */
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3010";
const MAIL_ORIGIN = process.env.E2E_MAILPIT_ORIGIN ?? "http://127.0.0.1:54324";
const apiPath = (suffix: string) => `${LIVE_API_ORIGIN}/api/v1${suffix}`;

async function createOrganization(
  context: BrowserContext,
  account: TestAccount,
  label: string,
) {
  const response = await context.request.post(apiPath("/organizations"), {
    data: {
      idempotencyKey: randomUUID(),
      legalName: `M11 ${label} ${randomUUID()}`,
      registeredAddress: {
        addressLine1: "11 Integration Street",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      manufacturerContactName: "M11 Fixture Owner",
      manufacturerContactEmail: account.email,
    },
  });
  expect(response.status()).toBe(201);
  const body = (await response.json()) as { id: string };
  return body.id;
}

async function connectorResponse(response: APIResponse, canary: string) {
  expect(response.status()).toBe(200);
  const body: unknown = await response.json();
  expect(JSON.stringify(body)).not.toContain(canary);
  return connectorResponseSchema.parse(body).connector;
}

async function uiCommand(
  page: Page,
  connectorId: string,
  suffix: string,
  label: string,
  canary: string,
) {
  const pending = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
        `/api/v1/connectors/${connectorId}${suffix}` &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: label, exact: true }).click();
  const response = await pending;
  const body: unknown = await response.json();
  const errorCode =
    body && typeof body === "object" && "code" in body
      ? String(body.code)
      : "none";
  expect(response.status(), `${label} response (code: ${errorCode})`).toBe(200);
  expect(JSON.stringify(body)).not.toContain(canary);
  return connectorResponseSchema.parse(body).connector;
}

/** The fixture rows belong only to this run's tracked organization and cascade at cleanup. */
async function measureOverviewReads(
  context: BrowserContext,
  organizationId: string,
  actorUserId: string,
  testInfo: TestInfo,
) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key)
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is required for scoped load fixtures",
    );
  const insert = await fetch(
    `${process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"}/rest/v1/connectors`,
    {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        Array.from({ length: 100 }, (_, index) => ({
          id: randomUUID(),
          organization_id: organizationId,
          connector_type: "reference_conformance",
          display_name: `M11 load fixture ${index + 1}`,
          adapter_version: "1.0.0",
          mapping_version: "v1",
          connection_config: {},
          commit_policy: "manual",
          enabled: false,
          created_by: actorUserId,
          updated_by: actorUserId,
          disabled_at: new Date().toISOString(),
          disabled_by: actorUserId,
        })),
      ),
    },
  );
  expect(insert.status, "Scoped connector load fixture insert").toBe(201);
  const target = apiPath("/connectors/overview?page=1&pageSize=100");
  for (let index = 0; index < 2; index++) {
    const warmup = await context.request.get(target);
    expect(warmup.status()).toBe(200);
    expect(
      connectorOverviewsResponseSchema.parse(await warmup.json()).connectors
        .rows,
    ).toHaveLength(100);
  }
  const durations: number[] = [];
  // A bounded 50-read smoke measurement stays below the existing 60/minute route/IP throttle.
  for (let wave = 0; wave < 5; wave++) {
    const observed = await Promise.all(
      Array.from({ length: 10 }, async () => {
        const startedAt = performance.now();
        const response = await context.request.get(target);
        expect(response.status(), "Bounded overview read").toBe(200);
        const body = connectorOverviewsResponseSchema.parse(
          await response.json(),
        );
        expect(body.connectors.rows).toHaveLength(100);
        expect(body.connectors.total).toBe(101);
        return performance.now() - startedAt;
      }),
    );
    durations.push(...observed);
  }
  const sorted = [...durations].sort((left, right) => left - right);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const p99 = sorted[Math.ceil(sorted.length * 0.99) - 1];
  const summary = JSON.stringify(
    {
      dataset:
        "101 run-owned reference connectors, 100 synthetic disconnected rows; no vendor I/O or production workload",
      samples: durations.length,
      concurrentRequests: 10,
      rowsPerPage: 100,
      batches: 1,
      throttleWindowPauseMs: 0,
      p95Ms: p95,
      p99Ms: p99,
      targets: { p95Ms: 400, p99Ms: 1000 },
    },
    null,
    2,
  );
  const summaryPath = testInfo.outputPath("overview-read-load.json");
  await writeFile(summaryPath, summary, "utf8");
  await testInfo.attach("overview-read-load", {
    path: summaryPath,
    contentType: "application/json",
  });
  expect(durations).toHaveLength(50);
}

/** Cleanup only messages addressed to generated fixtures; never submit an empty/global deletion. */
async function cleanupMail(emails: readonly string[]) {
  if (!emails.length) return;
  const listing = await fetch(`${MAIL_ORIGIN}/api/v1/messages?limit=1000`);
  expect(listing.ok).toBe(true);
  const payload = (await listing.json()) as {
    messages?: { ID?: string; Id?: string }[];
  };
  const ownedIds: string[] = [];
  for (const item of payload.messages ?? []) {
    const id = item.ID ?? item.Id;
    if (!id) continue;
    const detailResponse = await fetch(
      `${MAIL_ORIGIN}/api/v1/message/${encodeURIComponent(id)}`,
    );
    if (!detailResponse.ok) continue;
    const detail = (await detailResponse.json()) as {
      To?: { Address?: string }[];
    };
    if (
      detail.To?.length &&
      detail.To.every(
        ({ Address }) =>
          Address !== undefined && emails.includes(Address.toLowerCase()),
      )
    )
      ownedIds.push(id);
  }
  if (!ownedIds.length) return;
  const deletion = await fetch(`${MAIL_ORIGIN}/api/v1/messages`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ IDs: ownedIds }),
  });
  expect(deletion.ok).toBe(true);
}

test("M11 owner manages write-only credentials, conflicts and safe connection lifecycle without crossing tenants", async ({
  browser,
}, testInfo) => {
  test.setTimeout(600_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const ownerContext = await browser.newContext({
    baseURL: WEB_ORIGIN,
    reducedMotion: "reduce",
  });
  const viewerContext = await browser.newContext({ baseURL: WEB_ORIGIN });
  const otherContext = await browser.newContext({ baseURL: WEB_ORIGIN });
  const emails: string[] = [];
  const canary = `m11-fixture-canary-${randomUUID()}`;
  let journeyError: unknown;
  let cleanupError: unknown;
  try {
    const owner = await fixtures.createVerified(ownerContext, "m11-owner");
    emails.push(owner.email);
    const organizationId = await createOrganization(
      ownerContext,
      owner,
      "Owner",
    );
    fixtures.trackOrganization(organizationId);
    const page = await ownerContext.newPage();
    const browserVersion = browser.version();
    await testInfo.attach("browser-version", {
      body: `${testInfo.project.name}: ${browserVersion}; reduced motion enabled`,
      contentType: "text/plain",
    });
    await page.goto("/connectors");
    await expect(
      page.getByRole("heading", { name: "Integration catalogue", exact: true }),
    ).toBeVisible();
    const catalogueResponse = await ownerContext.request.get(
      apiPath("/connectors/catalogue"),
    );
    expect(catalogueResponse.status()).toBe(200);
    const catalogue = connectorCatalogueResponseSchema.parse(
      await catalogueResponse.json(),
    ).catalogue;
    expect(catalogue).toHaveLength(16);
    expect(
      catalogue.filter((entry) => entry.canConfigure).map((entry) => entry.id),
    ).toEqual([
      "reference_conformance",
      "github_actions",
      "gitlab_ci",
      "azure_devops",
    ]);
    expect(
      catalogue.find((entry) => entry.id === "reference_conformance"),
    ).toMatchObject({
      implementation: "reference",
      scopeIntrospection: "not_applicable",
    });
    for (const id of ["github_actions", "gitlab_ci", "azure_devops"]) {
      expect(catalogue.find((entry) => entry.id === id)).toMatchObject({
        implementation: "ci",
        canConfigure: true,
        scopeIntrospection: "unavailable",
      });
    }
    const githubRow = page
      .getByRole("row")
      .filter({ has: page.getByText("GitHub and Actions", { exact: true }) });
    await expect(
      githubRow.getByRole("button", { name: "Configure GitHub and Actions" }),
    ).toBeVisible();
    await githubRow.locator("summary").focus();
    await page.keyboard.press("Enter");
    await expect(
      githubRow.getByText(/least-privilege GitHub App/),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m11-catalogue-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("m11-catalogue-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    await githubRow
      .getByRole("button", { name: "Configure GitHub and Actions" })
      .click();
    await expect(page.getByLabel("Connector type")).toHaveValue(
      "github_actions",
    );
    await expect(page.getByLabel("GitHub App ID")).toBeVisible();
    await expect(page.getByLabel("GitHub installation ID")).toBeVisible();
    await expect(
      page.getByText(/Contents: read for release tag verification/),
    ).toBeVisible();
    await page.getByRole("button", { name: "Close form" }).click();

    const configure = page.getByRole("button", {
      name: "Configure reference adapter",
      exact: true,
    });
    await configure.focus();
    await page.keyboard.press("Enter");
    await page
      .getByLabel("Display name", { exact: true })
      .fill("M11 reference fixture");
    const created = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/connectors" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Add connector", exact: true })
      .click();
    const createdResponse = await created;
    expect(createdResponse.status()).toBe(201);
    const connectorId = connectorResponseSchema.parse(
      await createdResponse.json(),
    ).connector.id;
    await expect(page).toHaveURL(new RegExp(`/connectors/${connectorId}$`));
    await expect(
      page.getByRole("heading", { name: "M11 reference fixture", exact: true }),
    ).toBeVisible();
    expect(
      (
        await ownerContext.request.post(
          apiPath(`/connectors/${connectorId}/secret`),
          { data: { secretValue: canary } },
        )
      ).status(),
    ).toBe(400);
    await page.getByLabel("Set secret", { exact: true }).fill(canary);
    let connector = await uiCommand(
      page,
      connectorId,
      "/secret",
      "Set secret",
      canary,
    );
    expect(connector.hasSecret).toBe(true);
    await expect(page.locator('input[type="password"]')).toHaveValue("");
    connector = await uiCommand(
      page,
      connectorId,
      "/test",
      "Test connection",
      canary,
    );
    expect(connector.lastTestOutcome).toBe("success");
    await expect(
      page.getByText("State: healthy", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(
        /Reference fixture validation succeeded; no vendor endpoint was contacted/,
      ),
    ).toBeVisible();
    const reportResponse = await ownerContext.request.post(
      apiPath(`/connectors/${connectorId}/diagnostics/export`),
      { data: {} },
    );
    expect(reportResponse.status()).toBe(200);
    const report: unknown = await reportResponse.json();
    expect(JSON.stringify(report)).not.toContain(canary);
    diagnosticsExportResponseSchema.parse(report);

    await page
      .getByLabel("Display name", { exact: true })
      .fill("My preserved M11 draft");
    const remote = await connectorResponse(
      await ownerContext.request.patch(apiPath(`/connectors/${connectorId}`), {
        data: {
          displayName: "Other session update",
          mappingVersion: connector.mappingVersion,
          commitPolicy: connector.commitPolicy,
          connectionConfig: connector.connectionConfig,
          expectedVersion: connector.version,
          idempotencyKey: randomUUID(),
        },
      }),
      canary,
    );
    const conflictResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/connectors/${connectorId}` &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    expect((await conflictResponse).status()).toBe(409);
    const refreshed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/connectors/${connectorId}/overview` &&
        response.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Reload current data", exact: true })
      .click();
    const refreshedResponse = await refreshed;
    expect(refreshedResponse.status(), "Reload conflict overview").toBe(200);
    expect(
      connectorOverviewResponseSchema.parse(await refreshedResponse.json())
        .overview.connector.version,
    ).toBe(remote.version);
    await expect(
      page.getByText(
        "A newer configuration is available. Your draft has been preserved.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(page.getByLabel("Display name", { exact: true })).toHaveValue(
      "My preserved M11 draft",
    );
    await expect(
      page.getByRole("button", { name: "Save connection", exact: true }),
    ).toBeDisabled();
    await page
      .getByRole("button", {
        name: "Reapply draft to current version",
        exact: true,
      })
      .click();
    await expect(
      page.getByLabel("Display name", { exact: true }),
    ).toBeFocused();
    const saved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/connectors/${connectorId}` &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    expect((await saved).status()).toBe(200);
    expect(remote.version).toBeGreaterThan(connector.version);
    await uiCommand(page, connectorId, "/test", "Test connection", canary);
    await expect(
      page.getByText("State: healthy", { exact: true }),
    ).toBeVisible();

    await page
      .getByLabel("Reason for disconnect or revoke", { exact: true })
      .fill("M11 fixture maintenance");
    connector = await uiCommand(
      page,
      connectorId,
      "/disconnect",
      "Disconnect",
      canary,
    );
    expect(connector.enabled).toBe(false);
    const prematureReconnect = await ownerContext.request.post(
      apiPath(`/connectors/${connectorId}/reconnect`),
      {
        data: {
          expectedVersion: connector.version,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(prematureReconnect.status()).toBe(409);
    connector = await uiCommand(
      page,
      connectorId,
      "/test",
      "Test connection",
      canary,
    );
    expect(connector.enabled).toBe(false);
    connector = await uiCommand(
      page,
      connectorId,
      "/reconnect",
      "Reconnect",
      canary,
    );
    expect(connector.enabled).toBe(true);
    await expect(
      page.getByText("State: healthy", { exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m11-connection-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("m11-connection-mobile.png"),
      fullPage: true,
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await page.setViewportSize({ width: 1280, height: 900 });

    const viewer = await fixtures.createVerified(viewerContext, "m11-viewer");
    emails.push(viewer.email);
    const invitation = await ownerContext.request.post(
      apiPath("/invitations"),
      { data: { email: viewer.email, role: "viewer" } },
    );
    const invitationBody = (await invitation.json()) as {
      id: string;
      message?: string;
    };
    expect(invitation.status(), invitationBody.message).toBe(201);
    fixtures.trackInvitation(invitationBody.id);
    const accepted = await viewerContext.request.post(
      apiPath("/invitations/accept"),
      { data: { token: await fixtures.invitationToken(viewer.email) } },
    );
    expect(accepted.status()).toBe(200);
    expect(
      (
        await viewerContext.request.get(
          apiPath(`/connectors/${connectorId}/overview`),
        )
      ).status(),
    ).toBe(200);
    for (const suffix of [
      "/secret",
      "/secret/revoke",
      "/disconnect",
      "/test",
    ]) {
      const denied = await viewerContext.request.post(
        apiPath(`/connectors/${connectorId}${suffix}`),
        {
          data: {
            expectedVersion: connector.version,
            idempotencyKey: randomUUID(),
            secretValue: canary,
            reason: "Forbidden fixture action",
          },
        },
      );
      expect(denied.status(), `viewer ${suffix}`).toBe(403);
    }
    const viewerPage = await viewerContext.newPage();
    await viewerPage.goto(`/connectors/${connectorId}`);
    await expect(
      viewerPage.getByRole("heading", {
        name: "My preserved M11 draft",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      viewerPage.getByRole("button", { name: "Test connection", exact: true }),
    ).toHaveCount(0);
    await expect(viewerPage.locator('input[type="password"]')).toHaveCount(0);

    const other = await fixtures.createVerified(otherContext, "m11-other");
    emails.push(other.email);
    const otherOrgId = await createOrganization(otherContext, other, "Other");
    fixtures.trackOrganization(otherOrgId);
    expect(
      (
        await otherContext.request.get(
          apiPath(`/connectors/${connectorId}/overview`),
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await otherContext.request.post(
          apiPath(`/connectors/${connectorId}/secret`),
          {
            data: {
              secretValue: canary,
              expectedVersion: connector.version,
              idempotencyKey: randomUUID(),
            },
          },
        )
      ).status(),
    ).toBe(404);
    const ownList = await otherContext.request.get(
      apiPath("/connectors/overview?page=1&pageSize=25"),
    );
    expect(ownList.status()).toBe(200);
    expect(JSON.stringify(await ownList.json())).not.toContain(connectorId);

    await page
      .getByLabel("Reason for disconnect or revoke", { exact: true })
      .fill("M11 fixture revoke");
    connector = await uiCommand(
      page,
      connectorId,
      "/secret/revoke",
      "Revoke credential",
      canary,
    );
    expect(connector.hasSecret).toBe(false);
    expect(connector.enabled).toBe(false);
    await expect(
      page.getByRole("button", { name: "Reconnect", exact: true }),
    ).toBeDisabled();
    const finalOverview = await ownerContext.request.get(
      apiPath(`/connectors/${connectorId}/overview`),
    );
    expect(finalOverview.status()).toBe(200);
    const finalBody: unknown = await finalOverview.json();
    expect(JSON.stringify(finalBody)).not.toContain(canary);
    expect(
      connectorOverviewResponseSchema.parse(finalBody).overview.connection
        .status,
    ).toBe("not_connected");
    await measureOverviewReads(
      ownerContext,
      organizationId,
      owner.publicUserId,
      testInfo,
    );
    await testInfo.attach("accessibility-checks", {
      body: "Keyboard activation of native catalogue disclosure and configuration, focus restoration after draft rebase, labelled write-only fields, textual connection states, reduced motion, desktop/mobile overflow. axe-core is not installed; no automated WCAG conformance claim.",
      contentType: "text/plain",
    });
  } catch (error) {
    journeyError = error;
  } finally {
    await Promise.all([
      ownerContext.close(),
      viewerContext.close(),
      otherContext.close(),
    ]);
    const cleanup = await Promise.allSettled([
      fixtures.cleanup(),
      cleanupMail(emails),
    ]);
    const failures = cleanup.filter(
      (entry): entry is PromiseRejectedResult => entry.status === "rejected",
    );
    if (failures.length)
      cleanupError = new AggregateError(
        failures.map((entry) => entry.reason),
        "M11 exact fixture cleanup failed",
      );
  }
  if (journeyError && cleanupError)
    throw new AggregateError(
      [journeyError, cleanupError],
      "M11 journey and exact fixture cleanup failed",
    );
  if (journeyError) throw journeyError;
  if (cleanupError) throw cleanupError;
});
