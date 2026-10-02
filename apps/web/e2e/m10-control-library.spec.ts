import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";

import { RunScopedAccounts } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Live browser run is opt-in. */

const ownerEmail = process.env.E2E_OWNER_EMAIL;
const ownerPassword = process.env.E2E_OWNER_PASSWORD;
const localServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const localSupabaseOrigin = "http://127.0.0.1:54321";

test.skip(
  !ownerEmail || !ownerPassword || !localServiceRoleKey,
  "Local owner credentials and service-role fixture access are required.",
);

test("owner manages product-specific controls in a run-scoped organization", async ({
  page,
}, testInfo) => {
  test.setTimeout(240_000);
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
  let uploadedObjectKey: string | null = null;
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
    await requirement.selectOption("annex-i-part-i-1");
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
    ).toBeVisible({ timeout: 45_000 });
    await page.screenshot({
      path: testInfo.outputPath("m10-controls-mapped-desktop.png"),
      fullPage: false,
    });

    await page
      .getByRole("button", { name: "Review coverage and gaps" })
      .click();
    const coverageWorkspace = page.getByRole("region", {
      name: "Framework coverage",
    });
    await expect(
      coverageWorkspace.getByRole("combobox", { name: "Product" }),
    ).toHaveValue(productId);
    await expect(
      coverageWorkspace.getByRole("combobox", { name: "Show requirements" }),
    ).toBeVisible();
    await expect
      .poll(
        async () => {
          const result = await page.request.get(
            `/api/v1/frameworks/${pack!.packKey}/versions/${versionKey}/coverage?productId=${productId}&limit=100&filter=gaps`,
          );
          if (!result.ok()) return "request failed";
          const value = (await result.json()) as {
            calculation: { status: string };
          };
          return value.calculation.status;
        },
        { timeout: 45_000, intervals: [5_000] },
      )
      .toBe("current");
    await coverageWorkspace
      .getByRole("combobox", { name: "Show requirements" })
      .selectOption("gaps");
    await expect(
      coverageWorkspace.getByText(/applicable requirements evidence-backed/i),
    ).toBeVisible();
    await expect(coverageWorkspace.getByText(/gaps? ·/i)).toBeVisible();
    await coverageWorkspace.screenshot({
      path: testInfo.outputPath("m10-03-product-gaps-desktop.png"),
    });

    const gapsResponse = await page.request.get(
      `/api/v1/frameworks/${pack!.packKey}/versions/${versionKey}/coverage?productId=${productId}&limit=100&filter=gaps`,
    );
    expect(gapsResponse.ok()).toBe(true);
    const gapData = (await gapsResponse.json()) as {
      requirements: Array<{
        requirementKey: string;
        assessable: boolean;
        coverageState: string;
      }>;
    };
    const unmapped = gapData.requirements.find(
      (item) => item.assessable && item.coverageState === "no_mapping",
    );
    expect(unmapped).toBeDefined();
    await coverageWorkspace
      .locator(`[data-requirement-key="${unmapped!.requirementKey}"]`)
      .click();
    await coverageWorkspace
      .getByRole("button", { name: /mark .* not applicable/i })
      .click();
    await coverageWorkspace
      .getByRole("textbox", { name: "Reason" })
      .fill("Run-scoped synthetic product applicability review.");
    await coverageWorkspace
      .getByRole("button", { name: "Save non-applicability" })
      .click();
    await expect(
      coverageWorkspace.getByText(/Applicability saved/i),
    ).toBeVisible();
    await coverageWorkspace.screenshot({
      path: testInfo.outputPath("m10-03-applicability-desktop.png"),
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

    const evidenceBytes = Buffer.from(
      `Run-scoped framework evidence for ${runLabel}.\n`,
      "utf8",
    );
    const initialized = await page.request.post("/api/v1/evidence-uploads", {
      data: {
        title: `${runLabel} test report`,
        documentClass: "test_report",
        ownerUserId: initial.user.id,
        productIds: [productId],
        validFrom: null,
        validUntil: null,
        fileName: "m10-03-test-report.txt",
        byteSize: evidenceBytes.byteLength,
        idempotencyKey: randomUUID(),
      },
    });
    expect(initialized.status()).toBe(201);
    const reservation = (await initialized.json()) as {
      document: { id: string; currentVersion: { id: string } };
      upload: { uploadUrl: string };
    };
    const documentId = reservation.document.id;
    const evidenceVersionId = reservation.document.currentVersion.id;
    const storageLookup = await page.request.get(
      `${localSupabaseOrigin}/rest/v1/evidence_document_versions?select=object_key&organization_id=eq.${organization.id}&id=eq.${evidenceVersionId}`,
      {
        headers: {
          apikey: localServiceRoleKey!,
          Authorization: `Bearer ${localServiceRoleKey!}`,
        },
      },
    );
    expect(storageLookup.ok()).toBe(true);
    const storageRows = (await storageLookup.json()) as Array<{
      object_key: string;
    }>;
    expect(storageRows).toHaveLength(1);
    uploadedObjectKey = storageRows[0]!.object_key;
    expect(uploadedObjectKey.startsWith(`${organization.id}/`)).toBe(true);
    expect(uploadedObjectKey.split("/")).toHaveLength(4);

    const storageUpload = await page.request.put(reservation.upload.uploadUrl, {
      data: evidenceBytes,
      headers: { "content-type": "text/plain" },
    });
    expect(storageUpload.ok()).toBe(true);
    const completed = await page.request.post(
      `/api/v1/evidence-uploads/${evidenceVersionId}/complete`,
      { data: { idempotencyKey: randomUUID() } },
    );
    expect(completed.ok()).toBe(true);
    expect(await completed.json()).toMatchObject({
      completion: { outcome: "scan_pending" },
    });

    // The local test stack has no ClamAV process. Complete only this uploaded,
    // verified version through the M8 scan-result RPC so coverage sees a clean
    // evidence version; scanner behavior is tested separately.
    const recordedScan = await page.request.post(
      `${localSupabaseOrigin}/rest/v1/rpc/record_evidence_document_scan_atomic`,
      {
        headers: {
          apikey: localServiceRoleKey!,
          Authorization: `Bearer ${localServiceRoleKey!}`,
        },
        data: {
          p_organization_id: organization.id,
          p_version_id: evidenceVersionId,
          p_engine_name: "m10-e2e-local-fixture",
          p_engine_version: "fixture-1",
          p_signature_version: "fixture-1",
          p_outcome: "clean",
          p_detection: null,
        },
      },
    );
    expect(recordedScan.ok()).toBe(true);
    expect(await recordedScan.json()).toBe("clean");

    await page.goto(`/frameworks?controlId=${control!.id}`);
    await expect(
      page.getByRole("heading", { name: `${runLabel} secure updates` }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Link evidence version" }).click();
    await page
      .getByRole("combobox", { name: "Evidence product" })
      .selectOption(productId);
    await page
      .getByRole("combobox", { name: "Evidence document" })
      .selectOption(documentId);
    await page
      .getByRole("combobox", { name: "Clean evidence version" })
      .selectOption(evidenceVersionId);
    await page.getByRole("button", { name: "Save evidence link" }).click();
    await expect(
      page
        .locator("p")
        .filter({ hasText: `${runLabel} test report · Version 1` })
        .first(),
    ).toBeVisible();

    await page.getByRole("button", { name: "Edit control" }).click();
    await page
      .getByRole("combobox", { name: "Implementation status" })
      .selectOption("implemented");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText("Implementation: Implemented")).toBeVisible();

    const controlDetailResponse = await page.request.get(
      `/api/v1/frameworks/controls/${control!.id}`,
    );
    expect(controlDetailResponse.ok()).toBe(true);
    const controlDetail = (await controlDetailResponse.json()) as {
      mappings: Array<{ requirementKey: string }>;
      evidenceLinks: Array<{
        id: string;
        evidenceVersionId: string;
        endedAt: string | null;
      }>;
    };
    const mappedRequirementKey = controlDetail.mappings[0]?.requirementKey;
    expect(mappedRequirementKey).toBeDefined();
    expect(
      controlDetail.evidenceLinks.some(
        (link) =>
          link.evidenceVersionId === evidenceVersionId && link.endedAt === null,
      ),
    ).toBe(true);

    const coverageUrl = `/api/v1/frameworks/${pack!.packKey}/versions/${versionKey}/coverage?productId=${productId}&limit=100`;
    await expect
      .poll(
        async () => {
          const response = await page.request.get(coverageUrl);
          if (!response.ok()) return `HTTP ${response.status()}`;
          const value = (await response.json()) as {
            calculation: { status: string };
            requirements: Array<{
              requirementKey: string;
              coverageState: string;
            }>;
          };
          return value.calculation.status === "current"
            ? value.requirements.find(
                (item) => item.requirementKey === mappedRequirementKey,
              )?.coverageState
            : value.calculation.status;
        },
        { timeout: 90_000, intervals: [5_000] },
      )
      .toBe("evidence_backed");

    await page
      .getByRole("button", { name: "Review coverage and gaps" })
      .click();
    const resolvedCoverage = page.getByRole("region", {
      name: "Framework coverage",
    });
    await resolvedCoverage
      .getByRole("combobox", { name: "Show requirements" })
      .selectOption("evidence_backed");
    await expect(
      resolvedCoverage.locator(
        `[data-requirement-key="${mappedRequirementKey}"]`,
      ),
    ).toBeVisible();
    await resolvedCoverage.screenshot({
      path: testInfo.outputPath("m10-03-evidence-backed-desktop.png"),
      animations: "disabled",
    });

    await page.getByRole("button", { name: "End link" }).click();
    await expect(
      page
        .locator("p")
        .filter({ hasText: `${runLabel} test report · Version 1` })
        .first(),
    ).toBeVisible();
    const afterUnlink = await page.request.get(coverageUrl);
    expect(afterUnlink.ok()).toBe(true);
    const afterUnlinkData = (await afterUnlink.json()) as {
      calculation: { status: string };
      requirements: Array<{ requirementKey: string; coverageState: string }>;
    };
    expect(afterUnlinkData.calculation.status).toBe("stale");
    expect(
      afterUnlinkData.requirements.find(
        (item) => item.requirementKey === mappedRequirementKey,
      )?.coverageState,
    ).not.toBe("evidence_backed");
    await expect
      .poll(
        async () => {
          const response = await page.request.get(coverageUrl);
          if (!response.ok()) return `HTTP ${response.status()}`;
          const value = (await response.json()) as {
            calculation: { status: string };
            requirements: Array<{
              requirementKey: string;
              coverageState: string;
            }>;
          };
          return value.calculation.status === "current"
            ? value.requirements.find(
                (item) => item.requirementKey === mappedRequirementKey,
              )?.coverageState
            : value.calculation.status;
        },
        { timeout: 90_000, intervals: [5_000] },
      )
      .toBe("missing_evidence");
    await resolvedCoverage
      .getByRole("combobox", { name: "Show requirements" })
      .selectOption("gaps");
    await expect(
      resolvedCoverage.locator(
        `[data-requirement-key="${mappedRequirementKey}"]`,
      ),
    ).toBeVisible();
    await resolvedCoverage.screenshot({
      path: testInfo.outputPath("m10-03-gap-returned-desktop.png"),
      animations: "disabled",
    });

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
    try {
      if (uploadedObjectKey) {
        const removed = await page.request.delete(
          `${localSupabaseOrigin}/storage/v1/object/evidence-documents`,
          {
            headers: {
              apikey: localServiceRoleKey!,
              Authorization: `Bearer ${localServiceRoleKey!}`,
            },
            data: { prefixes: [uploadedObjectKey] },
          },
        );
        expect(removed.ok()).toBe(true);
        const lastSlash = uploadedObjectKey.lastIndexOf("/");
        const prefix = uploadedObjectKey.slice(0, lastSlash + 1);
        const objectName = uploadedObjectKey.slice(lastSlash + 1);
        const listed = await page.request.post(
          `${localSupabaseOrigin}/storage/v1/object/list/evidence-documents`,
          {
            headers: {
              apikey: localServiceRoleKey!,
              Authorization: `Bearer ${localServiceRoleKey!}`,
            },
            data: { prefix, limit: 100, offset: 0 },
          },
        );
        expect(listed.ok()).toBe(true);
        const remaining = (await listed.json()) as Array<{ name: string }>;
        expect(remaining.some((entry) => entry.name === objectName)).toBe(
          false,
        );
      }
    } finally {
      await fixtures.cleanup();
    }
  }
});
