import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
  type TestInfo,
  type Route,
} from "@playwright/test";
import {
  sbomUploadInitializationResponseSchema,
  sbomUploadCompletionResponseSchema,
  sbomSourceHistoryResponseSchema,
  sbomValidationReportResponseSchema,
  sbomDocumentListResponseSchema,
  sbomDependencyTreeResponseSchema,
  sbomComponentSearchResponseSchema,
  sbomOriginalDownloadResponseSchema,
  sbomExportResponseSchema,
} from "@repo/contracts/sboms";
import { LIVE_API_ORIGIN, RunScopedAccounts, signIn } from "./helpers/accounts";
import { onboardSbomOrganization } from "./helpers/sbom-fixture";

/* eslint-disable turbo/no-undeclared-env-vars -- Live Playwright runs outside Turbo. */
const origin = process.env.E2E_WEB_ORIGIN ?? "http://localhost:3002";
const api = `${LIVE_API_ORIGIN}/api/v1`;
const root = resolve(process.cwd(), "../..");
const execute = promisify(execFile);
const digest = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

async function loseOneUploadResponse(
  page: Page,
  stage: "initialize" | "storage" | "complete",
  storageBytes: Buffer,
) {
  const path =
    stage === "initialize"
      ? /\/api\/v1\/products\/[^/]+\/releases\/[^/]+\/sbom-uploads$/u
      : stage === "complete"
        ? /\/api\/v1\/sbom-uploads\/[^/]+\/complete$/u
        : /\/storage\/v1\/object\/upload\/sign\//u;
  const requests: { method: string; body: string | null }[] = [];
  let lost = false;
  const handler = async (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.continue();
    requests.push({
      method: route.request().method(),
      body: route.request().postData(),
    });
    if (!lost) {
      lost = true;
      // WebKit does not expose a Blob PUT's body to the route interceptor.
      // Forward the exact selected fixture bytes before losing its response;
      // an empty intercepted PUT would test corrupt storage instead of retry.
      const response = await route.fetch(
        stage === "storage" ? { postData: storageBytes } : undefined,
      );
      expect(response.ok()).toBe(true);
      await route.abort("failed");
      return;
    }
    await route.continue();
  };
  await page.route(path, handler);
  return { requests, dispose: () => page.unroute(path, handler) };
}

const formats = [
  ...["1.4", "1.5", "1.6"].flatMap((version) => [
    {
      name: `cyclonedx-${version}.json`,
      mediaType: "application/vnd.cyclonedx+json",
      version,
      serialization: "json",
    },
    {
      name: `cyclonedx-${version}.xml`,
      mediaType: "application/vnd.cyclonedx+xml",
      version,
      serialization: "xml",
    },
  ]),
  ...["2.2", "2.3"].flatMap((version) => [
    {
      name: `spdx-${version}.json`,
      mediaType: "application/spdx+json",
      version,
      serialization: "json",
    },
    {
      name: `spdx-${version}.spdx`,
      mediaType: "text/plain",
      version,
      serialization: "tag_value",
    },
  ]),
  {
    name: "spdx-3.0.json",
    mediaType: "application/spdx+json",
    version: "3.0",
    serialization: "json",
  },
] as const;

async function capture(page: Page, info: TestInfo, label: string) {
  await page.screenshot({
    path: info.outputPath(`${label}-desktop.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    )
    .toBe(true);
  await page.screenshot({
    path: info.outputPath(`${label}-mobile.png`),
    fullPage: true,
  });
  await page.setViewportSize({ width: 1440, height: 1100 });
}

async function worker() {
  const result = await execute(
    "pnpm",
    ["--filter", "api", "exec", "node", "dist/sbom-ingest-worker.js", "--once"],
    { cwd: root, env: process.env, timeout: 120_000, maxBuffer: 1024 * 1024 },
  );
  expect(result.stderr).not.toContain("SBOM ingest worker cycle failed safely");
}

async function upload(
  request: APIRequestContext,
  productId: string,
  releaseId: string,
  fileName: string,
  mediaType: string,
  bytes: Buffer,
  supersedesSourceId?: string,
  verifyTerminalReplay = false,
) {
  const command = {
    productId,
    releaseId,
    fileName,
    mediaType,
    byteSize: bytes.length,
    sha256: digest(bytes),
    idempotencyKey: randomUUID(),
    ...(supersedesSourceId ? { supersedesSourceId } : {}),
  };
  const endpoint = `${api}/products/${productId}/releases/${releaseId}/sbom-uploads`;
  const initialized = await request.post(endpoint, { data: command });
  expect(initialized.status(), await initialized.text()).toBe(201);
  const result = sbomUploadInitializationResponseSchema.parse(
    await initialized.json(),
  );
  if (result.upload === null)
    throw new Error(
      "A fresh unique upload command unexpectedly replayed a terminal source",
    );
  const put = await request.put(result.upload.uploadUrl, {
    data: bytes,
    headers: { "content-type": mediaType },
  });
  expect(put.ok(), await put.text()).toBe(true);
  const completion = await request.post(
    `${api}/sbom-uploads/${result.source.id}/complete`,
    { data: { idempotencyKey: command.idempotencyKey } },
  );
  expect(completion.status(), `${fileName}: ${await completion.text()}`).toBe(
    202,
  );
  const job = sbomUploadCompletionResponseSchema.parse(await completion.json());
  expect(job.completion.sourceId).toBe(result.source.id);
  expect(job.job.sourceId).toBe(job.completion.canonicalSourceId);
  if (verifyTerminalReplay) {
    const replayResponse = await request.post(endpoint, { data: command });
    expect(replayResponse.status(), await replayResponse.text()).toBe(201);
    const replay = sbomUploadInitializationResponseSchema.parse(
      await replayResponse.json(),
    );
    expect(replay.source.id).toBe(result.source.id);
    expect(replay.source.status).toBe("verified");
    expect(replay.upload).toBeNull();
    expect("replayed" in replay && replay.replayed).toBe(true);
  }
  return result.source;
}

test("M3 streaming format validation preserves originals, pages history and exports scoped normalized graphs", async ({
  browser,
}, info) => {
  test.setTimeout(360_000);
  const fixtures = new RunScopedAccounts(info);
  const context = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 1100 },
  });
  const foreign = await browser.newContext({ baseURL: origin });
  let journeyFailure: unknown;
  let cleanupFailure: unknown;
  try {
    const account = await fixtures.createVerified(context, "m3-owner");
    const page = await context.newPage();
    const orgId = await onboardSbomOrganization(
      page,
      account.email,
      `E2E M3 ${randomUUID()}`,
    );
    fixtures.trackM3Organization(orgId);
    const legal = await context.request.get(
      `${api}/organizations/current/legal-entities`,
    );
    expect(legal.status()).toBe(200);
    const legalEntityId = (
      (await legal.json()) as { legalEntities: { id: string }[] }
    ).legalEntities[0]!.id;
    const productResult = await context.request.post(`${api}/products`, {
      data: {
        name: "M3 private format matrix",
        internalCode: `M3-${randomUUID()}`,
        productType: "standalone_software",
        responsibleOwnerId: account.publicUserId,
        legalEntityId,
        idempotencyKey: randomUUID(),
      },
    });
    expect(productResult.status()).toBe(201);
    const productId = (
      (await productResult.json()) as { product: { id: string } }
    ).product.id;
    const releaseResult = await context.request.post(
      `${api}/products/${productId}/releases`,
      {
        data: {
          label: "M3 matrix",
          version: "1.0.0",
          idempotencyKey: randomUUID(),
        },
      },
    );
    expect(releaseResult.status()).toBe(201);
    const releaseId = (
      (await releaseResult.json()) as { release: { id: string } }
    ).release.id;
    const sources: string[] = [];
    for (const format of formats) {
      const fixtureBytes = await readFile(
        resolve(root, "apps/api/src/sboms/validation/fixtures", format.name),
      );
      const bytes =
        format.name === "spdx-3.0.json"
          ? Buffer.from(
              JSON.stringify({
                ...JSON.parse(fixtureBytes.toString()),
                "@graph": [
                  ...JSON.parse(fixtureBytes.toString())["@graph"].map(
                    (element: Record<string, unknown>) =>
                      element.type === "software_Package"
                        ? {
                            ...element,
                            verifiedUsing: ["https://cra.test/spdx/hash"],
                          }
                        : element,
                  ),
                  {
                    type: "software_Package",
                    spdxId: "https://cra.test/spdx/dependency",
                    creationInfo: "_:creationinfo",
                    name: "dependency",
                    software_packageVersion: "2.0.0",
                    software_downloadLocation: "NOASSERTION",
                  },
                  {
                    type: "Relationship",
                    spdxId: "https://cra.test/spdx/relationship",
                    creationInfo: "_:creationinfo",
                    from: "https://cra.test/spdx/package",
                    to: ["https://cra.test/spdx/dependency"],
                    relationshipType: "dependsOn",
                  },
                  {
                    type: "Hash",
                    spdxId: "https://cra.test/spdx/hash",
                    algorithm: "sha256",
                    hashValue: "a".repeat(64),
                  },
                ],
              }),
            )
          : fixtureBytes;
      const source = await upload(
        context.request,
        productId,
        releaseId,
        format.name,
        format.mediaType,
        bytes,
        undefined,
        format.name === "cyclonedx-1.4.json",
      );
      sources.push(source.id);
      await worker();
      const validation = await context.request.get(
        `${api}/sbom-sources/${source.id}/validation-report`,
      );
      expect(validation.status()).toBe(200);
      const report = sbomValidationReportResponseSchema.parse(
        await validation.json(),
      );
      expect(report.report.status, format.name).toBe("valid");
      expect(report.report.detected).toMatchObject({
        specificationVersion: format.version,
        serialization: format.serialization,
      });
      console.info(`M3 validated ${format.name}`);
      const downloadResponse = await context.request.get(
        `${api}/sbom-sources/${source.id}/download`,
      );
      const download = sbomOriginalDownloadResponseSchema.parse(
        await downloadResponse.json(),
      );
      const original = await context.request.get(download.download.downloadUrl);
      expect(digest(await original.body())).toBe(source.sha256);
      expect(await original.body()).toEqual(bytes);
      if (format.name === "spdx-3.0.json") {
        const graphResponse = await context.request.get(
          `${api}/products/${productId}/releases/${releaseId}/sbom-documents?limit=100`,
        );
        const graphs = sbomDocumentListResponseSchema.parse(
          await graphResponse.json(),
        );
        const graph = graphs.documents.find(
          (item) => item.sourceId === source.id,
        );
        expect(graph?.dependencyCount).toBe(1);
        const treeResponse = await context.request.get(
          `${api}/sbom-documents/${graph!.id}/dependency-tree`,
        );
        const tree = sbomDependencyTreeResponseSchema.parse(
          await treeResponse.json(),
        );
        expect(tree.items.some((item) => item.childCount === 1)).toBe(true);
        const components = sbomComponentSearchResponseSchema.parse(
          await (
            await context.request.get(
              `${api}/sbom-documents/${graph!.id}/components`,
            )
          ).json(),
        );
        expect(
          components.components.some((item) =>
            item.hashes.some(
              (hash) =>
                hash.algorithm === "SHA256" && hash.value === "a".repeat(64),
            ),
          ),
        ).toBe(true);
      }
    }
    const invalidBytes = Buffer.from(
      '{"bomFormat":"CycloneDX","specVersion":"1.6","version":1,"components":[{"type":"library","bom-ref":"invalid"}]}',
    );
    const invalid = await upload(
      context.request,
      productId,
      releaseId,
      "invalid.cdx.json",
      "application/vnd.cyclonedx+json",
      invalidBytes,
    );
    await worker();
    const invalidResponse = await context.request.get(
      `${api}/sbom-sources/${invalid.id}/validation-report`,
    );
    const invalidReport = sbomValidationReportResponseSchema.parse(
      await invalidResponse.json(),
    );
    expect(invalidReport.report.status).toBe("invalid");
    expect(invalidReport.report.errorCount).toBeGreaterThan(0);
    const correctedBytes = await readFile(
      resolve(
        root,
        "apps/api/src/sboms/validation/fixtures/cyclonedx-1.6.json",
      ),
    );
    const corrected = await upload(
      context.request,
      productId,
      releaseId,
      "corrected.cdx.json",
      "application/vnd.cyclonedx+json",
      correctedBytes,
      invalid.id,
    );
    await worker();
    const correctedReport = sbomValidationReportResponseSchema.parse(
      await (
        await context.request.get(
          `${api}/sbom-sources/${corrected.id}/validation-report`,
        )
      ).json(),
    );
    expect(correctedReport.source.id).toBe(corrected.id);
    expect(correctedReport.report.status).toBe("valid");
    expect(correctedReport.report.validator).not.toBeNull();
    sources.push(invalid.id, corrected.id);
    const historyEndpoint = `${api}/products/${productId}/releases/${releaseId}/sbom-sources?limit=10`;
    const firstPage = sbomSourceHistoryResponseSchema.parse(
      await (await context.request.get(historyEndpoint)).json(),
    );
    expect(firstPage.sources).toHaveLength(10);
    expect(
      firstPage.sources.find(({ source }) => source.id === corrected.id)
        ?.validation.status,
    ).toBe("valid");
    expect(firstPage.nextCursor).not.toBeNull();
    const secondPage = sbomSourceHistoryResponseSchema.parse(
      await (
        await context.request.get(
          `${historyEndpoint}&cursor=${encodeURIComponent(firstPage.nextCursor!)}`,
        )
      ).json(),
    );
    expect(secondPage.sources).toHaveLength(3);
    expect(secondPage.nextCursor).toBeNull();
    expect(
      new Set(
        [...firstPage.sources, ...secondPage.sources].map(
          ({ source }) => source.id,
        ),
      ),
    ).toEqual(new Set(sources));
    if (process.env.E2E_M3_READ_LOAD === "true") {
      const timings: number[] = [];
      const statuses: number[] = [];
      for (let sample = 0; sample < 30; sample += 1) {
        const started = performance.now();
        const response = await context.request.get(historyEndpoint);
        statuses.push(response.status());
        if (response.status() !== 200) break;
        sbomSourceHistoryResponseSchema.parse(await response.json());
        timings.push(performance.now() - started);
      }
      const sorted = [...timings].sort((left, right) => left - right);
      const timingPath = info.outputPath("m3-bounded-read-timings.json");
      await writeFile(
        timingPath,
        JSON.stringify(
          {
            scope:
              "Local authenticated Nest API, one private release, limit 10; not production load",
            samples: timings.length,
            statuses,
            p95Milliseconds:
              sorted[Math.ceil(sorted.length * 0.95) - 1] ?? null,
            p99Milliseconds:
              sorted[Math.ceil(sorted.length * 0.99) - 1] ?? null,
            timingsMilliseconds: timings,
          },
          null,
          2,
        ),
      );
      await info.attach("m3-bounded-read-timings", {
        path: timingPath,
        contentType: "application/json",
      });
      // Respect the existing shared minute window before the browser's many
      // parallel workspace reads; no rate limit or production config changes.
      await new Promise((resolve) => setTimeout(resolve, 60_100));
    }
    await page.goto(`/products/${productId}`);
    await expect(
      page.getByRole("heading", { name: "SBOM evidence", exact: true }),
    ).toBeVisible();
    await capture(page, info, "m3-validated-history");
    await page
      .getByRole("button", { name: "Load older sources", exact: true })
      .click();
    await expect(
      page.getByText(formats[0]!.name, { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Load older sources", exact: true }),
    ).toHaveCount(0);
    await capture(page, info, "m3-history-older-page");
    const docsResponse = await context.request.get(
      `${api}/products/${productId}/releases/${releaseId}/sbom-documents?limit=100`,
    );
    expect(docsResponse.status()).toBe(200);
    const documents = sbomDocumentListResponseSchema.parse(
      await docsResponse.json(),
    );
    // Identical corrected bytes reuse the existing immutable graph; the source
    // alias is exact evidence attribution, not a second normalized document.
    const document = documents.documents.find(
      (item) => item.sourceId === corrected.id,
    );
    expect(document).toBeDefined();
    for (const format of ["cyclonedx", "spdx"] as const) {
      const response = await context.request.get(
        `${api}/sbom-documents/${document!.id}/export?sourceId=${corrected.id}&format=${format}`,
      );
      expect(response.status()).toBe(200);
      const exported = sbomExportResponseSchema.parse(
        await response.json(),
      ).export;
      expect(digest(Buffer.from(exported.content))).toBe(exported.sha256);
      expect(exported.vex.status).toBe("not_requested");
      const roundTrip = await upload(
        context.request,
        productId,
        releaseId,
        exported.fileName,
        exported.mediaType,
        Buffer.from(exported.content),
      );
      await worker();
      const validation = sbomValidationReportResponseSchema.parse(
        await (
          await context.request.get(
            `${api}/sbom-sources/${roundTrip.id}/validation-report`,
          )
        ).json(),
      );
      expect(validation.report.status).toBe("valid");
    }
    expect(
      (
        await context.request.get(
          `${api}/sbom-documents/${document!.id}/export?sourceId=${corrected.id}&format=spdx&includeVex=true`,
        )
      ).status(),
    ).toBe(400);
    expect(
      (
        await context.request.get(
          `${api}/sbom-documents/${document!.id}/export?sourceId=${corrected.id}&format=cyclonedx&includeVex=true`,
        )
      ).status(),
    ).toBe(409);
    await page.goto(
      `/products/${productId}/sboms/${document!.id}?sourceId=${corrected.id}`,
    );
    await expect(
      page.getByRole("combobox", { name: "Export format", exact: true }),
    ).toBeVisible();
    for (const format of ["cyclonedx", "spdx"]) {
      await page
        .getByRole("combobox", { name: "Export format", exact: true })
        .selectOption(format);
      const downloaded = page.waitForEvent("download");
      await page
        .getByRole("button", { name: "Download SBOM export", exact: true })
        .click();
      const file = await downloaded;
      expect(file.suggestedFilename()).toMatch(/\.(?:cdx|spdx)\.json$/u);
      const path = await file.path();
      expect(path).not.toBeNull();
      expect(JSON.parse(await readFile(path!, "utf8"))).toBeTruthy();
      await capture(page, info, `m3-normalized-${format}-export`);
    }
    await page.goto(`/products/${productId}`);
    // A response is lost after the real server accepts each operation. Only an
    // explicit user action may retry; unchanged command identities stay stable.
    for (const stage of ["initialize", "storage", "complete"] as const) {
      await page.reload();
      await page.getByLabel("SBOM file", { exact: true }).setInputFiles({
        name: `manual-retry-${stage}.cdx.json`,
        mimeType: "application/vnd.cyclonedx+json",
        buffer: correctedBytes,
      });
      const loss = await loseOneUploadResponse(page, stage, correctedBytes);
      try {
        console.info(`M3 testing explicit ${stage} response-loss retry`);
        await page
          .getByRole("button", { name: "Upload SBOM", exact: true })
          .click();
        const retry = page.getByRole("button", {
          name:
            stage === "initialize" ? "Upload SBOM" : "Complete uploaded file",
          exact: true,
        });
        await expect(retry).toBeEnabled();
        expect(loss.requests).toHaveLength(1);
        await capture(page, info, `m3-${stage}-recoverable`);
        await retry.click();
        try {
          await expect(
            page.getByText(
              "Original evidence is verified and queued for processing.",
              { exact: true },
            ),
          ).toBeVisible();
        } catch (error) {
          console.info(
            `M3 ${stage} retry alerts`,
            await page.getByRole("alert").allTextContents(),
          );
          console.info(
            `M3 ${stage} retry commands`,
            loss.requests.map(({ method, body }) => ({
              method,
              hasBody: body !== null,
            })),
          );
          throw error;
        }
        if (stage === "initialize" || stage === "complete") {
          expect(loss.requests).toHaveLength(2);
          expect(loss.requests[1]?.body).toBe(loss.requests[0]?.body);
        }
        await capture(page, info, `m3-${stage}-manual-retry`);
      } finally {
        await loss.dispose();
      }
      await worker();
    }
    expect((await signIn(foreign.request, "viewer@cra.test")).status()).toBe(
      200,
    );
    for (const endpoint of [
      `/sbom-sources/${corrected.id}/download`,
      `/sbom-sources/${corrected.id}/validation-report`,
      `/sbom-documents/${document!.id}/export?sourceId=${corrected.id}&format=cyclonedx`,
    ])
      expect((await foreign.request.get(`${api}${endpoint}`)).status()).toBe(
        404,
      );
    await capture(page, info, "m3-scoped-export-history");
  } catch (error) {
    journeyFailure = error;
  } finally {
    await Promise.all([context.close(), foreign.close()]);
    try {
      await fixtures.cleanup();
    } catch (error) {
      cleanupFailure = error;
    }
  }
  if (journeyFailure && cleanupFailure)
    throw new AggregateError(
      [journeyFailure, cleanupFailure],
      "M3 journey and exact cleanup failed",
    );
  if (cleanupFailure) throw cleanupFailure;
  if (journeyFailure) throw journeyFailure;
});
