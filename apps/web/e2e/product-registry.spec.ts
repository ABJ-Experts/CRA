import { expect, test } from "@playwright/test";

import { RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright is outside Turbo. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

interface OrganizationResponse {
  readonly id: string;
}

interface ProductResponse {
  readonly product: { readonly id: string };
}

test("an organization owner creates a product and sees its empty release registry", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  try {
    const account = await fixtures.createVerified(context, "product-owner");
    const proxiedSession = await context.request.get(
      `${WEB_ORIGIN}/api/v1/auth/session`,
    );
    expect(proxiedSession.status()).toBe(200);
    const page = await context.newPage();
    await page.goto("/onboarding");
    const legalName = `E2E Product Registry ${testInfo.parallelIndex}-${Date.now()}`;
    await page
      .getByRole("textbox", { name: "Legal organization name", exact: true })
      .fill(legalName);
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
      .fill("100 Registry Street");
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
      .fill("Product Owner");
    await page
      .getByRole("textbox", { name: "Manufacturer contact email", exact: true })
      .fill(account.email);
    const organizationCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/organizations" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create organization", exact: true })
      .click();
    const created = await organizationCreated;
    expect(created.status()).toBe(201);
    fixtures.trackOrganization(
      ((await created.json()) as OrganizationResponse).id,
    );

    const productList = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/products" &&
        response.request().method() === "GET",
    );
    await page.goto("/products");
    expect((await productList).status()).toBe(200);

    await page
      .getByRole("button", { name: "Create product", exact: true })
      .click();
    await page
      .getByLabel("Product name", { exact: true })
      .fill("E2E Sentinel");
    await page
      .getByLabel("Internal code", { exact: true })
      .fill(`E2E-${Date.now()}`);
    await expect(
      page.getByLabel("Legal entity", { exact: true }),
    ).not.toHaveValue("");
    await expect(
      page.getByLabel("Responsible owner ID", { exact: true }),
    ).toHaveValue(account.publicUserId, { timeout: 5_000 });
    const productCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/products" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create product", exact: true })
      .click();
    const persisted = await productCreated;
    expect(persisted.status()).toBe(201);
    const productId = ((await persisted.json()) as ProductResponse).product.id;
    await expect(page).toHaveURL(`/products/${productId}`);
    await expect(
      page.getByRole("heading", { name: "E2E Sentinel", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("No releases have been added yet.", { exact: true }),
    ).toBeVisible();
  } finally {
    await context.close();
    await fixtures.cleanup();
  }
});
