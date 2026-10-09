import { expect, test } from "@playwright/test";

import { LIVE_API_ORIGIN, RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

type CreatedOrganization = Readonly<{ id: string }>;
type LegalEntitiesResponse = Readonly<{
  legalEntities: readonly Readonly<{ identifier: string }>[];
}>;

test("a run-scoped owner dry-runs, reviews, and commits a product/release CSV", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  try {
    const account = await fixtures.createVerified(
      context,
      "product-import-owner",
    );
    const page = await context.newPage();
    await page.goto("/onboarding");
    await page
      .getByRole("textbox", { name: "Legal organization name", exact: true })
      .fill(`E2E Import ${testInfo.parallelIndex}-${Date.now()}`);
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
      .fill("100 Import Street");
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
      .fill("Import Owner");
    await page
      .getByRole("textbox", { name: "Manufacturer contact email", exact: true })
      .fill(account.email);
    const createdOrganization = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/organizations" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create organization", exact: true })
      .click();
    const organizationResponse = await createdOrganization;
    expect(organizationResponse.status()).toBe(201);
    fixtures.trackOrganization(
      ((await organizationResponse.json()) as CreatedOrganization).id,
    );

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

    const code = `E2E-IMPORT-${Date.now()}`;
    const csv = [
      "format_version,record_type,operation,product_internal_code,product_name,product_type,product_description,owner_email,legal_entity_identifier,release_version,release_label,release_description,expected_version",
      `m2-product-release-import-v1,product,create,${code},E2E Imported Product,standalone_software,,${account.email},${legalEntity.identifier},,,,`,
      `m2-product-release-import-v1,release,create,${code},,,,,,1.0.0,Initial release,,`,
      "",
    ].join("\n");

    await page.goto("/products");
    const template = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/products/imports/template" &&
        response.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Download template", exact: true })
      .click();
    expect((await template).status()).toBe(200);

    const invalidCsv = [
      "format_version,record_type,operation,product_internal_code,product_name,product_type,product_description,owner_email,legal_entity_identifier,release_version,release_label,release_description,expected_version",
      "m2-product-release-import-v1,product,create,E2E-INVALID,,,,,,,,,",
      "",
    ].join("\n");
    await page.getByLabel("Import CSV file", { exact: true }).setInputFiles({
      name: "invalid-product-release-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(invalidCsv),
    });
    const invalidDryRun = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/products/imports" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Validate CSV", exact: true })
      .click();
    expect((await invalidDryRun).status()).toBe(202);
    await expect(
      page.getByText("Dry run completed with errors", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    const blockingReport = page.waitForResponse(
      (response) =>
        /\/api\/v1\/products\/imports\/[^/]+\/report$/u.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Download result report", exact: true })
      .click();
    expect((await blockingReport).status()).toBe(200);

    await page.getByLabel("Import CSV file", { exact: true }).setInputFiles({
      name: "product-release-import.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    const dryRun = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/products/imports" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Validate CSV", exact: true })
      .click();
    expect((await dryRun).status()).toBe(202);
    await expect(
      page.getByText("Dry run completed", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      page.getByRole("button", {
        name: "Commit validated import",
        exact: true,
      }),
    ).toBeEnabled();

    const committed = page.waitForResponse(
      (response) =>
        /\/api\/v1\/products\/imports\/[^/]+\/commit$/u.test(
          new URL(response.url()).pathname,
        ) && response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Commit validated import", exact: true })
      .click();
    expect((await committed).status()).toBe(201);
    const activeImport = page
      .getByRole("heading", { name: "Row validation results", exact: true })
      .locator("xpath=../..");
    await expect(
      activeImport.getByText("Import completed", { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      activeImport.getByText(`${code.toLowerCase()} · 1.0.0`, {
        exact: true,
      }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(
      activeImport.getByText("committed", { exact: true }),
    ).toHaveCount(2);
    await expect(
      page
        .getByRole("list", { name: "Products", exact: true })
        .getByText(code, { exact: false }),
    ).toBeVisible({ timeout: 60_000 });
  } finally {
    await context.close();
    await fixtures.cleanup();
  }
});
