import { createHash, randomUUID } from "node:crypto";

import { expect, test, type BrowserContext, type Page } from "@playwright/test";

import {
  LIVE_API_ORIGIN,
  RunScopedAccounts,
  type TestAccount,
} from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";

type CreatedOrganization = Readonly<{ id: string }>;
type LegalEntitiesResponse = Readonly<{
  legalEntities: readonly Readonly<{ id: string }>[];
}>;
type CreatedProduct = Readonly<{ product: Readonly<{ id: string }> }>;
type CreatedRelease = Readonly<{ release: Readonly<{ id: string }> }>;
type CreatedSupportPeriod = Readonly<{
  supportPeriod: Readonly<{ id: string }>;
}>;
type Assessment = Readonly<{
  id: string;
  version: number;
  status: string;
  suggestion: string;
  determination: string | null;
}>;
type AssessmentResponse = Readonly<{ assessment: Assessment }>;
type Artifact = Readonly<{
  id: string;
  version: number;
  uploadStatus: string;
  integrityStatus: string;
  reviewStatus: string;
  publicationStatus: string;
  availabilityStatus: string;
  availabilityRuleVersion: string;
  availabilityWinningRule: string | null;
  availabilityUntil: string | null;
  statusExplanation: Readonly<{ code: string; message: string }> | null;
}>;
type ArtifactResponse = Readonly<{ artifact: Artifact }>;
type ArtifactReservationResponse = Readonly<{
  artifact: Artifact;
  upload: Readonly<{ uploadUrl: string }>;
}>;

async function createOrganization(
  context: BrowserContext,
  account: TestAccount,
  legalName: string,
): Promise<string> {
  const response = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/organizations`,
    {
      data: {
        idempotencyKey: randomUUID(),
        legalName,
        registeredAddress: {
          addressLine1: "100 M2 V2 Evidence Street",
          locality: "London",
          postalCode: "SW1A 1AA",
          country: "GB",
        },
        mainEstablishmentCountry: "GB",
        manufacturerContactName: "M2 V2 E2E Owner",
        manufacturerContactEmail: account.email,
      },
    },
  );
  expect(response.status()).toBe(201);
  return ((await response.json()) as CreatedOrganization).id;
}

async function createProductFixtures(
  context: BrowserContext,
  account: TestAccount,
  runLabel: string,
): Promise<Readonly<{ productId: string; releaseId: string }>> {
  const entitiesResponse = await context.request.get(
    `${LIVE_API_ORIGIN}/api/v1/organizations/current/legal-entities`,
  );
  expect(entitiesResponse.status()).toBe(200);
  const legalEntity = ((await entitiesResponse.json()) as LegalEntitiesResponse)
    .legalEntities[0];
  expect(legalEntity).toBeDefined();
  if (!legalEntity)
    throw new Error("Run-scoped organization has no legal entity");

  const productResponse = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/products`,
    {
      data: {
        name: `${runLabel} product`,
        internalCode: `M2V2-${Date.now()}-${Math.floor(Math.random() * 100_000)}`,
        productType: "standalone_software",
        legalEntityId: legalEntity.id,
        responsibleOwnerId: account.publicUserId,
        idempotencyKey: randomUUID(),
      },
    },
  );
  expect(productResponse.status()).toBe(201);
  const productId = ((await productResponse.json()) as CreatedProduct).product
    .id;

  const releaseResponse = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/products/${productId}/releases`,
    {
      data: {
        label: `${runLabel} release`,
        version: "1.0.0",
        idempotencyKey: randomUUID(),
      },
    },
  );
  expect(releaseResponse.status()).toBe(201);
  const releaseId = ((await releaseResponse.json()) as CreatedRelease).release
    .id;

  const supportResponse = await context.request.post(
    `${LIVE_API_ORIGIN}/api/v1/products/${productId}/support-periods`,
    {
      data: {
        releaseId,
        supportStartsAt: "2026-01-01T00:00:00.000Z",
        supportEndsAt: "2040-01-01T00:00:00.000Z",
        expectedLifetimeJustification:
          "Run-scoped M2 V2 test update remains supported through the CRA window.",
        idempotencyKey: randomUUID(),
      },
    },
  );
  expect(supportResponse.status()).toBe(201);
  expect((await supportResponse.json()) as CreatedSupportPeriod).toMatchObject({
    supportPeriod: { releaseId },
  });

  return Object.freeze({ productId, releaseId });
}

async function gotoProductDetail(
  page: Page,
  productId: string,
  productName: string,
) {
  await page.goto(`/products/${productId}`);
  await expect(
    page.getByRole("heading", { name: productName, exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Substantial modifications",
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "Security update artifacts",
      exact: true,
    }),
  ).toBeVisible();
}

test("a run-scoped owner reviews a flagged assessment and publishes a cleared security update artifact", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  try {
    const account = await fixtures.createVerified(context, "m2-v2-owner");
    const runLabel = `E2E M2 V2 ${testInfo.parallelIndex}-${Date.now()}`;
    const organizationId = await createOrganization(context, account, runLabel);
    fixtures.trackM2V2Organization(organizationId);
    const productName = `${runLabel} product`;
    const artifactTitle = `${runLabel} security update`;
    const { productId, releaseId } = await createProductFixtures(
      context,
      account,
      runLabel,
    );
    const page = await context.newPage();
    await gotoProductDetail(page, productId, productName);
    await expect(
      page.getByRole("combobox", { name: "Affected release", exact: true }),
    ).toHaveValue(releaseId);

    await page
      .getByLabel("Modification identifier", { exact: true })
      .fill(`E2E-M2V2-${testInfo.parallelIndex}-${Date.now()}`);
    await page
      .getByLabel("Modification title", { exact: true })
      .fill(`${runLabel} trust-boundary update`);
    await page
      .getByLabel("Introduced at (UTC)", { exact: true })
      .fill("2026-08-17T00:00:00.000Z");
    await page
      .getByLabel("Detected or assessed at (UTC)", { exact: true })
      .fill("2026-08-17T01:00:00.000Z");
    await page
      .getByLabel("Modification description", { exact: true })
      .fill("The update introduces a new trusted remote management boundary.");
    await page
      .getByLabel("Technical scope", { exact: true })
      .fill(
        "Remote management authorization and the deployment trust boundary.",
      );
    await page
      .getByLabel("Previous state", { exact: true })
      .fill("Remote management was unavailable to the affected deployment.");
    await page
      .getByLabel("Resulting state", { exact: true })
      .fill("Remote management now crosses the reviewed trust boundary.");
    await page
      .getByLabel("Required follow-up actions (one per line)", { exact: true })
      .fill(
        "Complete a CRA classification follow-up\nPublish the security update",
      );
    await page
      .getByRole("combobox", { name: "Changes intended purpose", exact: true })
      .selectOption("no");
    await page
      .getByRole("combobox", {
        name: "Changes security architecture or trust boundary",
        exact: true,
      })
      .selectOption("yes");
    await page
      .getByRole("combobox", {
        name: "Changes network interface or privileged remote control",
        exact: true,
      })
      .selectOption("no");
    await page
      .getByRole("combobox", {
        name: "Changes cryptography or identity and access control",
        exact: true,
      })
      .selectOption("no");
    await page
      .getByRole("combobox", {
        name: "Changes a safety or security relevant component",
        exact: true,
      })
      .selectOption("no");
    await page
      .getByLabel("Assessment rationale", { exact: true })
      .fill("A trust-boundary change requires a human CRA assessment.");
    const assessmentCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/modification-assessments` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create assessment", exact: true })
      .click();
    const createdAssessmentResponse = await assessmentCreated;
    expect(createdAssessmentResponse.status()).toBe(201);
    const createdAssessment =
      (await createdAssessmentResponse.json()) as AssessmentResponse;
    expect(createdAssessment.assessment).toMatchObject({
      status: "submitted_for_review",
      suggestion: "potentially_substantial",
    });

    await page
      .getByRole("combobox", {
        name: "Authoritative determination",
        exact: true,
      })
      .selectOption("substantial");
    await page
      .getByLabel("Review rationale", { exact: true })
      .fill(
        "The trusted boundary changes and requires the prescribed follow-up.",
      );
    await page
      .getByLabel(
        "Override reason (when different from the policy suggestion)",
        {
          exact: true,
        },
      )
      .fill(
        "The human reviewer determined the risk exceeds the policy suggestion.",
      );
    const assessmentReviewed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/modification-assessments/${createdAssessment.assessment.id}/review` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Review assessment", exact: true })
      .click();
    const reviewedAssessmentResponse = await assessmentReviewed;
    expect(reviewedAssessmentResponse.status()).toBe(200);
    expect(
      (await reviewedAssessmentResponse.json()) as AssessmentResponse,
    ).toMatchObject({
      assessment: { status: "reviewed", determination: "substantial" },
    });

    await expect(page.getByText("Assessment review recorded.")).toBeVisible();
    await expect(
      page.getByText(/Authoritative determination: Substantial/),
    ).toBeVisible();

    const bytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    await page
      .getByRole("combobox", { name: "Release selector", exact: true })
      .selectOption(releaseId);
    await page.getByLabel("Artifact file", { exact: true }).setInputFiles({
      name: `e2e-m2-v2-${testInfo.parallelIndex}-${Date.now()}.png`,
      mimeType: "image/png",
      buffer: bytes,
    });
    await page.getByLabel("Update version", { exact: true }).fill("1.0.1");
    await page
      .getByLabel("Artifact title", { exact: true })
      .fill(artifactTitle);
    await page
      .getByLabel("Supported platform", { exact: true })
      .fill("E2E test platform");
    await page
      .getByLabel("SHA-256", { exact: true })
      .fill(createHash("sha256").update(bytes).digest("hex"));
    const reservationResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/security-update-artifacts/reserve` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", {
        name: "Reserve security update artifact",
        exact: true,
      })
      .click();
    const reservation = (await (
      await reservationResponse
    ).json()) as ArtifactReservationResponse;
    expect(reservation.artifact).toMatchObject({
      uploadStatus: "reserved",
      reviewStatus: "pending_review",
      publicationStatus: "draft",
    });

    await expect(
      page.getByText("Upload finalized and queued for integrity review."),
    ).toBeVisible();
    await expect(
      page.getByText("Verified", {
        exact: true,
      }),
    ).toBeVisible();
    const finalizedResponse = await context.request.get(
      `${LIVE_API_ORIGIN}/api/v1/products/${productId}/security-update-artifacts/${reservation.artifact.id}`,
    );
    expect(finalizedResponse.status()).toBe(200);
    const finalized = (await finalizedResponse.json()) as ArtifactResponse;
    expect(finalized.artifact).toMatchObject({
      uploadStatus: "finalized",
      integrityStatus: "verified",
      reviewStatus: "pending_review",
      statusExplanation: { code: "awaiting_approval" },
    });
    const clearedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/security-update-artifacts/${reservation.artifact.id}/review` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Clear quarantine", exact: true })
      .click();
    const cleared = (await (await clearedResponse).json()) as ArtifactResponse;
    expect(cleared.artifact.reviewStatus).toBe("cleared");

    await expect(page.getByText("Quarantine cleared.")).toBeVisible();
    const publishedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/security-update-artifacts/${reservation.artifact.id}/publish` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Publish artifact", exact: true })
      .click();
    const published = (await (
      await publishedResponse
    ).json()) as ArtifactResponse;
    expect(published.artifact).toMatchObject({
      publicationStatus: "published",
      availabilityStatus: "available",
      availabilityWinningRule: "support_period_end",
      availabilityRuleVersion: "m2.v2.security-update-availability.v1",
    });
    expect(published.artifact.availabilityUntil).not.toBeNull();
    expect(published.artifact.statusExplanation).toBeNull();

    await expect(page.getByText("Artifact published.")).toBeVisible();
    // The artifact row explains the full calculation: both candidates, the
    // winning rule with its version, and the resulting availability date.
    await expect(
      page.getByText("Issued candidate (issue date plus 10 calendar years)"),
    ).toBeVisible();
    await expect(
      page.getByText("Support period candidate", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Winning rule", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/Support period end · m2\.v2\.security-update-availability\.v1/),
    ).toBeVisible();
    // The winning support-period date also appears as the support candidate,
    // so scope to the row that reports the final availability instant.
    await expect(
      page
        .getByText("Availability until", { exact: true })
        .locator("xpath=following-sibling::dd"),
    ).toHaveText(published.artifact.availabilityUntil ?? "");

    const desktopScreenshot = await page.screenshot();
    expect(desktopScreenshot.byteLength).toBeGreaterThan(1_000);
    await testInfo.attach("m2-v2-product-compliance-desktop", {
      body: desktopScreenshot,
      contentType: "image/png",
    });
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(
      page.getByRole("heading", {
        name: "Security update artifacts",
        exact: true,
      }),
    ).toBeVisible();
    const mobileScreenshot = await page.screenshot();
    expect(mobileScreenshot.byteLength).toBeGreaterThan(1_000);
    await testInfo.attach("m2-v2-product-compliance-mobile", {
      body: mobileScreenshot,
      contentType: "image/png",
    });
  } finally {
    try {
      await context.close();
    } catch {
      // Playwright may already dispose the context when a test times out.
      // Preserve the original test failure and still run exact fixture cleanup.
    }
    await fixtures.cleanup();
  }
});

test("a run-scoped owner sees the flagged badge, reviews assessment history, rejects a quarantined artifact, and hits a stale metadata-edit conflict", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const context = await browser.newContext({ baseURL: WEB_ORIGIN });

  try {
    const account = await fixtures.createVerified(context, "m2-v2-gaps");
    const runLabel = `E2E M2 V2 gaps ${testInfo.parallelIndex}-${Date.now()}`;
    const organizationId = await createOrganization(context, account, runLabel);
    fixtures.trackM2V2Organization(organizationId);
    const productName = `${runLabel} product`;
    const { productId, releaseId } = await createProductFixtures(
      context,
      account,
      runLabel,
    );
    const page = await context.newPage();
    await gotoProductDetail(page, productId, productName);

    // --- Create + review to "substantial": the flagged badge must appear. ---
    await page
      .getByLabel("Modification identifier", { exact: true })
      .fill(`E2E-M2V2-GAPS-${testInfo.parallelIndex}-${Date.now()}`);
    await page
      .getByLabel("Modification title", { exact: true })
      .fill(`${runLabel} trust-boundary update`);
    await page
      .getByLabel("Introduced at (UTC)", { exact: true })
      .fill("2026-08-17T00:00:00.000Z");
    await page
      .getByLabel("Detected or assessed at (UTC)", { exact: true })
      .fill("2026-08-17T01:00:00.000Z");
    await page
      .getByLabel("Modification description", { exact: true })
      .fill("The update introduces a new trusted remote management boundary.");
    await page
      .getByLabel("Technical scope", { exact: true })
      .fill(
        "Remote management authorization and the deployment trust boundary.",
      );
    await page
      .getByLabel("Previous state", { exact: true })
      .fill("Remote management was unavailable to the affected deployment.");
    await page
      .getByLabel("Resulting state", { exact: true })
      .fill("Remote management now crosses the reviewed trust boundary.");
    await page
      .getByLabel("Required follow-up actions (one per line)", { exact: true })
      .fill("Complete a CRA classification follow-up");
    await page
      .getByRole("combobox", { name: "Changes intended purpose", exact: true })
      .selectOption("no");
    await page
      .getByRole("combobox", {
        name: "Changes security architecture or trust boundary",
        exact: true,
      })
      .selectOption("yes");
    await page
      .getByRole("combobox", {
        name: "Changes network interface or privileged remote control",
        exact: true,
      })
      .selectOption("no");
    await page
      .getByRole("combobox", {
        name: "Changes cryptography or identity and access control",
        exact: true,
      })
      .selectOption("no");
    await page
      .getByRole("combobox", {
        name: "Changes a safety or security relevant component",
        exact: true,
      })
      .selectOption("no");
    await page
      .getByLabel("Assessment rationale", { exact: true })
      .fill("A trust-boundary change requires a human CRA assessment.");
    const assessmentCreated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/modification-assessments` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Create assessment", exact: true })
      .click();
    const createdAssessment =
      (await (await assessmentCreated).json()) as AssessmentResponse;

    await page
      .getByRole("combobox", {
        name: "Authoritative determination",
        exact: true,
      })
      .selectOption("substantial");
    await page
      .getByLabel("Review rationale", { exact: true })
      .fill("The trusted boundary changes and requires the prescribed follow-up.");
    await page
      .getByLabel(
        "Override reason (when different from the policy suggestion)",
        { exact: true },
      )
      .fill("The human reviewer determined the risk exceeds the policy suggestion.");
    const assessmentReviewed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/modification-assessments/${createdAssessment.assessment.id}/review` &&
        response.request().method() === "POST",
    );
    // The review mutation's UI success path refetches the assessments list
    // after this response resolves, so the row's `expectedVersion` prop is
    // stale until that follow-up GET lands -- wait for it before reassessing
    // against the freshly reviewed version.
    const assessmentsRefetchedAfterReview = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/modification-assessments` &&
        response.request().method() === "GET",
    );
    await page
      .getByRole("button", { name: "Review assessment", exact: true })
      .click();
    await assessmentReviewed;
    await assessmentsRefetchedAfterReview;

    await expect(
      page.getByText("Flagged for conformity follow-up"),
    ).toBeVisible();

    // --- Reassess: a second revision is created; history shows both with
    // the changed answer highlighted. Scoped to this assessment's row so its
    // reassess form (pre-filled with the same field labels as the top-level
    // create form) doesn't collide in a strict-mode locator match. ---
    const assessmentRow = page
      .locator("li")
      .filter({ hasText: `${runLabel} trust-boundary update` });
    await assessmentRow
      .getByRole("button", { name: "Reassess assessment", exact: true })
      .click();
    await assessmentRow
      .getByRole("combobox", {
        name: "Changes network interface or privileged remote control",
        exact: true,
      })
      .selectOption("yes");
    const assessmentReassessed = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/modification-assessments/${createdAssessment.assessment.id}/reassess` &&
        response.request().method() === "POST",
    );
    await assessmentRow
      .getByRole("button", { name: "Reassess assessment", exact: true })
      .last()
      .click();
    const reassessedRaw = await assessmentReassessed;
    const reassessedBody = await reassessedRaw.json();
    expect(
      reassessedRaw.status(),
      `reassess response body: ${JSON.stringify(reassessedBody)}`,
    ).toBe(200);
    const reassessed = reassessedBody as AssessmentResponse;
    expect(reassessed.assessment.status).toBe("submitted_for_review");

    // Reassessment supersedes the old row and the list refetches. Reload for
    // a clean render (the just-submitted reassess form otherwise stays open
    // and the title-scoped locator can momentarily see the outgoing and
    // incoming row together) before opening history.
    await page.reload();
    await expect(
      page.getByRole("heading", { name: productName, exact: true }),
    ).toBeVisible();
    const currentAssessmentRow = page
      .locator("li")
      .filter({ hasText: `${runLabel} trust-boundary update` })
      .first();
    await currentAssessmentRow
      .getByRole("button", { name: "View history", exact: true })
      .click();
    await expect(
      currentAssessmentRow.getByText("Assessment history"),
    ).toBeVisible();
    const historyList = currentAssessmentRow.getByRole("list", {
      name: "Assessment revisions",
    });
    await expect(historyList.getByText(/^Revision 1/)).toBeVisible();
    await expect(historyList.getByText(/^Revision 2/)).toBeVisible();
    await expect(
      historyList.getByText(
        "Changes network interface or privileged remote control: No",
      ),
    ).toBeVisible();
    await expect(
      historyList.getByText(
        "Changes network interface or privileged remote control: Yes",
      ),
    ).toBeVisible();

    // --- Reserve a second artifact and reject it during quarantine review. ---
    const rejectBytes = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      "base64",
    );
    const rejectArtifactTitle = `${runLabel} rejected update`;
    await page
      .getByRole("combobox", { name: "Release selector", exact: true })
      .selectOption(releaseId);
    await page.getByLabel("Artifact file", { exact: true }).setInputFiles({
      name: `e2e-m2-v2-gaps-reject-${testInfo.parallelIndex}-${Date.now()}.png`,
      mimeType: "image/png",
      buffer: rejectBytes,
    });
    await page.getByLabel("Update version", { exact: true }).fill("1.0.1");
    await page
      .getByLabel("Artifact title", { exact: true })
      .fill(rejectArtifactTitle);
    await page
      .getByLabel("Supported platform", { exact: true })
      .fill("E2E reject platform");
    await page
      .getByLabel("SHA-256", { exact: true })
      .fill(createHash("sha256").update(rejectBytes).digest("hex"));
    const rejectReservationResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/security-update-artifacts/reserve` &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", {
        name: "Reserve security update artifact",
        exact: true,
      })
      .click();
    const rejectReservation = (await (
      await rejectReservationResponse
    ).json()) as ArtifactReservationResponse;

    const rejectArtifactRow = page
      .locator("li")
      .filter({ hasText: rejectArtifactTitle });
    await expect(rejectArtifactRow.getByText("Verified", { exact: true })).toBeVisible();
    await rejectArtifactRow
      .getByRole("button", { name: "Reject artifact", exact: true })
      .click();
    await rejectArtifactRow
      .getByLabel("Rejection reason", { exact: true })
      .fill("Manual reviewer rejected this quarantined build.");
    const rejectedResponse = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/security-update-artifacts/${rejectReservation.artifact.id}/review` &&
        response.request().method() === "POST",
    );
    await rejectArtifactRow
      .getByRole("button", { name: "Confirm rejection", exact: true })
      .click();
    const rejected = (await (await rejectedResponse).json()) as ArtifactResponse;
    expect(rejected.artifact.reviewStatus).toBe("rejected");
    await expect(rejectArtifactRow.getByText("Artifact rejected.")).toBeVisible();

    // --- Metadata edit: a version bumped out from under the open form
    // surfaces the shared conflict affordance instead of silently overwriting. ---
    await rejectArtifactRow
      .getByRole("button", { name: "Edit metadata", exact: true })
      .click();
    await rejectArtifactRow
      .getByLabel("Updated artifact title", { exact: true })
      .fill(`${rejectArtifactTitle} (edited)`);

    const externalBump = await context.request.patch(
      `${LIVE_API_ORIGIN}/api/v1/products/${productId}/security-update-artifacts/${rejectReservation.artifact.id}/metadata`,
      {
        data: {
          expectedVersion: rejected.artifact.version,
          title: rejectArtifactTitle,
          supportedPlatform: "E2E reject platform (bumped externally)",
        },
      },
    );
    expect(externalBump.status()).toBe(200);
    const bumped = (await externalBump.json()) as ArtifactResponse;
    expect(bumped.artifact.version).toBe(rejected.artifact.version + 1);

    await rejectArtifactRow
      .getByRole("button", { name: "Save artifact metadata", exact: true })
      .click();
    await expect(
      rejectArtifactRow.getByRole("button", {
        name: "Reload current data",
        exact: true,
      }),
    ).toBeVisible();

    const artifactsRefetchedAfterReload = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/security-update-artifacts` &&
        response.request().method() === "GET",
    );
    await rejectArtifactRow
      .getByRole("button", { name: "Reload current data", exact: true })
      .click();
    await artifactsRefetchedAfterReload;
    const metadataUpdated = page.waitForResponse(
      (response) =>
        new URL(response.url()).pathname ===
          `/api/v1/products/${productId}/security-update-artifacts/${rejectReservation.artifact.id}/metadata` &&
        response.request().method() === "PATCH",
    );
    await rejectArtifactRow
      .getByRole("button", { name: "Save artifact metadata", exact: true })
      .click();
    const metadataUpdatedRaw = await metadataUpdated;
    const metadataUpdatedBody = await metadataUpdatedRaw.json();
    expect(
      metadataUpdatedRaw.status(),
      `metadata update response body: ${JSON.stringify(metadataUpdatedBody)}`,
    ).toBe(200);
    const updated = metadataUpdatedBody as ArtifactResponse;
    expect(updated.artifact.title).toBe(`${rejectArtifactTitle} (edited)`);
    await expect(
      rejectArtifactRow.getByText("Artifact metadata updated."),
    ).toBeVisible();

    const screenshot = await page.screenshot({ fullPage: true });
    expect(screenshot.byteLength).toBeGreaterThan(1_000);
    await testInfo.attach("m2-v2-gap-closing-flagged-history-reject-metadata", {
      body: screenshot,
      contentType: "image/png",
    });
  } finally {
    try {
      await context.close();
    } catch {
      // Playwright may already dispose the context when a test times out.
      // Preserve the original test failure and still run exact fixture cleanup.
    }
    await fixtures.cleanup();
  }
});

test("a cross-tenant request receives a generic not-found response without product metadata", async ({
  browser,
}, testInfo) => {
  test.setTimeout(90_000);
  const fixtures = new RunScopedAccounts(testInfo);
  const ownerContext = await browser.newContext({ baseURL: WEB_ORIGIN });
  const foreignContext = await browser.newContext({ baseURL: WEB_ORIGIN });

  try {
    const owner = await fixtures.createVerified(ownerContext, "m2-v2-owner");
    const runLabel = `E2E M2 V2 private ${testInfo.parallelIndex}-${Date.now()}`;
    const ownerOrganizationId = await createOrganization(
      ownerContext,
      owner,
      runLabel,
    );
    fixtures.trackM2V2Organization(ownerOrganizationId);
    const { productId } = await createProductFixtures(
      ownerContext,
      owner,
      runLabel,
    );

    const foreign = await fixtures.createVerified(
      foreignContext,
      "m2-v2-foreign",
    );
    const foreignOrganizationId = await createOrganization(
      foreignContext,
      foreign,
      `${runLabel} foreign`,
    );
    fixtures.trackOrganization(foreignOrganizationId);

    const privateAssessments = await foreignContext.request.get(
      `${LIVE_API_ORIGIN}/api/v1/products/${productId}/modification-assessments`,
    );
    expect(privateAssessments.status()).toBe(404);
    const body = await privateAssessments.json();
    expect(body).toMatchObject({ code: "not_found" });
    expect(JSON.stringify(body)).not.toContain(runLabel);
    expect(JSON.stringify(body)).not.toContain(productId);

    const foreignPage = await foreignContext.newPage();
    await foreignPage.goto(`/products/${productId}`);
    await expect(
      foreignPage.getByRole("heading", {
        name: `${runLabel} product`,
        exact: true,
      }),
    ).toHaveCount(0);
  } finally {
    await Promise.allSettled([ownerContext.close(), foreignContext.close()]);
    await fixtures.cleanup();
  }
});
