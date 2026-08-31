import { randomUUID } from "node:crypto";

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
