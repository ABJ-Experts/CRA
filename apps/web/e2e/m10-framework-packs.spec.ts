import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import { expect, test } from "@playwright/test";

import { RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live browser run is opt-in. */

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !ownerEmail || !ownerPassword,
  "Local owner credentials are required.",
);

type Selection = {
  versionKey: string;
  enabled: boolean;
  revision: number;
} | null;
type Catalog = {
  packs: Array<{
    packKey: string;
    versions: Array<{ versionKey: string }>;
    selection: Selection;
  }>;
};

test("owner selects, reads, disables, and checks conflicts in a run-scoped organization", async ({
  page,
}, testInfo) => {
  const origin = new URL(
    testInfo.project.use.baseURL ?? "http://localhost:3000",
  );
  test.skip(
    !["localhost", "127.0.0.1"].includes(origin.hostname),
    "This journey only changes the local development stack.",
  );
  const screenshotDirectory = process.env.M10_SCREENSHOT_DIR
    ? resolve(process.env.M10_SCREENSHOT_DIR)
    : null;
  if (screenshotDirectory)
    await mkdir(screenshotDirectory, { recursive: true });
  const screenshotPath = (name: string) =>
    screenshotDirectory
      ? join(screenshotDirectory, name)
      : testInfo.outputPath(name);

  const signIn = await page.request.post("/api/v1/auth/sign-in", {
    data: { email: ownerEmail, password: ownerPassword, remember: true },
  });
  expect(signIn.status()).toBe(200);
  const ownerSessionResponse = await page.request.get("/api/v1/auth/session");
  expect(ownerSessionResponse.ok()).toBe(true);
  const originalOrganizationId = (
    (await ownerSessionResponse.json()) as {
      organization: { id: string } | null;
    }
  ).organization?.id;
  const originalCatalogResponse = await page.request.get("/api/v1/frameworks");
  expect(originalCatalogResponse.ok()).toBe(true);
  const originalCatalog = (await originalCatalogResponse.json()) as Catalog;

  const fixtures = new RunScopedAccounts(testInfo);
  const created = await page.request.post("/api/v1/organizations", {
    data: {
      idempotencyKey: randomUUID(),
      legalName: `M10 Framework E2E ${randomUUID()}`,
      registeredAddress: {
        addressLine1: "100 Evidence Street",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      manufacturerContactName: "Framework Test Owner",
      manufacturerContactEmail: ownerEmail,
    },
  });
  expect(created.status()).toBe(201);
  const organization = (await created.json()) as { id: string };
  fixtures.trackOrganization(organization.id);

  try {
    const before = await page.request.get("/api/v1/frameworks");
    expect(before.ok()).toBe(true);
    const catalog = (await before.json()) as Catalog;
    const pack = catalog.packs.find(
      (candidate) => candidate.packKey === "cra-annex-i",
    );
    expect(
      pack?.versions.length,
      "Reviewed CRA pack must be present",
    ).toBeGreaterThan(0);
    expect(
      pack?.selection,
      "A new organization begins without a framework selection",
    ).toBeNull();
    const versionKey = pack!.versions[0]!.versionKey;

    await page.goto("/frameworks");
    await expect(
      page.getByRole("heading", { name: "Frameworks" }),
    ).toBeVisible();
    await expect(
      page.getByText(/No edition selected for this organization/i),
    ).toBeVisible();
    await expect(
      page.getByRole("tree", { name: "Framework requirements" }),
    ).toBeVisible();

    async function setSelection(
      enabled: boolean,
    ): Promise<NonNullable<Selection>> {
      await page
        .getByRole("combobox", { name: "Edition" })
        .selectOption(versionKey);
      const checkbox = page.getByRole("checkbox", {
        name: /show this edition/i,
      });
      if ((await checkbox.isChecked()) !== enabled) await checkbox.click();
      const saveResponse = page.waitForResponse(
        (response) =>
          response
            .url()
            .endsWith(`/api/v1/frameworks/${pack!.packKey}/selection`) &&
          response.request().method() === "PUT",
      );
      await page.getByRole("button", { name: "Save selection" }).click();
      expect((await saveResponse).ok()).toBe(true);
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "Framework selection saved." }),
      ).toBeVisible();
      const response = await page.request.get("/api/v1/frameworks");
      expect(response.ok()).toBe(true);
      const current = (await response.json()) as Catalog;
      return current.packs.find(
        (candidate) => candidate.packKey === pack!.packKey,
      )!.selection!;
    }

    const selected = await setSelection(true);
    expect(selected.versionKey).toBe(versionKey);
    expect(selected.enabled).toBe(true);
    await expect(
      page.getByRole("tree", { name: "Framework requirements" }),
    ).toBeVisible();
    await expect(page.getByRole("treeitem").first()).toBeVisible();
    await page.screenshot({
      path: screenshotPath("m10-framework-tree.png"),
      fullPage: true,
    });

    const treeItem = page.getByRole("treeitem").first();
    await treeItem.focus();
    await page.keyboard.press("ArrowRight");
    await expect(treeItem).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(treeItem).toHaveAttribute("aria-expanded", "false");

    if (originalOrganizationId) {
      const switchedBack = await page.request.post(
        "/api/v1/organizations/switch",
        { data: { organizationId: originalOrganizationId } },
      );
      expect(switchedBack.ok()).toBe(true);
      const priorTenantCatalog = await page.request.get("/api/v1/frameworks");
      expect(priorTenantCatalog.ok()).toBe(true);
      expect(await priorTenantCatalog.json()).toEqual(originalCatalog);
      await page.goto("/frameworks");
      await expect(
        page.getByRole("heading", { name: "Frameworks" }),
      ).toBeVisible();
      const switchedToFixture = await page.request.post(
        "/api/v1/organizations/switch",
        { data: { organizationId: organization.id } },
      );
      expect(switchedToFixture.ok()).toBe(true);
      await page.goto("/frameworks");
    }

    const stale = await page.request.put(
      `/api/v1/frameworks/${pack!.packKey}/selection`,
      {
        data: {
          versionKey,
          enabled: false,
          expectedRevision: null,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(stale.status()).toBe(409);

    const disabled = await setSelection(false);
    expect(disabled.enabled).toBe(false);
    await expect(
      page.getByText(/not currently enabled in the workspace/i),
    ).toBeVisible();
    await page.screenshot({
      path: screenshotPath("m10-framework-disabled.png"),
      fullPage: true,
    });
  } finally {
    await fixtures.cleanup();
  }
});
