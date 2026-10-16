import { randomUUID } from "node:crypto";

import { expect, test, type Page } from "@playwright/test";

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
    title: string;
    versions: Array<{ versionKey: string }>;
    selection: Selection;
  }>;
};

type CustomList = {
  items: Array<{
    draftId: string;
    packKey: string;
    title: string;
    revision: number;
    latestVersionKey: string | null;
  }>;
};

type Tree = {
  requirements: Array<{ text: string }>;
};

async function customDraft(page: Page, title: string) {
  const response = await page.request.get(
    "/api/v1/frameworks/custom?limit=20&offset=0",
  );
  expect(response.ok()).toBe(true);
  const list = (await response.json()) as CustomList;
  const draft = list.items.find((item) => item.title === title);
  expect(draft, `Run-scoped custom draft ${title} must exist`).toBeTruthy();
  return draft!;
}

async function catalogPack(page: Page, packKey: string) {
  const response = await page.request.get("/api/v1/frameworks");
  expect(response.ok()).toBe(true);
  const catalog = (await response.json()) as Catalog;
  const pack = catalog.packs.find((candidate) => candidate.packKey === packKey);
  expect(pack, `Custom pack ${packKey} must exist in catalog`).toBeTruthy();
  return pack!;
}

async function expectTreeContains(
  page: Page,
  packKey: string,
  versionKey: string,
  text: string,
) {
  const treeResponse = await page.request.get(
    `/api/v1/frameworks/${encodeURIComponent(packKey)}/versions/${encodeURIComponent(versionKey)}/tree?limit=100`,
  );
  expect(treeResponse.ok()).toBe(true);
  const tree = (await treeResponse.json()) as Tree;
  expect(
    tree.requirements.some((requirement) => requirement.text === text),
  ).toBe(true);
}

async function expectNoHorizontalOverflow(page: Page) {
  const metrics = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const documentWidth = document.documentElement.scrollWidth;
    const bodyWidth = document.body.scrollWidth;
    const offenders = Array.from(
      document.body.querySelectorAll<HTMLElement>("*"),
    )
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          role: element.getAttribute("role"),
          aria: element.getAttribute("aria-label"),
          text: (element.textContent ?? "")
            .trim()
            .replace(/\s+/g, " ")
            .slice(0, 120),
          className:
            typeof element.className === "string" ? element.className : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
        };
      })
      .filter(
        (entry) =>
          entry.right > viewportWidth + 1 ||
          entry.width > viewportWidth + 1 ||
          entry.scrollWidth > entry.clientWidth + 1,
      )
      .sort((first, second) => second.scrollWidth - first.scrollWidth)
      .slice(0, 8);
    return { viewportWidth, documentWidth, bodyWidth, offenders };
  });
  expect(metrics, JSON.stringify(metrics, null, 2)).toEqual(
    expect.objectContaining({
      documentWidth: expect.any(Number),
      viewportWidth: expect.any(Number),
    }),
  );
  expect(
    metrics.documentWidth,
    JSON.stringify(metrics, null, 2),
  ).toBeLessThanOrEqual(metrics.viewportWidth);
}

test("owner imports, publishes, selects, migrates, and exports a run-scoped custom framework", async ({
  page,
}, testInfo) => {
  test.setTimeout(180_000);
  const origin = new URL(
    testInfo.project.use.baseURL ?? "http://localhost:3100",
  );
  test.skip(
    !["localhost", "127.0.0.1"].includes(origin.hostname),
    "This journey only changes the local development stack.",
  );

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
      legalName: `M10 Custom E2E ${randomUUID()}`,
      registeredAddress: {
        addressLine1: "100 Custom Street",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      manufacturerContactName: "Custom Framework Test Owner",
      manufacturerContactEmail: ownerEmail,
    },
  });
  expect(created.status()).toBe(201);
  const organization = (await created.json()) as { id: string };
  fixtures.trackOrganization(organization.id);

  try {
    const runLabel = `M10 Custom ${randomUUID().slice(0, 8)}`;
    const v1Requirement = "Maintain a run-scoped operational control record.";
    const v2Requirement = "Maintain a version-two operational control record.";

    await page.goto("/frameworks");
    await page
      .getByRole("button", { name: "Manage custom frameworks" })
      .click();
    await expect(
      page.getByRole("heading", { name: "Custom frameworks" }),
    ).toBeVisible();

    await page
      .getByRole("textbox", { name: "Title", exact: true })
      .fill(runLabel);
    await page
      .getByRole("textbox", { name: "Requirement 1 text", exact: true })
      .fill(v1Requirement);
    const createResponse = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/v1/frameworks/custom") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save imported draft" }).click();
    expect((await createResponse).ok()).toBe(true);

    const savedV1Draft = await customDraft(page, runLabel);
    const publishV1Response = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/frameworks/custom/${savedV1Draft.draftId}`) &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Publish version" }).click();
    expect((await publishV1Response).ok()).toBe(true);
    await expect(
      page.getByRole("radio", { name: /Published version/i }),
    ).toBeEnabled();

    const v1Draft = await customDraft(page, runLabel);
    expect(v1Draft.latestVersionKey).not.toBeNull();
    const v1 = v1Draft.latestVersionKey!;

    const selectV1 = await page.request.put(
      `/api/v1/frameworks/${encodeURIComponent(v1Draft.packKey)}/selection`,
      {
        data: {
          versionKey: v1,
          enabled: true,
          expectedRevision: null,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(selectV1.status()).toBe(200);
    const selectedV1 = await catalogPack(page, v1Draft.packKey);
    expect(selectedV1.selection?.versionKey).toBe(v1);
    await expectTreeContains(page, v1Draft.packKey, v1, v1Requirement);

    await page
      .getByRole("textbox", { name: "Requirement 1 text", exact: true })
      .fill(v2Requirement);
    await expect(
      page.getByRole("button", { name: "Publish version" }),
    ).toBeDisabled();
    const saveV2Response = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/frameworks/custom/${v1Draft.draftId}`) &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Save draft" }).click();
    expect((await saveV2Response).ok()).toBe(true);
    await expect(
      page.getByRole("button", { name: "Publish version" }),
    ).toBeEnabled();
    const savedV2Draft = await customDraft(page, runLabel);
    const publishV2Response = page.waitForResponse(
      (response) =>
        response
          .url()
          .endsWith(`/api/v1/frameworks/custom/${savedV2Draft.draftId}`) &&
        response.request().method() === "PUT",
    );
    await page.getByRole("button", { name: "Publish version" }).click();
    expect((await publishV2Response).ok()).toBe(true);

    const v2Draft = await customDraft(page, runLabel);
    expect(v2Draft.latestVersionKey).not.toBeNull();
    const v2 = v2Draft.latestVersionKey!;
    expect(v2).not.toBe(v1);

    const afterV2 = await catalogPack(page, v1Draft.packKey);
    expect(afterV2.selection?.versionKey).toBe(v1);
    await expectTreeContains(page, v1Draft.packKey, v1, v1Requirement);

    const upgradeRequired = await page.request.put(
      `/api/v1/frameworks/${encodeURIComponent(v1Draft.packKey)}/selection`,
      {
        data: {
          versionKey: v2,
          enabled: true,
          expectedRevision: afterV2.selection?.revision ?? null,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(upgradeRequired.status()).toBe(409);
    expect(await upgradeRequired.text()).toMatch(/upgrade_required/);

    await page.getByRole("radio", { name: /Published version/i }).check();
    await page.getByRole("button", { name: "Prepare export" }).click();
    await expect(page.getByRole("status")).toContainText(/export prepared/i);
    await expect(
      page.getByRole("textbox", { name: "Export JSON", exact: true }),
    ).toContainText(runLabel);
    await expect(
      page.getByRole("link", { name: "Download JSON" }),
    ).toBeVisible();

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.screenshot({
      path: testInfo.outputPath("m10-custom-frameworks-desktop.png"),
      fullPage: true,
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({
      path: testInfo.outputPath("m10-custom-frameworks-mobile.png"),
      fullPage: true,
      scale: "css",
    });

    if (originalOrganizationId) {
      const switchedBack = await page.request.post(
        "/api/v1/organizations/switch",
        { data: { organizationId: originalOrganizationId } },
      );
      expect(switchedBack.ok()).toBe(true);
      const restoredCatalogResponse =
        await page.request.get("/api/v1/frameworks");
      expect(restoredCatalogResponse.ok()).toBe(true);
      expect(await restoredCatalogResponse.json()).toEqual(originalCatalog);
    }
  } finally {
    if (originalOrganizationId) {
      await page.request.post("/api/v1/organizations/switch", {
        data: { organizationId: originalOrganizationId },
      });
    }
    await fixtures.cleanup();
  }
});
