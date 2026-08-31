import { randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  LIVE_API_ORIGIN,
  RunScopedAccounts,
  type TestAccount,
} from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const PRIMARY = "#1357d8";
const SECONDARY = "#c95a11";

interface OrganizationResponse {
  readonly id: string;
  readonly name: string;
}

function responsePath(response: { url(): string }): string {
  return new URL(response.url()).pathname;
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
        manufacturerContactName: "Organization Branding Owner",
        manufacturerContactEmail: account.email,
      },
    },
  );
  expect(response.status()).toBe(201);

  const organization = (await response.json()) as OrganizationResponse;
  fixtures.trackOrganization(organization.id);
  return organization;
}

async function waitForAdministration(page: Page): Promise<void> {
  const branding = page.waitForResponse(
    (response) =>
      responsePath(response) === "/api/v1/organizations/current/branding" &&
      response.request().method() === "GET",
  );
  const preview = page.waitForResponse(
    (response) =>
      responsePath(response) ===
        "/api/v1/organizations/current/branding/preview" &&
      response.request().method() === "GET",
  );

  await page.goto("/organization");
  expect((await branding).status()).toBe(200);
  expect((await preview).status()).toBe(200);
  await expect(
    page.getByRole("heading", {
      name: "Organization administration",
      exact: true,
    }),
  ).toBeVisible();
}

test("saving a branding draft leaves the dashboard neutral until publication", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  try {
    const account = await fixtures.createVerified(
      context,
      "organization-branding-owner",
    );
    const legalName = `E2E Organization Branding ${testInfo.parallelIndex}-${Date.now()}`;
    await createOrganization(context, fixtures, account, legalName);

    const page = await context.newPage();
    await waitForAdministration(page);

    const dashboardTheme = page.locator("[data-organization-theme]");
    const sidebarBrand = page.getByRole("link", {
      name: "CRA Sentinel",
      exact: true,
    });
    await expect(dashboardTheme).toHaveCount(0);
    await expect(sidebarBrand).toBeVisible();

    const displayName = `Published Brand ${testInfo.parallelIndex}`;
    const footerText = `Published footer ${testInfo.parallelIndex}`;
    await page
      .getByRole("textbox", { name: "Brand display name", exact: true })
      .fill(displayName);
    await page
      .getByRole("textbox", { name: "Primary brand color", exact: true })
      .fill(PRIMARY);
    await page
      .getByRole("textbox", { name: "Secondary brand color", exact: true })
      .fill(SECONDARY);
    await page
      .getByRole("textbox", { name: "Footer text", exact: true })
      .fill(footerText);

    const saved = page.waitForResponse(
      (response) =>
        responsePath(response) === "/api/v1/organizations/current/branding" &&
        response.request().method() === "PATCH",
    );
    await page
      .getByRole("button", { name: "Save branding draft", exact: true })
      .click();
    expect((await saved).status()).toBe(200);
    await expect(
      page.getByText("Branding draft saved.", { exact: true }),
    ).toBeVisible();

    await expect(dashboardTheme).toHaveCount(0);
    await expect(sidebarBrand).toBeVisible();

    const published = page.waitForResponse(
      (response) =>
        responsePath(response) ===
          "/api/v1/organizations/current/branding/publish" &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Publish branding", exact: true })
      .click();
    expect((await published).status()).toBe(201);

    await expect(dashboardTheme).toHaveAttribute(
      "data-organization-theme",
      "published",
    );
    await expect(dashboardTheme).toHaveCSS(
      "--organization-brand-primary",
      PRIMARY.toUpperCase(),
    );
    await expect(dashboardTheme).toHaveCSS(
      "--organization-brand-secondary",
      SECONDARY.toUpperCase(),
    );
    await expect(
      page.getByRole("button", { name: "Save branding draft", exact: true }),
    ).toHaveCSS("background-color", "rgb(19, 87, 216)");
    const publishedSidebarBrand = page.getByRole("link", {
      name: displayName,
      exact: true,
    });
    await expect(publishedSidebarBrand).toBeVisible();
    await expect(
      publishedSidebarBrand.locator('span[aria-hidden="true"]'),
    ).toHaveText(displayName[0]!);
    await expect(
      page.getByRole("complementary").getByText(footerText, { exact: true }),
    ).toBeVisible();

    const signedOut = page.waitForResponse(
      (response) =>
        responsePath(response) === "/api/v1/auth/sign-out" &&
        response.request().method() === "POST",
    );
    const signInPage = page.waitForURL(/\/sign-in$/);
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    expect((await signedOut).status()).toBe(200);
    await signInPage;

    await expect(page.getByTestId("sign-in-form")).toBeVisible();
    await expect(dashboardTheme).toHaveCount(0);
    await expect(page.getByText(displayName, { exact: true })).toHaveCount(0);
  } finally {
    await context.close();
    await fixtures.cleanup();
  }
});
