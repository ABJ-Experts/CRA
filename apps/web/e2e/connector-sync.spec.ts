import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  LIVE_API_ORIGIN,
  RunScopedAccounts,
  type TestAccount,
} from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const CONNECTOR_SECRET = "local-e2e-connector-secret";

type CreatedOrganization = Readonly<{ id: string }>;
type LegalEntitiesResponse = Readonly<{
  legalEntities: readonly Readonly<{ id: string }>[];
}>;

const REQUIRED_POLICIES: readonly Readonly<{
  entityType: "product" | "release";
  fieldName: string;
}>[] = [
  { entityType: "product", fieldName: "name" },
  { entityType: "product", fieldName: "internalCode" },
  { entityType: "product", fieldName: "productType" },
  { entityType: "product", fieldName: "description" },
  { entityType: "product", fieldName: "parentExternalId" },
  { entityType: "release", fieldName: "label" },
  { entityType: "release", fieldName: "releaseVersion" },
  { entityType: "release", fieldName: "description" },
];

async function createOrganization(
  context: BrowserContext,
  account: TestAccount,
  legalName: string,
): Promise<string> {
  const response = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/organizations`,
    {
      timeout: 10_000,
      data: {
        idempotencyKey: randomUUID(),
        legalName,
        registeredAddress: {
          addressLine1: "100 Connector Sync Street",
          locality: "London",
          postalCode: "SW1A 1AA",
          country: "GB",
        },
        mainEstablishmentCountry: "GB",
        manufacturerContactName: "Connector Sync Owner",
        manufacturerContactEmail: account.email,
      },
    },
  );
  expect(response.status()).toBe(201);
  return ((await response.json()) as CreatedOrganization).id;
}

async function currentLegalEntityId(context: BrowserContext): Promise<string> {
  const response = await context.request.get(
    `${LIVE_API_ORIGIN}/api/v1/organizations/current/legal-entities`,
    { timeout: 10_000 },
  );
  expect(response.status()).toBe(200);
  const legalEntity = ((await response.json()) as LegalEntitiesResponse)
    .legalEntities[0];
  expect(legalEntity).toBeDefined();
  if (!legalEntity)
    throw new Error("Run-scoped organization has no legal entity");
  return legalEntity.id;
}

function configFor(
  account: TestAccount,
  legalEntityId: string,
  simulate?: "rate_limit",
): string {
  return JSON.stringify({
    scopeFilter: {
      scenario: "create",
      ...(simulate ? { simulate } : {}),
    },
    defaultOwnerBinding: {
      responsibleOwnerId: account.publicUserId,
      legalEntityId,
    },
  });
}

async function savePolicy(
  page: Page,
  policy: Readonly<{ entityType: "product" | "release"; fieldName: string }>,
): Promise<void> {
  await page
    .getByLabel("Entity type", { exact: true })
    .selectOption(policy.entityType);
  await page
    .getByLabel("Field name", { exact: true })
    .selectOption(policy.fieldName);
  await page
    .getByLabel("Authority policy", { exact: true })
    .selectOption("external_authoritative");

  const preview = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith("/mapping/preview") &&
      response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page
    .getByRole("button", { name: "Preview impact", exact: true })
    .click();
  expect((await preview).status()).toBe(200);
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeEnabled();

  const save = page.waitForResponse(
    (response) =>
      /\/api\/v1\/connectors\/[^/]+\/mapping$/.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === "POST",
    { timeout: 15_000 },
  );
  await page.getByRole("button", { name: "Save", exact: true }).click();
  expect((await save).status()).toBe(200);
  await expect(
    page.getByText("Field authority policy saved.", { exact: true }),
  ).toBeVisible();
}

test("a run-scoped owner completes connector sync, observes retry safety, and cannot leak it across tenants", async ({
  browser,
}, testInfo) => {
  // A single live-flow test deliberately exercises two account lifecycles,
  // durable worker retries, and the reference provider's rate-limit recovery.
  // The local auth rate limiter may defer either account creation by a minute,
  // so keep the complete resilient flow within one bounded five-minute budget.
  test.setTimeout(300_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });
  let otherContext: BrowserContext | null = null;
  let mobileContext: BrowserContext | null = null;

  try {
    const account = await fixtures.createVerified(context, "connector-owner");
    const page = await context.newPage();
    const organizationId = await createOrganization(
      context,
      account,
      `E2E Connector Sync ${testInfo.parallelIndex}-${Date.now()}`,
    );
    fixtures.trackOrganization(organizationId);
    const proxiedSession = await context.request.get(
      `${WEB_ORIGIN}/api/v1/auth/session`,
      { timeout: 10_000 },
    );
    expect(proxiedSession.status()).toBe(200);
    expect(
      (
        (await proxiedSession.json()) as {
          organizations: readonly Readonly<{ id: string }>[];
        }
      ).organizations.some(
        (organization) => organization.id === organizationId,
      ),
    ).toBe(true);
    const legalEntityId = await currentLegalEntityId(context);
    const displayName = `E2E Reference Connector ${testInfo.parallelIndex}`;

    const connectorCreated = await context.request.post(
      `${LIVE_API_ORIGIN}/api/v1/connectors`,
      {
        timeout: 10_000,
        data: {
          connectorType: "reference_conformance",
          displayName,
          adapterVersion: "1.0.0",
          mappingVersion: "reference-conformance-v1",
          connectionConfig: JSON.parse(configFor(account, legalEntityId)),
          commitPolicy: "manual",
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(connectorCreated.status()).toBe(201);
    const connectorId = (
      (await connectorCreated.json()) as { connector: { id: string } }
    ).connector.id;
    await page.goto(`/connectors/${connectorId}`, { timeout: 10_000 });

    await page.getByLabel("Set secret", { exact: true }).fill(CONNECTOR_SECRET);
    const secretSaved = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/secret") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Set secret", exact: true }).click();
    expect((await secretSaved).status()).toBe(200);
    await expect(
      page.getByText("Secret saved.", { exact: true }),
    ).toBeVisible();

    const tested = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/test") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Test connection", exact: true })
      .click();
    expect((await tested).status()).toBe(200);
    await expect(
      page.getByText("Connection successful", { exact: true }),
    ).toBeVisible();

    for (const policy of REQUIRED_POLICIES) {
      await savePolicy(page, policy);
    }
    await expect(
      page.getByText(
        "Configure every required field authority policy before starting a sync.",
      ),
    ).toHaveCount(0);

    const dryRunStarted = page.waitForResponse(
      (response) =>
        /\/api\/v1\/connectors\/[^/]+\/sync-runs$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Start dry run (incremental)", exact: true })
      .click();
    expect((await dryRunStarted).status()).toBe(202);
    await expect(
      page.getByText("Waiting for review", { exact: true }),
    ).toBeVisible({
      timeout: 40_000,
    });
    await expect(page.getByText("1", { exact: true })).toBeVisible();
    await expect(page.getByText("create", { exact: true })).toBeVisible();

    const commitRequested = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith("/request-commit") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Request commit", exact: true })
      .click();
    expect((await commitRequested).status()).toBe(200);
    await expect(page.getByText("Completed", { exact: true })).toBeVisible({
      timeout: 40_000,
    });

    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export diagnostics", exact: true })
      .click();
    const diagnostics = await download;
    const diagnosticsPath = await diagnostics.path();
    expect(diagnosticsPath).not.toBeNull();
    const report = await readFile(diagnosticsPath as string, "utf8");
    expect(report).toContain(connectorId);
    expect(report).not.toContain(CONNECTOR_SECRET);

    await page.goto("/products");
    await expect(
      page.getByText("Sentinel Gateway", { exact: true }),
    ).toBeVisible();

    await page.goto(`/connectors/${connectorId}`);
    await page
      .getByLabel("Connection config (JSON, no secrets)", { exact: true })
      .fill(configFor(account, legalEntityId, "rate_limit"));
    const connectionSaved = page.waitForResponse(
      (response) =>
        /\/api\/v1\/connectors\/[^/]+$/.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save connection", exact: true })
      .click();
    expect((await connectionSaved).status()).toBe(200);

    await page
      .getByRole("button", { name: "Start dry run (incremental)", exact: true })
      .click();
    await expect(page.getByText("Retrying", { exact: true })).toBeVisible({
      timeout: 40_000,
    });
    await page.goto("/products");
    await expect(
      page.getByText("Sentinel Gateway", { exact: true }),
    ).toBeVisible();

    mobileContext = await browser.newContext({
      baseURL: WEB_ORIGIN,
      viewport: { width: 390, height: 844 },
    });
    await mobileContext.addCookies(await context.cookies());
    const mobile = await mobileContext.newPage();
    await mobile.goto(`/connectors/${connectorId}`);
    await expect(
      mobile.getByRole("heading", { name: displayName, exact: true }),
    ).toBeVisible();
    await mobile.screenshot({
      path: testInfo.outputPath("connector-mobile.png"),
      fullPage: true,
    });
    await page.screenshot({
      path: testInfo.outputPath("connector-desktop.png"),
      fullPage: true,
    });

    otherContext = await browser.newContext({ baseURL: WEB_ORIGIN });
    const otherAccount = await fixtures.createVerified(
      otherContext,
      "connector-other-tenant",
    );
    const otherOrganizationId = await createOrganization(
      otherContext,
      otherAccount,
      `E2E Connector Isolation ${testInfo.parallelIndex}-${Date.now()}`,
    );
    fixtures.trackOrganization(otherOrganizationId);
    const hidden = await otherContext.request.get(
      `${LIVE_API_ORIGIN}/api/v1/connectors/${connectorId}`,
    );
    expect(hidden.status()).toBe(404);
    expect(await hidden.text()).not.toContain(displayName);
  } finally {
    await mobileContext?.close();
    await otherContext?.close();
    await context.close();
    await fixtures.cleanup();
  }
});
