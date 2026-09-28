import {
  publicQualityRegression,
  publicQualityResponse,
} from "./sbom-quality-wire";

describe("quality wire projection", () => {
  it("preserves signed score deltas and does not mutate comparisons", () => {
    const comparison = Object.freeze({
      status: "none" as const,
      totalScoreDelta: 93.33,
      changedDimensions: Object.freeze(["license" as const]),
    });
    expect(publicQualityRegression(comparison)).toEqual({
      status: "none",
      totalScoreDelta: 93.33,
      changedDimensions: [],
    });
    expect(comparison.changedDimensions).toEqual(["license"]);
    expect(
      publicQualityRegression({
        ...comparison,
        status: "regression",
        totalScoreDelta: -20,
      }).changedDimensions,
    ).toEqual(["license"]);
  });

  it("reads legacy improvement data and removes only internal baseline quality", () => {
    const original = qualityReport();
    const baseline = Object.freeze({
      status: "available",
      reportId: original.id,
      sourceId: original.sourceId,
      totalScore: 0,
      completedAt: original.completedAt,
      quality: { totalScore: 0 },
    });
    const regression = Object.freeze({
      status: "none",
      totalScoreDelta: 93.33,
      changedDimensions: ["license"],
    });
    const report = Object.freeze({ ...original, baseline, regression });
    const result = publicQualityResponse({ report });
    expect(result.report.regression).toEqual({
      status: "none",
      totalScoreDelta: 93.33,
      changedDimensions: [],
    });
    expect(result.report.baseline).not.toHaveProperty("quality");
    expect(baseline).toHaveProperty("quality");
    expect(regression.changedDimensions).toEqual(["license"]);
  });

  it("retains ordinary reports and actual regression dimensions", () => {
    const report = qualityReport();
    expect(publicQualityResponse({ report })).toEqual({ report });
    const regression = {
      status: "regression",
      totalScoreDelta: -20,
      changedDimensions: ["license"],
    };
    expect(
      publicQualityResponse({ report: { ...report, regression } }).report
        .regression,
    ).toEqual(regression);
  });

  it.each([
    null,
    {},
    { report: null },
    { report: { ...qualityReport(), extra: true } },
    {
      report: {
        ...qualityReport(),
        regression: {
          status: "none",
          totalScoreDelta: 20,
          changedDimensions: ["license"],
          extra: true,
        },
      },
    },
    {
      report: {
        ...qualityReport(),
        baseline: {
          status: "available",
          reportId: qualityReport().id,
          sourceId: qualityReport().sourceId,
          totalScore: 0,
          completedAt: qualityReport().completedAt,
          quality: {},
          extra: true,
        },
      },
    },
  ])("rejects invalid or undocumented persisted data %j", (value) => {
    expect(() => publicQualityResponse(value)).toThrow();
  });
});

function qualityReport() {
  const now = "2026-08-24T00:00:00.000Z";
  return {
    id: "77777777-7777-4777-8777-777777777777",
    sourceId: "33333333-3333-4333-8333-333333333333",
    releaseId: "88888888-8888-4888-8888-888888888888",
    documentId: "99999999-9999-4999-8999-999999999999",
    state: "completed",
    assessmentStatus: "valid",
    formulaVersion: "sbom-quality.v1",
    rulesetVersion: "bsi-tr-03183-2.v2.0.0",
    configurationVersion: 1,
    inputs: {
      componentCount: 0,
      componentsWithCanonicalPurl: 0,
      componentsWithValidHash: 0,
      componentsWithSupplier: 0,
      componentsWithLicense: 0,
      primaryComponentIdentified: false,
      primaryComponentDirectDependencyCount: 0,
      maximumDepth: 0,
    },
    dimensions: [
      {
        id: "purl",
        eligibleCount: 0,
        satisfiedCount: 0,
        coveragePercent: 0,
        score: 0,
        weight: 20,
        weightedScore: 0,
        status: "not_assessable",
      },
    ],
    totalScore: 0,
    bsiProfile: {
      enabled: false,
      status: "disabled",
      rulesetVersion: "bsi-tr-03183-2.v2.0.0",
      findingCount: 0,
    },
    baseline: { status: "first_document" },
    regression: {
      status: "none",
      totalScoreDelta: 0,
      changedDimensions: [],
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
  };
}
