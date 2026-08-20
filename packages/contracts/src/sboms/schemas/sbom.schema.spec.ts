import { describe, expect, it } from "vitest";

import {
  ciInitializeSbomUploadInputSchema,
  completeSbomUploadInputSchema,
  createSbomCiCredentialInputSchema,
  initializeSbomUploadInputSchema,
  sbomJobResponseSchema,
  sbomJobSchema,
  sbomOriginalDownloadResponseSchema,
  sbomUploadInitializationResponseSchema,
} from "./index.js";

const idempotencyKey = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const releaseId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const now = "2026-08-20T12:00:00.000Z";

const initializeInput = {
  productId,
  releaseId,
  fileName: "firmware-bom.cdx.json",
  mediaType: "application/vnd.cyclonedx+json",
  byteSize: 1024,
  sha256: "a".repeat(64),
  idempotencyKey,
};

describe("SBOM intake contracts", () => {
  it("accepts bounded SBOM upload initialization metadata", () => {
    expect(
      initializeSbomUploadInputSchema.parse(initializeInput),
    ).toMatchObject({
      source: "manual_upload",
      byteSize: 1024,
    });
    expect(
      ciInitializeSbomUploadInputSchema.parse({
        ...initializeInput,
        source: "ci_upload",
      }).source,
    ).toBe("ci_upload");
  });

  it("rejects zero-byte, oversized, unsupported, malformed, and unsafe uploads", () => {
    for (const input of [
      { ...initializeInput, byteSize: 0 },
      { ...initializeInput, byteSize: 104_857_601 },
      { ...initializeInput, mediaType: "image/png" },
      { ...initializeInput, sha256: "A".repeat(64) },
      { ...initializeInput, fileName: "../tenant-a.json" },
      { ...initializeInput, fileName: "report\u0000.json" },
      { ...initializeInput, fileName: "x".repeat(256) },
      { ...initializeInput, unknown: true },
    ]) {
      expect(initializeSbomUploadInputSchema.safeParse(input).success).toBe(
        false,
      );
    }
  });

  it("forces CI uploads to ci_upload and uses opaque source completion", () => {
    expect(
      ciInitializeSbomUploadInputSchema.safeParse({
        ...initializeInput,
        source: "manual_upload",
      }).success,
    ).toBe(false);
    expect(completeSbomUploadInputSchema.parse({ idempotencyKey })).toEqual({
      idempotencyKey,
    });
  });

  it("exposes only transient signed upload and download URLs", () => {
    expect(
      sbomUploadInitializationResponseSchema.parse({
        source: {
          id: sourceId,
          organizationId: "66666666-6666-4666-8666-666666666666",
          productId,
          releaseId,
          source: "manual_upload",
          fileName: "firmware-bom.cdx.json",
          mediaType: "application/vnd.cyclonedx+json",
          byteSize: 1024,
          sha256: "a".repeat(64),
          status: "upload_pending",
          createdAt: now,
          completedAt: null,
        },
        upload: {
          uploadUrl:
            "http://127.0.0.1:54321/storage/v1/object/upload/sign/sbom-originals/key",
          expiresAt: now,
        },
      }).upload.uploadUrl,
    ).toContain("/storage/");

    expect(
      sbomOriginalDownloadResponseSchema.parse({
        download: {
          downloadUrl: "https://example.test/signed-download",
          expiresAt: now,
          fileName: "firmware-bom.cdx.json",
          mediaType: "application/vnd.cyclonedx+json",
        },
      }).download.fileName,
    ).toBe("firmware-bom.cdx.json");
  });

  it("defines durable queued and terminal job resources", () => {
    const job = {
      id: jobId,
      organizationId: "66666666-6666-4666-8666-666666666666",
      sourceId,
      releaseId,
      inputSha256: "a".repeat(64),
      correlationId: "77777777-7777-4777-8777-777777777777",
      status: "queued",
      progress: { stage: "queued", percent: 0, message: "Queued" },
      attempts: 0,
      maxAttempts: 5,
      error: null,
      result: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
    };

    expect(sbomJobSchema.parse(job).status).toBe("queued");
    expect(
      sbomJobResponseSchema.parse({
        job,
        progressUrl: `/api/v1/sbom-jobs/${jobId}`,
      }).progressUrl,
    ).toBe(`/api/v1/sbom-jobs/${jobId}`);
  });

  it("requires a bounded human-safe CI credential label", () => {
    expect(
      createSbomCiCredentialInputSchema.parse({
        label: "GitHub release pipeline",
        idempotencyKey,
      }).label,
    ).toBe("GitHub release pipeline");
    expect(
      createSbomCiCredentialInputSchema.safeParse({
        label: " ",
        idempotencyKey,
      }).success,
    ).toBe(false);
  });
});
