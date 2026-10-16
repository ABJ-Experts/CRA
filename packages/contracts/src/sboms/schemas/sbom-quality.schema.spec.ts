import { describe, expect, it } from "vitest";

import {
  sbomQualityProfileSchema,
  sbomQualityInputsSchema,
  sbomQualityDimensionSchema,
  sbomQualityFindingsQuerySchema,
  sbomQualityReportResponseSchema,
  sbomQualitySettingsResponseSchema,
  updateSbomQualitySettingsInputSchema,
} from "./sbom-quality.schema.js";

const now = "2026-08-24T00:00:00.000Z";
const sourceId = "00000000-0000-4000-8000-000000000001";
const reportId = "00000000-0000-4000-8000-000000000002";

describe("SBOM quality contracts", () => {
  it("parses pinned source technical check metadata without changing historical reports", () => {
    const legacy = {
      enabled: true,
      status: "warning",
      rulesetVersion: "bsi-tr-03183-2.v2.0.0",
      findingCount: 1,
    };
    expect(sbomQualityProfileSchema.parse(legacy)).toEqual(legacy);
    const pinned = {
      ...legacy,
      assessmentKind: "pinned_technical_checks",
      sourceSha256: "a".repeat(64),
      evaluatorVersion: "bsi-technical.v1",
      passedRuleCount: 2,
      failedRuleCount: 0,
      manualReviewRuleCount: 1,
    };
    expect(sbomQualityProfileSchema.parse(pinned)).toEqual(pinned);
    expect(
      sbomQualityProfileSchema.safeParse({
        ...pinned,
        sourceSha256: "malformed",
      }).success,
    ).toBe(false);
    expect(
      sbomQualityProfileSchema.safeParse({ ...pinned, sourceSha256: undefined })
        .success,
    ).toBe(false);
    expect(
      sbomQualityProfileSchema.safeParse({ ...pinned, status: "valid" })
        .success,
    ).toBe(false);
  });

  it.each([
    { enabled: false, status: "warning" },
    { enabled: true, status: "warning", assessmentKind: "unavailable" },
    {
      enabled: true,
      status: "invalid",
      assessmentKind: "pinned_technical_checks",
      sourceSha256: "a".repeat(64),
      evaluatorVersion: "bsi-technical.v1",
      passedRuleCount: 1,
      failedRuleCount: 1,
      manualReviewRuleCount: 1,
      findingCount: 2,
    },
    {
      enabled: true,
      status: "warning",
      assessmentKind: "pinned_technical_checks",
      sourceSha256: "a".repeat(64),
      passedRuleCount: 1,
      failedRuleCount: 0,
      manualReviewRuleCount: 1,
    },
  ])("validates profile outcome consistency: %j", (fields) => {
    const result = sbomQualityProfileSchema.safeParse({
      rulesetVersion: "bsi-tr-03183-2.v2.0.0",
      findingCount: 1,
      ...fields,
    });
    expect(result.success).toBe(fields.status === "invalid");
  });

  it("parses an explainable completed report without conflating legal-floor coverage and depth", () => {
    const parsed = sbomQualityReportResponseSchema.parse({
      report: {
        id: reportId,
        sourceId,
        releaseId: "00000000-0000-4000-8000-000000000003",
        documentId: "00000000-0000-4000-8000-000000000004",
        state: "completed",
        assessmentStatus: "regression",
        formulaVersion: "sbom-quality.v1",
        rulesetVersion: "bsi-tr-03183-2.v2.0.0",
        configurationVersion: 2,
        inputs: {
          componentCount: 4,
          componentsWithCanonicalPurl: 3,
          componentsWithValidHash: 4,
          componentsWithSupplier: 2,
          componentsWithLicense: 4,
          primaryComponentIdentified: true,
          primaryComponentDirectDependencyCount: 1,
          maximumDepth: 3,
        },
        dimensions: [
          {
            id: "purl",
            eligibleCount: 4,
            satisfiedCount: 3,
            coveragePercent: 75,
            score: 75,
            weight: 20,
            weightedScore: 15,
            status: "partial",
          },
          {
            id: "hash",
            eligibleCount: 4,
            satisfiedCount: 4,
            coveragePercent: 100,
            score: 100,
            weight: 20,
            weightedScore: 20,
            status: "complete",
          },
          {
            id: "supplier",
            eligibleCount: 4,
            satisfiedCount: 2,
            coveragePercent: 50,
            score: 50,
            weight: 15,
            weightedScore: 7.5,
            status: "partial",
          },
          {
            id: "license",
            eligibleCount: 4,
            satisfiedCount: 4,
            coveragePercent: 100,
            score: 100,
            weight: 15,
            weightedScore: 15,
            status: "complete",
          },
          {
            id: "top_level_dependency",
            eligibleCount: 1,
            satisfiedCount: 1,
            coveragePercent: 100,
            score: 100,
            weight: 20,
            weightedScore: 20,
            status: "complete",
          },
          {
            id: "transitive_depth",
            eligibleCount: 1,
            satisfiedCount: 1,
            coveragePercent: 100,
            score: 100,
            weight: 10,
            weightedScore: 10,
            status: "complete",
          },
        ],
        totalScore: 85,
        bsiProfile: {
          enabled: true,
          status: "warning",
          rulesetVersion: "bsi-tr-03183-2.v2.0.0",
          findingCount: 1,
        },
        baseline: {
          status: "available",
          reportId: "00000000-0000-4000-8000-000000000005",
          sourceId: "00000000-0000-4000-8000-000000000006",
          totalScore: 92,
          completedAt: now,
        },
        regression: {
          status: "regression",
          totalScoreDelta: -7,
          changedDimensions: ["purl"],
        },
        progress: {
          stage: "completed",
          percent: 100,
          message: "Quality report completed.",
        },
        error: null,
        completedAt: now,
        createdAt: now,
        updatedAt: now,
      },
    });

    expect(
      sbomQualityInputsSchema.safeParse({
        ...parsed.report.inputs,
        componentCount: 0,
      }).success,
    ).toBe(false);
    expect(
      sbomQualityInputsSchema.safeParse({
        ...parsed.report.inputs,
        primaryComponentIdentified: false,
      }).success,
    ).toBe(false);
    expect(
      sbomQualityDimensionSchema.safeParse({
        ...parsed.report.dimensions[0],
        satisfiedCount: 5,
      }).success,
    ).toBe(false);
    expect(
      sbomQualityReportResponseSchema.safeParse({
        report: {
          ...parsed.report,
          dimensions: [
            parsed.report.dimensions[0],
            parsed.report.dimensions[0],
          ],
        },
      }).success,
    ).toBe(false);
    for (const field of [
      "assessmentStatus",
      "inputs",
      "totalScore",
      "bsiProfile",
      "baseline",
      "regression",
      "completedAt",
    ] as const) {
      expect(
        sbomQualityReportResponseSchema.safeParse({
          report: { ...parsed.report, [field]: null },
        }).success,
      ).toBe(false);
    }
    expect(
      sbomQualityReportResponseSchema.safeParse({
        report: { ...parsed.report, state: "failed", error: null },
      }).success,
    ).toBe(false);
    const error = {
      code: "provider_unavailable",
      message: "Retry this report",
      retryable: true,
    };
    expect(
      sbomQualityReportResponseSchema.safeParse({
        report: { ...parsed.report, error },
      }).success,
    ).toBe(false);
    expect(
      sbomQualityReportResponseSchema.safeParse({
        report: { ...parsed.report, state: "failed", error },
      }).success,
    ).toBe(true);
    expect(parsed.report.dimensions.map((dimension) => dimension.id)).toContain(
      "top_level_dependency",
    );
    expect(parsed.report.dimensions.map((dimension) => dimension.id)).toContain(
      "transitive_depth",
    );
    expect(parsed.report.regression.status).toBe("regression");
  });

  it("bounds finding cursors and locks tenant BSI configuration to the supported ruleset", () => {
    expect(
      sbomQualityFindingsQuerySchema.parse({
        limit: "50",
        severity: "warning",
        kind: "bsi_rule",
      }),
    ).toMatchObject({ limit: 50, severity: "warning", kind: "bsi_rule" });
    expect(
      updateSbomQualitySettingsInputSchema.safeParse({
        expectedVersion: 2,
        bsiProfileEnabled: true,
        rulesetVersion: "weakened-rules",
      }).success,
    ).toBe(false);
    expect(
      sbomQualitySettingsResponseSchema.parse({
        settings: {
          version: 2,
          bsiProfileEnabled: true,
          rulesetVersion: "bsi-tr-03183-2.v2.0.0",
          updatedAt: now,
        },
      }),
    ).toMatchObject({ settings: { bsiProfileEnabled: true } });
  });

  it("accepts each durable worker failure code exposed by a failed report", () => {
    for (const code of [
      "normalized_document_missing",
      "quality_persistence_unavailable",
      "quality_configuration_unavailable",
      "quality_source_missing",
      "quality_statement_timeout",
      "quality_calculation_failed",
      "provider_unavailable",
      "unexpected_failure",
    ]) {
      expect(
        sbomQualityReportResponseSchema.safeParse({
          report: {
            id: reportId,
            sourceId,
            releaseId: "00000000-0000-4000-8000-000000000003",
            documentId: "00000000-0000-4000-8000-000000000004",
            state: "failed",
            assessmentStatus: null,
            formulaVersion: "sbom-quality.v1",
            rulesetVersion: "bsi-tr-03183-2.v2.0.0",
            configurationVersion: 0,
            inputs: null,
            dimensions: [],
            totalScore: null,
            bsiProfile: null,
            baseline: null,
            regression: null,
            progress: {
              stage: "failed",
              percent: 0,
              message: "Calculation failed.",
            },
            error: { code, message: "Calculation failed.", retryable: true },
            completedAt: null,
            createdAt: now,
            updatedAt: now,
          },
        }).success,
      ).toBe(true);
    }
  });
});
