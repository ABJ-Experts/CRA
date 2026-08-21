import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";

import {
  expect,
  type APIRequestContext,
  type Browser,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

import { sbomValidationFixtures } from "./fixtures/sbom-validation";
import { LIVE_API_ORIGIN, signIn } from "./helpers/accounts";

/* eslint-disable turbo/no-undeclared-env-vars -- Playwright runs outside Turbo's cached task graph. */

const execFileAsync = promisify(execFile);
const WEB_ORIGIN = process.env.E2E_WEB_ORIGIN ?? "http://127.0.0.1:3000";
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const API_PREFIX = "/api/v1";
const OWNER_EMAIL = "owner@cra.test";
const DESKTOP_VIEWPORT = Object.freeze({ width: 1440, height: 1100 });
const MOBILE_VIEWPORT = Object.freeze({ width: 390, height: 844 });

type SessionResponse = Readonly<{
  user: Readonly<{ id: string; email: string }>;
}>;
type LegalEntitiesResponse = Readonly<{
  legalEntities: readonly Readonly<{
    id: string;
    identifier: string | null;
    completionStatus: string;
    status: string;
  }>[];
}>;
type ProductResponse = Readonly<{
  product: Readonly<{ id: string; name: string }>;
}>;
type ReleaseResponse = Readonly<{
  release: Readonly<{ id: string; label: string; version: string }>;
}>;
type SbomUploadResponse = Readonly<{
  source: Readonly<{ id: string; fileName: string }>;
}>;
type SbomJobResponse = Readonly<{
  job: Readonly<{ id: string; sourceId: string }>;
}>;
type SbomValidationReportResponse = Readonly<{
  source: Readonly<{
    id: string;
    fileName: string;
    supersedesSourceId?: string;
  }>;
  report: Readonly<{
    status: "pending" | "valid" | "valid_with_warnings" | "invalid";
    errorCount: number;
    warningCount: number;
  }>;
}>;
type SbomSourceHistoryResponse = Readonly<{
  sources: readonly Readonly<{
    source: Readonly<{
      id: string;
      fileName: string;
      supersedesSourceId?: string;
    }>;
    validation: Readonly<{ status: string }>;
  }>[];
}>;

test("owner uploads valid and invalid SBOMs, filters diagnostics, and corrects immutable evidence", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  const runId = `${Date.now()}-${testInfo.parallelIndex}-${testInfo.retry}`;
  const context = await browser.newContext({
    baseURL: WEB_ORIGIN,
    viewport: DESKTOP_VIEWPORT,
  });

  try {
    expect((await signIn(context.request, OWNER_EMAIL)).status()).toBe(200);
    const session = await currentSession(context.request);
    const legalEntityId = await defaultLegalEntityId(context.request);
    const product = await createProduct(context.request, {
      runId,
      ownerId: session.user.id,
      legalEntityId,
    });
    const release = await createRelease(
      context.request,
      product.product.id,
      runId,
    );

    const page = await context.newPage();
    await page.goto(`/products/${product.product.id}`);
    await expect(
      page.getByRole("heading", { name: product.product.name, exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "SBOM evidence", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: "Release", exact: true }),
    ).toContainText(release.release.label);

    const valid = await uploadFixture(page, {
      runId,
      fixture: sbomValidationFixtures.valid,
      buttonName: "Upload SBOM",
    });
    await runSbomWorkerOnce();
    await expectReportStatus(context.request, valid.sourceId, "valid");
    await page.reload();
    await expectReport(page, "Valid", valid.fileName);

    const invalid = await uploadFixture(page, {
      runId,
      fixture: sbomValidationFixtures.invalid,
      buttonName: "Upload SBOM",
    });
    await runSbomWorkerOnce();
    const invalidReport = await expectReportStatus(
      context.request,
      invalid.sourceId,
      "invalid",
    );
    expect(invalidReport.report.errorCount).toBeGreaterThan(0);
    await page.reload();
    await expectReport(page, "Invalid", invalid.fileName);
    await page.getByRole("button", { name: /^Errors [1-9]/u }).click();
    await expect(
      page.getByRole("table", { name: "SBOM diagnostics" }),
    ).toBeVisible();
    await expect(
      page.getByText("schema_violation", { exact: true }),
    ).toBeVisible();
    await captureValidationScreenshot(page, testInfo, {
      attachmentName: "desktop invalid SBOM diagnostics",
      fileName: "sbom-validation-desktop-invalid-diagnostics.png",
    });

    await page
      .getByRole("button", { name: "Upload corrected version", exact: true })
      .click();
    await expect(
      page.getByText(
        "Choose a corrected SBOM. The previous evidence remains immutable.",
      ),
    ).toBeVisible();
    const corrected = await uploadFixture(page, {
      runId,
      fixture: sbomValidationFixtures.corrected,
      buttonName: "Upload corrected SBOM",
    });
    expect(corrected.sourceId).not.toBe(invalid.sourceId);
    await runSbomWorkerOnce();
    await expectReportStatus(context.request, corrected.sourceId, "valid");
    const history = await sourceHistory(
      context.request,
      product.product.id,
      release.release.id,
    );
    expect(history.sources.map((item) => item.source.fileName)).toEqual(
      expect.arrayContaining([
        valid.fileName,
        invalid.fileName,
        corrected.fileName,
      ]),
    );
    expect(
      history.sources.find((item) => item.source.id === invalid.sourceId),
    ).toMatchObject({
      validation: { status: "invalid" },
    });
    expect(
      history.sources.find((item) => item.source.id === corrected.sourceId),
    ).toMatchObject({
      source: { supersedesSourceId: invalid.sourceId },
      validation: { status: "valid" },
    });
    await captureMobileValidationScreenshot(testInfo, {
      browser,
      productId: product.product.id,
      correctedFileName: corrected.fileName,
    });
  } finally {
    await context.close();
  }
});

async function currentSession(
  request: APIRequestContext,
): Promise<SessionResponse> {
  const response = await request.get(
    `${LIVE_API_ORIGIN}${API_PREFIX}/auth/session`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as SessionResponse;
}

async function defaultLegalEntityId(
  request: APIRequestContext,
): Promise<string> {
  const response = await request.get(
    `${LIVE_API_ORIGIN}${API_PREFIX}/organizations/current/legal-entities`,
  );
  expect(response.status()).toBe(200);
  const body = (await response.json()) as LegalEntitiesResponse;
  const legalEntity = body.legalEntities.find(
    (candidate) =>
      candidate.status === "active" &&
      candidate.completionStatus === "complete" &&
      candidate.identifier === "default",
  );
  if (!legalEntity)
    throw new Error("Seed owner has no active default legal entity");
  return legalEntity.id;
}

async function createProduct(
  request: APIRequestContext,
  input: Readonly<{ runId: string; ownerId: string; legalEntityId: string }>,
): Promise<ProductResponse> {
  const response = await request.post(
    `${LIVE_API_ORIGIN}${API_PREFIX}/products`,
    {
      data: {
        name: `E2E SBOM ${input.runId}`,
        internalCode: `E2E-SBOM-${input.runId}`,
        productType: "standalone_software",
        description: "Run-scoped SBOM validation E2E product.",
        responsibleOwnerId: input.ownerId,
        legalEntityId: input.legalEntityId,
        idempotencyKey: randomUUID(),
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as ProductResponse;
}

async function createRelease(
  request: APIRequestContext,
  productId: string,
  runId: string,
): Promise<ReleaseResponse> {
  const response = await request.post(
    `${LIVE_API_ORIGIN}${API_PREFIX}/products/${productId}/releases`,
    {
      data: {
        label: `SBOM validation ${runId}`,
        version: `1.0.${runId.replaceAll("-", "")}`,
        description: "Run-scoped SBOM validation E2E release.",
        idempotencyKey: randomUUID(),
      },
    },
  );
  expect(response.status()).toBe(201);
  return (await response.json()) as ReleaseResponse;
}

async function uploadFixture(
  page: Page,
  input: Readonly<{
    runId: string;
    fixture: Readonly<{
      fileName: (runId: string) => string;
      mediaType: string;
      bytes: () => Buffer;
    }>;
    buttonName: string;
  }>,
): Promise<Readonly<{ sourceId: string; jobId: string; fileName: string }>> {
  const fileName = input.fixture.fileName(input.runId);
  await page.getByLabel("SBOM file", { exact: true }).setInputFiles({
    name: fileName,
    mimeType: input.fixture.mediaType,
    buffer: input.fixture.bytes(),
  });
  await expect(
    page.getByRole("button", { name: input.buttonName, exact: true }),
  ).toBeEnabled();
  const initialized = page.waitForResponse(
    (response) =>
      /\/api\/v1\/products\/[^/]+\/releases\/[^/]+\/sbom-uploads$/u.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === "POST",
  );
  const completed = page.waitForResponse(
    (response) =>
      /\/api\/v1\/sbom-uploads\/[^/]+\/complete$/u.test(
        new URL(response.url()).pathname,
      ) && response.request().method() === "POST",
  );
  await page
    .getByRole("button", { name: input.buttonName, exact: true })
    .click();
  const initializedResponse = await initialized;
  expect(initializedResponse.status()).toBe(201);
  const upload = (await initializedResponse.json()) as SbomUploadResponse;
  const completedResponse = await completed;
  expect(completedResponse.status()).toBe(202);
  const completion = (await completedResponse.json()) as SbomJobResponse;
  expect(completion.job.sourceId).toBe(upload.source.id);
  await expect(
    page.getByText("Original evidence is verified and queued for processing.", {
      exact: true,
    }),
  ).toBeVisible();
  return { sourceId: upload.source.id, jobId: completion.job.id, fileName };
}

async function runSbomWorkerOnce(): Promise<void> {
  const { stderr } = await execFileAsync(
    "pnpm",
    [
      "--filter",
      "api",
      "exec",
      "ts-node",
      "-r",
      "tsconfig-paths/register",
      "src/sbom-ingest-worker.ts",
      "--once",
    ],
    {
      cwd: REPO_ROOT,
      env: process.env,
      timeout: 60_000,
    },
  );
  expect(stderr).not.toContain("SBOM ingest worker cycle failed safely");
}

async function expectReportStatus(
  request: APIRequestContext,
  sourceId: string,
  status: "valid" | "invalid",
): Promise<SbomValidationReportResponse> {
  let latest: SbomValidationReportResponse | null = null;
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `${LIVE_API_ORIGIN}${API_PREFIX}/sbom-sources/${sourceId}/validation-report`,
        );
        expect(response.status()).toBe(200);
        latest = (await response.json()) as SbomValidationReportResponse;
        return latest.report.status;
      },
      { timeout: 60_000 },
    )
    .toBe(status);
  if (!latest) throw new Error("Validation report did not resolve");
  return latest;
}

async function sourceHistory(
  request: APIRequestContext,
  productId: string,
  releaseId: string,
): Promise<SbomSourceHistoryResponse> {
  const response = await request.get(
    `${LIVE_API_ORIGIN}${API_PREFIX}/products/${productId}/releases/${releaseId}/sbom-sources?limit=10`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()) as SbomSourceHistoryResponse;
}

async function expectReport(
  page: Page,
  label: string,
  fileName: string,
): Promise<void> {
  await expect(
    page.getByRole("heading", { name: "SBOM evidence", exact: true }),
  ).toBeVisible();
  await expect(page.getByText(fileName, { exact: true }).first()).toBeVisible();
  await expect(page.getByText(label, { exact: true }).first()).toBeVisible();
}

async function captureValidationScreenshot(
  page: Page,
  testInfo: TestInfo,
  input: Readonly<{ attachmentName: string; fileName: string }>,
): Promise<void> {
  const path = testInfo.outputPath(input.fileName);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(input.attachmentName, {
    path,
    contentType: "image/png",
  });
}

async function captureMobileValidationScreenshot(
  testInfo: TestInfo,
  input: Readonly<{
    browser: Browser;
    productId: string;
    correctedFileName: string;
  }>,
): Promise<void> {
  const mobileContext = await input.browser.newContext({
    baseURL: WEB_ORIGIN,
    viewport: MOBILE_VIEWPORT,
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  });
  try {
    expect((await signIn(mobileContext.request, OWNER_EMAIL)).status()).toBe(
      200,
    );
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(`/products/${input.productId}`);
    await expectReport(mobilePage, "Valid", input.correctedFileName);
    await expect(
      mobilePage.getByText("CycloneDX 1.6", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      mobilePage.getByText("Json", { exact: true }).first(),
    ).toBeVisible();
    await captureValidationScreenshot(mobilePage, testInfo, {
      attachmentName: "mobile corrected SBOM report",
      fileName: "sbom-validation-mobile-corrected-valid.png",
    });
  } finally {
    await mobileContext.close();
  }
}
