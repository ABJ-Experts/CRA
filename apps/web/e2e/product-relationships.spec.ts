import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

type CreatedOrganization = Readonly<{ id: string }>;
type LegalEntitiesResponse = Readonly<{
  legalEntities: readonly Readonly<{ id: string }>[];
}>;
type CreatedProduct = Readonly<{ product: Readonly<{ id: string }> }>;
type CreatedRelease = Readonly<{ release: Readonly<{ id: string }> }>;

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

  try {
    const account = await fixtures.createVerified(
      context,
      "relationship-owner",
    );
    const page = await context.newPage();
    const organizationId = await onboardRunOrganization(
      page,
      account.email,
      `E2E Relationships ${testInfo.parallelIndex}-${Date.now()}`,
    );
    fixtures.trackOrganization(organizationId);

    const legalEntitiesResponse = await context.request.get(
      `${LIVE_API_ORIGIN}/api/v1/organizations/current/legal-entities`,
    );
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
    ).toBeVisible();

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
    await expect(
      page.getByText("Variant relationship recorded."),
    ).toBeVisible();

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
    await page
      .getByRole("button", { name: "Record component link", exact: true })
      .click();
    await expect(page.getByText("Component link recorded.")).toBeVisible();
    await expect(
      page
        .getByRole("region", {
          name: "Relationship propagation events",
          exact: true,
        })
        .getByText("scheduled", { exact: true })
        .first(),
    ).toBeVisible();

    await page.goto(`/products/${componentProductId}`);
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
  } finally {
    await context.close();
    await fixtures.cleanup();
  }
});
