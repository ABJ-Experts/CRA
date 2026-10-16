import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type Request,
} from "@playwright/test";
import { productComponentLinkResponseSchema } from "@repo/contracts/products";

import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

type CreatedOrganization = Readonly<{ id: string }>;
type LegalEntitiesResponse = Readonly<{
  legalEntities: readonly Readonly<{ id: string }>[];
}>;
type CreatedProduct = Readonly<{ product: Readonly<{ id: string }> }>;
type CreatedRelease = Readonly<{ release: Readonly<{ id: string }> }>;

async function captureRelationshipState(
  page: Page,
  testInfo: import("@playwright/test").TestInfo,
  name: string,
  target: import("@playwright/test").Locator,
): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`${name}-desktop.png`),
    fullPage: false,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await target.scrollIntoViewIfNeeded();
  await page.screenshot({
    path: testInfo.outputPath(`${name}-mobile.png`),
    fullPage: false,
  });
  await page.setViewportSize({ width: 1280, height: 720 });
}

async function openRelationshipManager(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Relationships", exact: true })
    .click();
  const dialog = page.getByRole("dialog", {
    name: "Relationships",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("tab", { name: "Record change", exact: true }).click();
}

async function openRelationshipOverview(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Relationships", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Relationships", exact: true }),
  ).toBeVisible();
}

async function onboardRunOrganization(
  page: Page,
  email: string,
  fixtureName: string,
): Promise<string> {
  await page.goto("/onboarding");
  await page
    .getByRole("textbox", { name: "Legal organization name", exact: true })
    .fill(fixtureName);
  await page
    .getByRole("combobox", {
      name: "Main establishment country",
      exact: true,
    })
    .click();
  await page
    .getByRole("option", { name: "United Kingdom", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Registered address line 1", exact: true })
    .fill("100 Relationship Test Street");
  await page
    .getByRole("textbox", { name: "City or locality", exact: true })
    .fill("London");
  await page
    .getByRole("textbox", { name: "Postal code", exact: true })
    .fill("SW1A 1AA");
  await page
    .getByRole("combobox", {
      name: "Registered address country",
      exact: true,
    })
    .click();
  await page
    .getByRole("option", { name: "United Kingdom", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Manufacturer contact name", exact: true })
    .fill("Relationship Owner");
  await page
    .getByRole("textbox", { name: "Manufacturer contact email", exact: true })
    .fill(email);

  const created = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/v1/organizations" &&
      response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: "Create organization", exact: true })
    .click();
  const response = await created;
  expect(response.status()).toBe(201);
  return ((await response.json()) as CreatedOrganization).id;
}

async function createProduct(
  context: BrowserContext,
  input: Readonly<{
    name: string;
    internalCode: string;
    legalEntityId: string;
    responsibleOwnerId: string;
  }>,
): Promise<string> {
  const response = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/products`,
    {
      data: {
        ...input,
        productType: "standalone_software",
        idempotencyKey: randomUUID(),
      },
    },
  );
  expect(response.status()).toBe(201);
  return ((await response.json()) as CreatedProduct).product.id;
}

async function createRelease(
  context: BrowserContext,
  productId: string,
  label: string,
): Promise<string> {
  const response = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/products/${productId}/releases`,
    {
      data: {
        label,
        version: "1.0.0",
        idempotencyKey: randomUUID(),
      },
    },
  );
  expect(response.status()).toBe(201);
  return ((await response.json()) as CreatedRelease).release.id;
}

test("a run-scoped owner records baseline, variant, component preview, and a rejected cycle", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  const requestStarts = new Map<Request, number>();
  const requests: {
    method: string;
    path: string;
    elapsedMs: number;
    status?: number;
    failure?: string;
    errorCode?: string;
  }[] = [];
  const isRelevant = (request: Request) => {
    const path = new URL(request.url()).pathname;
    return (
      path.startsWith("/api/v1/products") ||
      path === "/api/v1/auth/session" ||
      path.endsWith("/legal-entities")
    );
  };
  const safePath = (request: Request) =>
    new URL(request.url()).pathname.replace(
      /[0-9a-f]{8}-[0-9a-f-]{27}/gi,
      "<fixture-id>",
    );
  context.on("request", (request) => {
    if (isRelevant(request)) requestStarts.set(request, Date.now());
  });
  context.on("response", (response) => {
    const request = response.request();
    const startedAt = requestStarts.get(request);
    if (startedAt === undefined) return;
    requests.push({
      method: request.method(),
      path: safePath(request),
      status: response.status(),
      elapsedMs: Date.now() - startedAt,
    });
    requestStarts.delete(request);
  });
  context.on("requestfailed", (request) => {
    const startedAt = requestStarts.get(request);
    if (startedAt === undefined) return;
    requests.push({
      method: request.method(),
      path: safePath(request),
      failure: request.failure()?.errorText,
      elapsedMs: Date.now() - startedAt,
    });
    requestStarts.delete(request);
  });
  let fixtureOrganizationId: string | undefined;
  let journeyError: unknown;
  let cleanupFailure: unknown;
  try {
    const account = await fixtures.createVerified(
      context,
      "relationship-owner",
    );
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const organizationId = await onboardRunOrganization(
      page,
      account.email,
      `E2E Relationships ${testInfo.parallelIndex}-${Date.now()}`,
    );
    fixtures.trackOrganization(organizationId);
    fixtureOrganizationId = organizationId;

    const legalReadStarted = Date.now();
    const legalEntitiesResponse = await context.request.get(
      `${LIVE_API_ORIGIN}/api/v1/organizations/current/legal-entities`,
    );
    const legalReadEntry: {
      method: string;
      path: string;
      status: number;
      elapsedMs: number;
      errorCode?: string;
    } = {
      method: "GET",
      path: "/api/v1/organizations/current/legal-entities",
      status: legalEntitiesResponse.status(),
      elapsedMs: Date.now() - legalReadStarted,
    };
    if (!legalEntitiesResponse.ok()) {
      const errorBody: unknown = await legalEntitiesResponse.json();
      if (
        errorBody &&
        typeof errorBody === "object" &&
        "code" in errorBody &&
        typeof errorBody.code === "string"
      )
        legalReadEntry.errorCode = errorBody.code;
    }
    requests.push(legalReadEntry);
    expect(legalEntitiesResponse.status()).toBe(200);
    const legalEntity = (
      (await legalEntitiesResponse.json()) as LegalEntitiesResponse
    ).legalEntities[0];
    expect(legalEntity).toBeDefined();
    if (!legalEntity)
      throw new Error("Run-scoped organization has no legal entity");

    const baseProductId = await createProduct(context, {
      name: "E2E Relationship Base",
      internalCode: `BASE-${testInfo.parallelIndex}-${Date.now()}`,
      legalEntityId: legalEntity.id,
      responsibleOwnerId: account.publicUserId,
    });
    const variantProductId = await createProduct(context, {
      name: "E2E Relationship Variant",
      internalCode: `VARIANT-${testInfo.parallelIndex}-${Date.now()}`,
      legalEntityId: legalEntity.id,
      responsibleOwnerId: account.publicUserId,
    });
    const componentProductId = await createProduct(context, {
      name: "E2E Relationship Component",
      internalCode: `COMPONENT-${testInfo.parallelIndex}-${Date.now()}`,
      legalEntityId: legalEntity.id,
      responsibleOwnerId: account.publicUserId,
    });
    const baseReleaseId = await createRelease(
      context,
      baseProductId,
      "Base 1.0",
    );
    const variantReleaseId = await createRelease(
      context,
      variantProductId,
      "Variant 1.0",
    );

    await page.goto(`/products/${baseProductId}`);
    await expect(
      page.getByRole("heading", { name: "E2E Relationship Base", exact: true }),
    ).toBeVisible();
    await openRelationshipManager(page);
    await expect(
      page.getByRole("combobox", {
        name: "Relationship release",
        exact: true,
      }),
    ).toHaveValue(baseReleaseId);
    await page
      .getByLabel("Baseline identifier", { exact: true })
      .fill("e2e-runtime");
    await page.getByLabel("Baseline name", { exact: true }).fill("E2E runtime");
    await page
      .getByLabel("Baseline revision summary", { exact: true })
      .fill("Initial E2E runtime revision");
    await page
      .getByLabel("Relationship source", { exact: true })
      .fill("E2E architecture record");
    await page
      .getByLabel("Relationship provenance", { exact: true })
      .fill("E2E test fixture");
    await page
      .getByLabel("Relationship reason", { exact: true })
      .fill("E2E relationship verification");
    await page
      .getByLabel("Relationship effective start", { exact: true })
      .fill("2026-08-17T10:00");
    await page
      .getByRole("button", { name: "Record software baseline", exact: true })
      .click();
    await expect(
      page.getByText("Software baseline recorded and selected for membership."),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Record baseline membership", exact: true })
      .click();
    await expect(
      page.getByText("Software baseline membership recorded."),
    ).toBeVisible({ timeout: 30_000 });
    await captureRelationshipState(
      page,
      testInfo,
      "relationship-membership-recorded",
      page.getByText("Software baseline membership recorded."),
    );

    await page
      .getByLabel("Search variant product", { exact: true })
      .fill("E2E Relationship Variant");
    await page
      .getByLabel("Variant product", { exact: true })
      .selectOption(variantProductId);
    await page
      .getByLabel("Variant release", { exact: true })
      .selectOption(variantReleaseId);
    await page
      .getByRole("button", { name: "Record variant relationship", exact: true })
      .click();
    await expect(page.getByText("Variant relationship recorded.")).toBeVisible({
      timeout: 30_000,
    });
    await captureRelationshipState(
      page,
      testInfo,
      "relationship-variant-recorded",
      page.getByText("Variant relationship recorded."),
    );

    await page
      .getByLabel("Search component product", { exact: true })
      .fill("E2E Relationship Component");
    await page
      .getByLabel("Component product", { exact: true })
      .selectOption(componentProductId);
    await page
      .getByRole("button", { name: "Preview component link", exact: true })
      .click();
    await expect(page.getByText(/Preview: allowed/)).toBeVisible();
    const componentCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${baseProductId}/component-links` &&
        response.request().method() === "POST",
      { timeout: 15_000 },
    );
    process.stderr.write(
      `Component POST begins for fixture organization ${organizationId}, product ${baseProductId}\n`,
    );
    await page
      .getByRole("button", { name: "Record component link", exact: true })
      .click();
    const componentResponse = await componentCreated;
    expect(componentResponse.status()).toBe(201);
    const componentBody = productComponentLinkResponseSchema.parse(
      await componentResponse.json(),
    );
    expect(componentBody.relationship).toMatchObject({
      parentProductId: baseProductId,
      componentProductId,
    });
    await expect(page.getByText("Component link recorded.")).toBeVisible({
      timeout: 30_000,
    });
    await captureRelationshipState(
      page,
      testInfo,
      "relationship-component-recorded",
      page.getByText("Component link recorded."),
    );
    await page.reload();
    await openRelationshipOverview(page);
    await expect(
      page
        .getByRole("region", {
          name: "Relationship propagation events",
          exact: true,
        })
        .getByText(/^(scheduled|processing|completed)$/)
        .first(),
    ).toBeVisible();

    const graphLinks = page.getByRole("list", {
      name: "Relationship graph links",
      exact: true,
    });
    await expect(graphLinks).toContainText(baseProductId, { timeout: 30_000 });
    await expect(graphLinks).toContainText(componentProductId);
    await captureRelationshipState(
      page,
      testInfo,
      "relationship-fresh-graph",
      graphLinks,
    );

    await page.goto(`/products/${componentProductId}`);
    await openRelationshipManager(page);
    await page
      .getByLabel("Relationship source", { exact: true })
      .fill("E2E architecture record");
    await page
      .getByLabel("Relationship provenance", { exact: true })
      .fill("E2E test fixture");
    await page
      .getByLabel("Relationship reason", { exact: true })
      .fill("E2E cycle preview verification");
    await page
      .getByLabel("Relationship effective start", { exact: true })
      .fill("2026-08-17T10:00");
    await page
      .getByLabel("Search component product", { exact: true })
      .fill("E2E Relationship Base");
    await page
      .getByLabel("Component product", { exact: true })
      .selectOption(baseProductId);
    await page
      .getByRole("button", { name: "Preview component link", exact: true })
      .click();
    await expect(
      page.getByText("This link would create a cycle and was not recorded."),
    ).toBeVisible();
    await captureRelationshipState(
      page,
      testInfo,
      "relationship-cycle-rejected",
      page.getByText("This link would create a cycle and was not recorded."),
    );
  } catch (error) {
    journeyError = error;
    process.stderr.write(
      `Relationship journey failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
    const page = context.pages()[0];
    if (page && !page.isClosed()) {
      await page
        .screenshot({
          path: testInfo.outputPath("relationship-failure-desktop.png"),
          fullPage: false,
        })
        .catch(() => undefined);
    }
  } finally {
    const pendingAtJourneyEnd = [...requestStarts.entries()].map(
      ([request, startedAt]) => ({
        method: request.method(),
        path: safePath(request),
        elapsedMs: Date.now() - startedAt,
      }),
    );
    const [closed] = await Promise.allSettled([context.close()]);
    const timingsPath = testInfo.outputPath("sanitized-request-timings.json");
    await writeFile(
      timingsPath,
      JSON.stringify(
        {
          requests,
          pending: pendingAtJourneyEnd,
          fixtureOrganizationId,
        },
        null,
        2,
      ),
    );
    await testInfo.attach("sanitized-request-timings", {
      path: timingsPath,
      contentType: "application/json",
    });
    try {
      if (journeyError && process.env.E2E_RETAIN_FAILED_FIXTURES === "true") {
        process.stderr.write(
          `Retained exact failed fixture organization ${fixtureOrganizationId ?? "not-created"} for diagnosis.\n`,
        );
      } else {
        await fixtures.cleanup();
      }
    } catch (error) {
      cleanupFailure = error;
      await testInfo.attach("scoped-cleanup-failure", {
        body: String(error),
        contentType: "text/plain",
      });
    }
    if (!cleanupFailure && closed?.status === "rejected") {
      cleanupFailure = closed.reason;
    }
  }
  if (journeyError) throw journeyError;
  if (cleanupFailure) throw cleanupFailure;
});
