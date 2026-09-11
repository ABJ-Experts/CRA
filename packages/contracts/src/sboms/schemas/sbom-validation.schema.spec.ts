import { describe, expect, expectTypeOf, it } from "vitest";

import type {
  SbomSourceHistoryResponse,
  SbomValidationReport,
  SbomValidationReportResponse,
} from "../types/index.js";
import {
  initializeSbomUploadInputSchema,
  sbomSourceHistoryQuerySchema,
  sbomSourceHistoryResponseSchema,
  sbomValidationDiagnosticSchema,
  sbomValidationReportResponseSchema,
  sbomValidationReportSchema,
  sbomValidationStatusSchema,
} from "./index.js";

const productId = "22222222-2222-4222-8222-222222222222";
const releaseId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";
const supersededSourceId = "88888888-8888-4888-8888-888888888888";
const organizationId = "66666666-6666-4666-8666-666666666666";
const now = "2026-08-20T12:00:00.000Z";

const baseReport = {
  status: "valid_with_warnings",
  detected: {
    format: "cyclonedx",
    serialization: "json",
    specificationVersion: "1.6",
  },
  validator: {
    name: "CRA deterministic SBOM validator",
    version: "2026.08.21",
    schemaAssetSha256: "c".repeat(64),
  },
  diagnostics: [
    {
      severity: "warning",
      code: "declared_media_type_mismatch",
      location: "$",
      message: "Declared media type did not match detected SBOM serialization.",
      remediation: "Review the upload metadata and resubmit if it is incorrect.",
    },
  ],
  errorCount: 0,
  warningCount: 1,
  omittedDiagnosticCount: 0,
  completedAt: now,
} as const;

const baseSource = {
  id: sourceId,
  organizationId,
  productId,
  releaseId,
  source: "manual_upload",
  fileName: "firmware-bom.cdx.json",
  mediaType: "application/vnd.cyclonedx+json",
  byteSize: 1024,
  sha256: "a".repeat(64),
  status: "verified",
  declaredFormat: "cyclonedx",
  declaredSpecVersion: "1.6",
  supersedesSourceId: supersededSourceId,
  createdAt: now,
  completedAt: now,
} as const;

describe("SBOM validation contracts", () => {
  it("accepts the four validation states and treats non-pending states as terminal", () => {
    expect(sbomValidationStatusSchema.options).toEqual([
      "pending",
      "valid",
      "valid_with_warnings",
      "invalid",
    ]);

    for (const status of ["valid", "valid_with_warnings", "invalid"] as const) {
      expect(
        sbomValidationReportSchema.parse({
          ...baseReport,
          status,
          completedAt: now,
        }).status,
      ).toBe(status);
    }

    expect(
      sbomValidationReportSchema.parse({
        ...baseReport,
        status: "pending",
        detected: null,
        validator: null,
        diagnostics: [],
        errorCount: 0,
        warningCount: 0,
        omittedDiagnosticCount: 0,
        completedAt: null,
      }).completedAt,
    ).toBeNull();
  });

  it("preserves diagnostic severity values without normalization", () => {
    expect(
      ["error", "warning"].map(
        (severity) =>
          sbomValidationDiagnosticSchema.parse({
            severity,
            code: "schema_violation",
            location: "$.components[0]",
            message: "The component is missing a required field.",
            remediation: "Add the missing field and upload a corrected source.",
          }).severity,
      ),
    ).toEqual(["error", "warning"]);
    expect(
      sbomValidationDiagnosticSchema.safeParse({
        ...baseReport.diagnostics[0],
        severity: "info",
      }).success,
    ).toBe(false);
  });

  it("rejects completion times that conflict with pending or terminal status", () => {
    expect(
      sbomValidationReportSchema.safeParse({
        ...baseReport,
        status: "pending",
        completedAt: now,
      }).success,
    ).toBe(false);

    expect(
      sbomValidationReportSchema.safeParse({
        ...baseReport,
        status: "invalid",
        completedAt: null,
      }).success,
    ).toBe(false);
  });

  it("caps returned diagnostics at 100 and records omitted diagnostics separately", () => {
    const diagnostic = baseReport.diagnostics[0];

    expect(
      sbomValidationReportSchema.parse({
        ...baseReport,
        diagnostics: Array.from({ length: 100 }, () => diagnostic),
        omittedDiagnosticCount: 12,
      }).omittedDiagnosticCount,
    ).toBe(12);

    expect(
      sbomValidationReportSchema.safeParse({
        ...baseReport,
        diagnostics: Array.from({ length: 101 }, () => diagnostic),
      }).success,
    ).toBe(false);
  });

  it("rejects unknown keys at every validation response boundary", () => {
    expect(
      sbomValidationDiagnosticSchema.safeParse({
        ...baseReport.diagnostics[0],
        storageKey: "tenant/private/path",
      }).success,
    ).toBe(false);
    expect(
      sbomValidationReportSchema.safeParse({
        ...baseReport,
        rawBytesPreview: "{}",
      }).success,
    ).toBe(false);
    expect(
      sbomValidationReportResponseSchema.safeParse({
        source: baseSource,
        report: baseReport,
        storage: { bucket: "sbom-originals" },
      }).success,
    ).toBe(false);
  });

  it("adds optional declared comparison metadata to upload initialization", () => {
    const parsed = initializeSbomUploadInputSchema.parse({
      productId,
      releaseId,
      fileName: "firmware-bom.spdx",
      mediaType: "text/plain",
      byteSize: 2048,
      sha256: "b".repeat(64),
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
      declaredFormat: "spdx",
      declaredSpecVersion: "2.3",
      supersedesSourceId: sourceId,
    });

    expect(parsed).toMatchObject({
      mediaType: "text/plain",
      declaredFormat: "spdx",
      declaredSpecVersion: "2.3",
      supersedesSourceId: sourceId,
    });
  });

  it("defines release-scoped source history pagination and report retrieval responses", () => {
    expect(
      sbomSourceHistoryQuerySchema.parse({ limit: "50", cursor: "next-page" }),
    ).toEqual({ limit: 50, cursor: "next-page" });

    const historyResponse = sbomSourceHistoryResponseSchema.parse({
      sources: [
        {
          source: baseSource,
          validation: {
            status: "valid_with_warnings",
            errorCount: 0,
            warningCount: 1,
            omittedDiagnosticCount: 0,
            completedAt: now,
          },
        },
      ],
      nextCursor: null,
    });
    const reportResponse = sbomValidationReportResponseSchema.parse({
      source: baseSource,
      report: baseReport,
    });

    expect(historyResponse.sources[0]?.validation.status).toBe(
      "valid_with_warnings",
    );
    expect(reportResponse.report.detected?.specificationVersion).toBe("1.6");
    expectTypeOf(historyResponse).toEqualTypeOf<SbomSourceHistoryResponse>();
    expectTypeOf(reportResponse).toEqualTypeOf<SbomValidationReportResponse>();
  });

  it("exports parsed z.output report types", () => {
    const parsed = sbomValidationReportSchema.parse(baseReport);

    expectTypeOf(parsed).toEqualTypeOf<SbomValidationReport>();
  });
});
