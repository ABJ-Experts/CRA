import { randomUUID } from "node:crypto";

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

test("an organization owner selects readable owners, records UTC lifecycle dates, and sees scoped support history", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  let journeyError: unknown;
  let cleanupFailure: unknown;
  try {
    const account = await fixtures.createVerified(context, "product-owner");
    const proxiedSession = await context.request.get(
      `${WEB_ORIGIN}/api/v1/auth/session`,
    );
    expect(proxiedSession.status()).toBe(200);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    await page.goto("/onboarding");
    const legalName = `E2E Product Registry ${testInfo.parallelIndex}-${Date.now()}`;
    await page
      .getByRole("textbox", { name: "Legal organization name", exact: true })
      .fill(legalName);
    const establishmentCountry = page.getByRole("combobox", {
      name: "Main establishment country",
      exact: true,
    });
    await establishmentCountry.press("Space");
    await page.keyboard.type("United Kingdom");
    await page.keyboard.press("Enter");
    await expect(establishmentCountry).toContainText("United Kingdom");
    await page
      .getByRole("textbox", { name: "Registered address line 1", exact: true })
      .fill("100 Registry Street");
    await page
      .getByRole("textbox", { name: "City or locality", exact: true })
      .fill("London");
    await page
      .getByRole("textbox", { name: "Postal code", exact: true })
      .fill("SW1A 1AA");
    const addressCountry = page.getByRole("combobox", {
      name: "Registered address country",
      exact: true,
    });
    await addressCountry.press("Space");
    await page.keyboard.type("United Kingdom");
    await page.keyboard.press("Enter");
    await expect(addressCountry).toContainText("United Kingdom");
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
    fixtures.trackM2V2Organization(
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
    await page.getByLabel("Product name", { exact: true }).fill("E2E Sentinel");
    await page
      .getByLabel("Internal code", { exact: true })
      .fill(`E2E-${Date.now()}`);
    await expect(
      page.getByLabel("Legal entity", { exact: true }),
    ).not.toHaveValue("");
    await expect(
      page.getByRole("combobox", { name: "Responsible owner", exact: true }),
    ).toHaveValue(account.publicUserId, { timeout: 5_000 });
    const owner = page.getByRole("combobox", {
      name: "Responsible owner",
      exact: true,
    });
    await expect(owner.locator("option:checked")).not.toHaveText(
      account.publicUserId,
    );
    await expect(owner.locator("option:checked")).not.toHaveText("");
    await page.screenshot({
      path: testInfo.outputPath("owner-create-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("owner-create-mobile.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    const legalEntityId = await page
      .getByLabel("Legal entity", { exact: true })
      .inputValue();
    const foreignContext = await browser.newContext({ baseURL: WEB_ORIGIN });
    let foreignOwnerId: string;
    try {
      foreignOwnerId = (
        await fixtures.createVerified(foreignContext, "foreign-product-owner")
      ).publicUserId;
    } finally {
      await foreignContext.close();
    }
    const ownerOptions = await context.request.get(
      `${WEB_ORIGIN}/api/v1/products/owner-options?selectedOwnerId=${foreignOwnerId}`,
    );
    expect(ownerOptions.status()).toBe(200);
    const ownerOptionsBody = (await ownerOptions.json()) as {
      selectedOwner: unknown;
      owners: { rows: Record<string, unknown>[] };
    };
    expect(ownerOptionsBody.selectedOwner).toBeNull();
    for (const option of ownerOptionsBody.owners.rows) {
      expect(Object.keys(option).sort()).toEqual(["displayName", "id"]);
    }
    expect(
      (
        await context.request.get(
          `${WEB_ORIGIN}/api/v1/products/owner-options?organizationId=${randomUUID()}`,
        )
      ).status(),
    ).toBe(400);
    let firstProductKey: string | undefined;
    let loseProductResponse = true;
    await page.route("**/api/v1/products", async (route) => {
      if (route.request().method() !== "POST" || !loseProductResponse) {
        await route.continue();
        return;
      }
      loseProductResponse = false;
      firstProductKey = (
        route.request().postDataJSON() as { idempotencyKey: string }
      ).idempotencyKey;
      const response = await route.fetch();
      expect(response.status()).toBe(201);
      await route.abort("failed");
    });
    await page
      .getByRole("button", { name: "Create product", exact: true })
      .click();
    await expect.poll(() => firstProductKey).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Create product", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("Product name", { exact: true })).toHaveValue(
      "E2E Sentinel",
    );
    await page.screenshot({
      path: testInfo.outputPath("product-retry-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("product-retry-mobile.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
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
    expect(persisted.request().postDataJSON()).toMatchObject({
      idempotencyKey: firstProductKey,
    });
    await page.unroute("**/api/v1/products");
    const productId = ((await persisted.json()) as ProductResponse).product.id;
    const persistedProducts = await context.request.get(
      `${WEB_ORIGIN}/api/v1/products?q=E2E%20Sentinel`,
    );
    expect(persistedProducts.status()).toBe(200);
    expect(
      (
        (await persistedProducts.json()) as {
          products: { rows: { id: string }[] };
        }
      ).products.rows.map((item) => item.id),
    ).toEqual([productId]);
    await expect(page).toHaveURL(`/products/${productId}`);
    await expect(
      page.getByRole("heading", { name: "E2E Sentinel", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Product workbench", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Edit product", exact: true })
      .click();
    await page.getByRole("tab", { name: "Ownership", exact: true }).click();
    await expect(
      page.getByRole("combobox", { name: "Responsible owner", exact: true }),
    ).toHaveValue(account.publicUserId);
    await page.screenshot({
      path: testInfo.outputPath("owner-edit-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("owner-edit-mobile.png"),
      fullPage: false,
    });
    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 1280, height: 900 });

    await page
      .getByRole("button", { name: "Releases and compliance", exact: true })
      .click();
    await page.getByLabel("Release label", { exact: true }).fill("UTC release");
    await page.getByLabel("Version", { exact: true }).fill("1.0.0");
    let firstReleaseKey: string | undefined;
    let loseReleaseResponse = true;
    await page.route(
      `**/api/v1/products/${productId}/releases`,
      async (route) => {
        if (route.request().method() !== "POST" || !loseReleaseResponse) {
          await route.continue();
          return;
        }
        loseReleaseResponse = false;
        firstReleaseKey = (
          route.request().postDataJSON() as { idempotencyKey: string }
        ).idempotencyKey;
        const response = await route.fetch();
        expect(response.status()).toBe(201);
        await route.abort("failed");
      },
    );
    await page
      .getByRole("button", { name: "Add release", exact: true })
      .click();
    await expect.poll(() => firstReleaseKey).toBeTruthy();
    await expect(
      page.getByRole("button", { name: "Add release", exact: true }),
    ).toBeEnabled();
    await expect(page.getByLabel("Release label", { exact: true })).toHaveValue(
      "UTC release",
    );
    await page.screenshot({
      path: testInfo.outputPath("release-retry-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({
      path: testInfo.outputPath("release-retry-mobile.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    const releaseCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/releases` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Add release", exact: true })
      .click();
    const releaseResponse = await releaseCreated;
    expect(releaseResponse.status()).toBe(201);
    expect(releaseResponse.request().postDataJSON()).toMatchObject({
      idempotencyKey: firstReleaseKey,
    });
    const releaseId = (
      (await releaseResponse.json()) as { release: { id: string } }
    ).release.id;
    await page.unroute(`**/api/v1/products/${productId}/releases`);
    await page.keyboard.press("Escape");
    const otherReleaseResponse = await context.request.post(
      `${WEB_ORIGIN}/api/v1/products/${productId}/releases`,
      {
        data: {
          label: "Other release",
          version: "2.0.0",
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(otherReleaseResponse.status()).toBe(201);
    const otherReleaseId = (
      (await otherReleaseResponse.json()) as { release: { id: string } }
    ).release.id;
    const persistedReleases = await context.request.get(
      `${WEB_ORIGIN}/api/v1/products/${productId}/releases`,
    );
    expect(persistedReleases.status()).toBe(200);
    expect(
      (
        (await persistedReleases.json()) as {
          releases: { rows: { id: string }[] };
        }
      ).releases.rows
        .map((item) => item.id)
        .sort(),
    ).toEqual([releaseId, otherReleaseId].sort());
    const market = await context.request.post(
      `${WEB_ORIGIN}/api/v1/products/${productId}/releases/${releaseId}/market-availability`,
      {
        data: { countryCode: "DE", expectedVersion: 0 },
      },
    );
    expect(market.status()).toBe(201);
    await page.reload();
    await page
      .getByRole("button", { name: "Releases and compliance", exact: true })
      .click();
    await page.getByRole("tab", { name: "Lifecycle", exact: true }).click();
    const workspace = page.getByRole("listitem", {
      name: "Release workspace for UTC release",
      exact: true,
    });
    const placement = workspace.getByLabel("Placed on market at (UTC)", {
      exact: true,
    });
    await expect(placement).toHaveAttribute("type", "datetime-local");
    const placementInstant = new Date().toISOString();
    await placement.fill(placementInstant.slice(0, -1));
    await placement.scrollIntoViewIfNeeded();
    await expect(placement).toHaveValue(placementInstant.slice(0, -1));
    await page.screenshot({
      path: testInfo.outputPath("utc-placement-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await placement.scrollIntoViewIfNeeded();
    await expect(placement).toHaveValue(placementInstant.slice(0, -1));
    await page.screenshot({
      path: testInfo.outputPath("utc-placement-mobile.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    const transition = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          `/${releaseId}/lifecycle-transitions`,
        ) && response.request().method() === "POST",
    );
    await workspace
      .getByRole("button", { name: "Transition lifecycle", exact: true })
      .click();
    const transitioned = await transition;
    expect(transitioned.status()).toBe(201);
    expect(transitioned.request().postDataJSON()).toMatchObject({
      placedOnMarketAt: placementInstant,
    });
    await workspace
      .getByText("Correct placed-on-market date", { exact: true })
      .click();
    const correction = workspace.getByLabel("Corrected UTC timestamp", {
      exact: true,
    });
    await expect(correction).toHaveAttribute("type", "datetime-local");
    const correctionInstant = new Date(
      Date.parse(placementInstant) + 1,
    ).toISOString();
    await correction.fill(correctionInstant.slice(0, -1));
    await workspace
      .getByLabel("Correction reason", { exact: true })
      .fill("Run-scoped clock correction");
    await correction.scrollIntoViewIfNeeded();
    await expect(correction).toHaveValue(correctionInstant.slice(0, -1));
    await page.screenshot({
      path: testInfo.outputPath("utc-correction-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await correction.scrollIntoViewIfNeeded();
    await expect(correction).toHaveValue(correctionInstant.slice(0, -1));
    await page.screenshot({
      path: testInfo.outputPath("utc-correction-mobile.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 1280, height: 900 });
    const corrected = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname.endsWith(
          `/${releaseId}/placed-on-market-date-corrections`,
        ) && response.request().method() === "POST",
    );
    await workspace
      .getByRole("button", { name: "Correct date", exact: true })
      .click();
    const correctionResult = await corrected;
    expect(correctionResult.status()).toBe(201);
    expect(correctionResult.request().postDataJSON()).toMatchObject({
      correctedPlacedOnMarketAt: correctionInstant,
    });

    for (const scope of [undefined, releaseId, otherReleaseId]) {
      const support = await context.request.post(
        `${WEB_ORIGIN}/api/v1/products/${productId}/support-periods`,
        {
          data: {
            ...(scope ? { releaseId: scope } : {}),
            supportStartsAt: "2026-09-20T00:00:00.000Z",
            supportEndsAt: "2031-09-20T00:00:00.000Z",
            expectedLifetimeJustification:
              "Run-scoped declared product lifetime",
            idempotencyKey: randomUUID(),
          },
        },
      );
      expect(support.status()).toBe(201);
    }
    const supportHistory = await context.request.get(
      `${WEB_ORIGIN}/api/v1/products/${productId}/support-periods?releaseId=${releaseId}`,
    );
    expect(supportHistory.status()).toBe(200);
    const historyBody = (await supportHistory.json()) as {
      supportPeriods: { releaseId: string | null }[];
    };
    expect(
      historyBody.supportPeriods.map((item) => item.releaseId).sort(),
    ).toEqual([null, releaseId].sort());
    const wrongProduct = await context.request.post(
      `${WEB_ORIGIN}/api/v1/products`,
      {
        data: {
          name: "Scope mismatch",
          internalCode: `SCOPE-${Date.now()}`,
          productType: "component",
          legalEntityId,
          responsibleOwnerId: account.publicUserId,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(wrongProduct.status()).toBe(201);
    const wrongProductId = ((await wrongProduct.json()) as ProductResponse)
      .product.id;
    expect(
      (
        await context.request.get(
          `${WEB_ORIGIN}/api/v1/products/${wrongProductId}/support-periods?releaseId=${releaseId}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await context.request.get(
          `${WEB_ORIGIN}/api/v1/products/${productId}/support-periods?releaseId=${randomUUID()}`,
        )
      ).status(),
    ).toBe(404);
    expect(
      (
        await context.request.get(
          `${WEB_ORIGIN}/api/v1/products/${productId}/support-periods?organizationId=${randomUUID()}`,
        )
      ).status(),
    ).toBe(400);
    await page
      .getByRole("tab", { name: "Support and retention", exact: true })
      .click();
    await expect(
      workspace.getByRole("region", {
        name: "Support and retention for UTC release",
        exact: true,
      }),
    ).toBeVisible();
    const supportSection = workspace.getByRole("region", {
      name: "Support and retention for UTC release",
      exact: true,
    });
    await expect(
      supportSection.getByText("Support period active", { exact: true }),
    ).toBeVisible();
    await expect(
      supportSection
        .getByRole("list", { name: "Support period history", exact: true })
        .getByRole("listitem"),
    ).toHaveCount(2);
    await expect(
      supportSection.getByText("Legal retention outcome", { exact: true }),
    ).toBeVisible();
    await expect(
      supportSection.getByText(/Loading support|Loading retention/),
    ).toHaveCount(0);
    await supportSection.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("support-scope-desktop.png"),
      fullPage: false,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await supportSection.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("support-scope-mobile.png"),
      fullPage: false,
    });
  } catch (error) {
    journeyError = error;
    process.stderr.write(
      `Product journey failed: ${error instanceof Error ? error.stack : String(error)}\n`,
    );
  } finally {
    const [closed] = await Promise.allSettled([context.close()]);
    try {
      await fixtures.cleanup();
    } catch (error) {
      cleanupFailure = error;
      await testInfo.attach("scoped-cleanup-failure", {
        body: String(error),
        contentType: "text/plain",
      });
    }
    if (!cleanupFailure && closed?.status === "rejected")
      cleanupFailure = closed.reason;
  }
  if (journeyError) throw journeyError;
  if (cleanupFailure) throw cleanupFailure;
});
