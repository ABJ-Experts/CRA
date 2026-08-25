import { describe, expect, it } from "vitest";

import {
  sbomDiffReportResponseSchema,
  sbomDiffStartResponseSchema,
  sbomSourceDiffQuerySchema,
  sbomSourceDiffResponseSchema,
} from "./sbom-diff.schema.js";

const now = "2026-08-25T00:00:00.000Z";
const ids = {
  report: "00000000-0000-4000-8000-000000000001",
  release: "00000000-0000-4000-8000-000000000002",
  source: "00000000-0000-4000-8000-000000000003",
  baselineSource: "00000000-0000-4000-8000-000000000004",
  document: "00000000-0000-4000-8000-000000000005",
  baselineDocument: "00000000-0000-4000-8000-000000000006",
};

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: ids.report,
    releaseId: ids.release,
    sourceId: ids.source,
    baselineSourceId: ids.baselineSource,
    documentId: ids.document,
    baselineDocumentId: ids.baselineDocument,
    state: "completed",
    comparisonStatus: "identical",
    comparatorVersion: "m4-unavailable.v1",
    counts: { componentChanges: 0 },
    findingDelta: {
      status: "partial_integration_unavailable",
      reason: "Finding delta requires M4.",
      summary: null,
    },
    progress: { stage: "completed", percent: 100, message: "Completed." },
    error: null,
    completedAt: now,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

describe("SBOM diff contracts", () => {
  it("requires an explicit comparison state instead of deriving one from counts", () => {
    expect(
      sbomDiffReportResponseSchema.safeParse({ report: report() }).success,
    ).toBe(true);
    expect(
      sbomDiffReportResponseSchema.safeParse({
        report: report({ comparisonStatus: undefined }),
      }).success,
    ).toBe(false);
  });

  it("keeps source lookup read-only and validates an explicit lineage baseline", () => {
    expect(
      sbomSourceDiffQuerySchema.parse({ baseSourceId: ids.baselineSource }),
    ).toEqual({ baseSourceId: ids.baselineSource });
    expect(
      sbomSourceDiffQuerySchema.safeParse({ baseSourceId: "foreign" }).success,
    ).toBe(false);
    expect(
      sbomSourceDiffResponseSchema.parse({ status: "found", report: report() }),
    ).toMatchObject({ status: "found", report: { id: ids.report } });
  });

  it("keeps no-comparable results typed without creating a report", () => {
    expect(
      sbomDiffStartResponseSchema.parse({
        status: "no_comparable_version",
        sourceId: ids.source,
        reason: "No predecessor exists.",
      }),
    ).toMatchObject({ status: "no_comparable_version", sourceId: ids.source });
  });
});
