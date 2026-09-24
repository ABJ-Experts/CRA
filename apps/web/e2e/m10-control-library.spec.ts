import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live browser run is opt-in. */

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;

test.skip(
  !ownerEmail || !ownerPassword,
  "Local owner credentials are required.",
);

test("owner manages product-specific controls in a run-scoped organization", async ({
  page,
}, testInfo) => {
  test.setTimeout(120_000);
  const origin = new URL(
    testInfo.project.use.baseURL ?? "http://localhost:3000",
  );
  test.skip(
    !["localhost", "127.0.0.1"].includes(origin.hostname),
    "This journey only changes the local development stack.",
  );

  const signIn = await page.request.post("/api/v1/auth/sign-in", {
    data: { email: ownerEmail, password: ownerPassword, remember: true },
  });
  expect(signIn.status()).toBe(200);
  const before = await page.request.get("/api/v1/auth/session");
  expect(before.ok()).toBe(true);
  const initial = (await before.json()) as {
    user: { id: string };
    organization: { id: string } | null;
  };
  const originalOrganizationId = initial.organization?.id;

  const fixtures = new RunScopedAccounts(testInfo);
  const runLabel = `M10 Control E2E ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post("/api/v1/organizations", {
    data: {
      idempotencyKey: randomUUID(),
      legalName: runLabel,
      registeredAddress: {
        addressLine1: "100 Control Street",
        locality: "London",
        postalCode: "SW1A 1AA",
        country: "GB",
      },
      mainEstablishmentCountry: "GB",
      manufacturerContactName: "Control Test Owner",
      manufacturerContactEmail: ownerEmail,
    },
  });
  expect(created.status()).toBe(201);
  const organization = (await created.json()) as { id: string };
  fixtures.trackOrganization(organization.id);

  try {
    const entitiesResponse = await page.request.get(
      "/api/v1/organizations/current/legal-entities",
    );
    expect(entitiesResponse.ok()).toBe(true);
    const entities = (await entitiesResponse.json()) as {
      legalEntities: Array<{ id: string }>;
    };
    expect(entities.legalEntities[0]).toBeDefined();
    const productName = `${runLabel} product`;
    const productResponse = await page.request.post("/api/v1/products", {
      data: {
        name: productName,
        internalCode: `M10-${randomUUID().slice(0, 12)}`,
        productType: "standalone_software",
        legalEntityId: entities.legalEntities[0]!.id,
        responsibleOwnerId: initial.user.id,
        idempotencyKey: randomUUID(),
      },
    });
    expect(productResponse.status()).toBe(201);
    const productId = (
      (await productResponse.json()) as { product: { id: string } }
    ).product.id;

    const catalogResponse = await page.request.get("/api/v1/frameworks");
    expect(catalogResponse.ok()).toBe(true);
    const catalog = (await catalogResponse.json()) as {
      packs: Array<{
        packKey: string;
        versions: Array<{ versionKey: string }>;
      }>;
    };
    const pack = catalog.packs.find((item) => item.packKey === "cra-annex-i");
    expect(pack?.versions[0]).toBeDefined();
    const versionKey = pack!.versions[0]!.versionKey;
    const select = await page.request.put(
      `/api/v1/frameworks/${pack!.packKey}/selection`,
      {
        data: {
          versionKey,
          enabled: true,
          expectedRevision: null,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(select.ok()).toBe(true);

    await page.goto("/frameworks");
    await page.getByRole("button", { name: "Open control library" }).click();
    await expect(page.getByText(/No controls yet/i)).toBeVisible();
    const createControl = page.getByRole("button", { name: "Create control" });
    await createControl.focus();
    await expect(createControl).toBeFocused();
    await page.keyboard.press("Enter");
    await page
      .getByRole("textbox", { name: "Control title" })
      .fill(`${runLabel} secure updates`);
    await page
      .getByRole("textbox", { name: "Description" })
      .fill("Review the secure update process for this product.");
    await page.getByRole("button", { name: "Save control" }).click();
    await expect(
      page.getByRole("heading", { name: `${runLabel} secure updates` }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit control" }).click();
    await page
      .getByRole("combobox", { name: "Implementation status" })
      .selectOption("in_progress");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Implementation: In progress")).toBeVisible();

    await page.getByRole("button", { name: "Map requirement" }).click();
    const requirement = page.getByRole("combobox", { name: "Requirement" });
    await expect(requirement.locator("option")).not.toHaveCount(1);
    await requirement.selectOption({ index: 1 });
    await page
      .getByRole("textbox", { name: "Rationale" })
      .fill("Applies to this product's update process.");
    await page.getByRole("checkbox", { name: productName }).check();
    await page.getByRole("button", { name: "Save mapping" }).click();
    await expect(
      page.getByText("Rationale: Applies to this product's update process."),
    ).toBeVisible();
    await expect(
      page
        .getByRole("table", {
          name: "Requirement coverage for selected product",
        })
        .getByText("Mapped")
        .first(),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath("m10-controls-mapped-desktop.png"),
      fullPage: false,
    });

    const controlsResponse = await page.request.get(
      "/api/v1/frameworks/controls?limit=50",
    );
    expect(controlsResponse.ok()).toBe(true);
    const controls = (await controlsResponse.json()) as {
      controls: Array<{ id: string; title: string; revision: number }>;
    };
    const control = controls.controls.find(
      (item) => item.title === `${runLabel} secure updates`,
    );
    expect(control).toBeDefined();
    const stale = await page.request.put(
      `/api/v1/frameworks/controls/${control!.id}`,
      {
        data: {
          title: control!.title,
          description: "A stale edit must fail.",
          ownerUserId: initial.user.id,
          status: "not_started",
          transitionReason: "Test stale revision",
          expectedRevision: 1,
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(stale.status()).toBe(409);

    if (originalOrganizationId) {
      const switched = await page.request.post("/api/v1/organizations/switch", {
        data: { organizationId: originalOrganizationId },
      });
      expect(switched.ok()).toBe(true);
      await page.goto("/frameworks");
      await page.getByRole("button", { name: "Open control library" }).click();
      await expect(page.getByText(`${runLabel} secure updates`)).toHaveCount(0);
      const restored = await page.request.post("/api/v1/organizations/switch", {
        data: { organizationId: organization.id },
      });
      expect(restored.ok()).toBe(true);
      await page.goto(`/frameworks?controlId=${control!.id}`);
    }

    await expect(
      page.getByRole("heading", { name: `${runLabel} secure updates` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Archive control" }).click();
    await page.getByRole("button", { name: "Confirm archive" }).click();
    await expect(page.getByText(/Archived Sep/i)).toBeVisible();
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("heading", { name: `${runLabel} secure updates` })
      .scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath("m10-controls-archived-mobile.png"),
      fullPage: false,
    });

    const coverageResponse = await page.request.get(
      `/api/v1/frameworks/${pack!.packKey}/versions/${versionKey}/coverage?productId=${productId}&limit=100`,
    );
    expect(coverageResponse.ok()).toBe(true);
    const coverage = (await coverageResponse.json()) as {
      requirements: Array<{ controls: Array<{ id: string }> }>;
    };
    expect(
      coverage.requirements.every((item) =>
        item.controls.every((entry) => entry.id !== control!.id),
      ),
    ).toBe(true);
  } finally {
    await fixtures.cleanup();
  }
});
