import { expect, test, type Page } from "@playwright/test";

import { RunScopedAccounts, signIn } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

async function selectCountry(page: Page, label: string): Promise<void> {
  const trigger = page.getByRole("combobox", { name: label, exact: true });
  await trigger.click();
  const option = page.getByRole("option", {
    name: "United Kingdom",
    exact: true,
  });
  await option.click();
  await expect(trigger).toContainText("United Kingdom");
}

test("manufacturer creates a legal profile and resumes server onboarding", async ({
  browser,
}, testInfo) => {
  test.setTimeout(60_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({
    baseURL: WEB_ORIGIN,
  });

  try {
    const account = await fixtures.createVerified(context, "m1-onboarding");
    const proxiedSession = await context.request.get(
      `${WEB_ORIGIN}/api/v1/auth/session`,
    );
    expect(proxiedSession.status()).toBe(200);
    const page = await context.newPage();
    const legalName = `E2E Manufacturer ${testInfo.parallelIndex}-${Date.now()}`;
    const pageSession = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/auth/session" &&
        response.request().method() === "GET",
    );
    await page.goto("/dashboard");
    expect((await pageSession).status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard\/onboarding$/);
    await expect(
      page.getByRole("heading", {
        name: "Organization onboarding",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", {
        name: "Create your legal organization profile",
      }),
    ).toBeVisible();

    const legalNameInput = page.getByRole("textbox", {
      name: "Legal organization name",
      exact: true,
    });
    await legalNameInput.fill(legalName);
    await page.getByRole("button", { name: "Create organization" }).click();
    await expect(
      page.getByRole("combobox", {
        name: "Main establishment country",
        exact: true,
      }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("combobox", {
        name: "Registered address country",
        exact: true,
      }),
    ).toHaveAttribute("aria-invalid", "true");
    await expect(
      page.getByRole("textbox", {
        name: "Legal organization name",
        exact: true,
      }),
    ).toHaveValue(legalName);

    await selectCountry(page, "Main establishment country");
    await page
      .getByRole("textbox", {
        name: "Registered address line 1",
        exact: true,
      })
      .fill("100 Evidence Street");
    await page
      .getByRole("textbox", { name: "City or locality", exact: true })
      .fill("London");
    await page
      .getByRole("textbox", { name: "Postal code", exact: true })
      .fill("SW1A 1AA");
    await selectCountry(page, "Registered address country");
    await page
      .getByRole("textbox", {
        name: "Manufacturer contact name",
        exact: true,
      })
      .fill("M1 Test Contact");
    await page
      .getByRole("textbox", {
        name: "Manufacturer contact email",
        exact: true,
      })
      .fill(account.email);

    const createResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/v1/organizations" &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Create organization" }).click();
    const created = await createResponse;
    expect(created.status()).toBe(201);
    const organization = (await created.json()) as { id: string; name: string };
    fixtures.trackOrganization(organization.id);
    expect(organization.name).toBe(legalName);

    const progress = page.getByRole("list", { name: "Onboarding progress" });
    await expect(progress).toBeVisible();
    await expect(
      progress.getByText("Organization details", { exact: true }),
    ).toBeVisible();
    await expect(
      progress.getByText("First product", { exact: true }),
    ).toBeVisible();
    await expect(
      progress.getByText("First SBOM", { exact: true }),
    ).toBeVisible();
    await expect(progress.getByText("Blocked", { exact: true })).toHaveCount(4);

    const reloadOnboarding = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          "/api/v1/organizations/current/onboarding" &&
        response.request().method() === "GET",
    );
    await page.reload();
    expect((await reloadOnboarding).status()).toBe(200);
    await expect(page.getByText(legalName, { exact: true })).toBeVisible();
    await expect(
      page.getByRole("list", { name: "Onboarding progress" }),
    ).toBeVisible();

    const resumedContext = await browser.newContext({
      baseURL: WEB_ORIGIN,
    });
    try {
      const signInResponse = await signIn(
        resumedContext.request,
        account.email,
        account.password,
      );
      expect(signInResponse.status()).toBe(200);

      const resumedPage = await resumedContext.newPage();
      const resumedOnboarding = resumedPage.waitForResponse(
        (response) =>
          new URL(response.url()).pathname ===
            "/api/v1/organizations/current/onboarding" &&
          response.request().method() === "GET",
      );
      await resumedPage.goto("/dashboard/onboarding");
      expect((await resumedOnboarding).status()).toBe(200);
      await expect(
        resumedPage.getByText(legalName, { exact: true }),
      ).toBeVisible();
      await expect(
        resumedPage.getByRole("list", { name: "Onboarding progress" }),
      ).toBeVisible();
    } finally {
      await resumedContext.close();
    }
  } finally {
    await context.close();
    await fixtures.cleanup();
  }
});
