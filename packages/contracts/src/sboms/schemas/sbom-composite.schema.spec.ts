import { describe, expect, it } from "vitest";

import {
  createSbomCompositeReviewInputSchema,
  resolveSbomCompositeConflictInputSchema,
  resolveSbomCompositeRelationshipInputSchema,
  sbomCompositeProvenanceManifestSchema,
} from "./sbom-composite.schema.js";

const ids = {
  source: "00000000-0000-4000-8000-000000000001",
  otherSource: "00000000-0000-4000-8000-000000000002",
  component: "00000000-0000-4000-8000-000000000003",
};
const idempotencyKey = "00000000-0000-4000-8000-000000000004";

describe("SBOM composite contracts", () => {
  it("requires a unique, non-empty deliberate source set", () => {
    expect(
      createSbomCompositeReviewInputSchema.parse({
        sourceIds: [ids.source, ids.otherSource],
        idempotencyKey,
      }),
    ).toMatchObject({ sourceIds: [ids.source, ids.otherSource] });
    expect(
      createSbomCompositeReviewInputSchema.safeParse({
        sourceIds: [ids.source, ids.source],
        idempotencyKey,
      }).success,
    ).toBe(false);
  });

  it("does not permit a conflict to be silently source-ordered", () => {
    expect(
      resolveSbomCompositeConflictInputSchema.safeParse({
        decision: "select_source_component",
        reason: "Reviewed supplier evidence.",
        idempotencyKey,
      }).success,
    ).toBe(false);
    expect(
      resolveSbomCompositeConflictInputSchema.parse({
        decision: "select_source_component",
        selectedComponentId: ids.component,
        reason: "Reviewed supplier evidence.",
        idempotencyKey,
      }),
    ).toMatchObject({ selectedComponentId: ids.component });
  });

  it("requires an explicit rationale for unresolved relationship disposition", () => {
    expect(
      resolveSbomCompositeRelationshipInputSchema.safeParse({
        decision: "exclude",
        reason: "",
        idempotencyKey,
      }).success,
    ).toBe(false);
  });

  it("carries traceable dependency provenance and retains retention warnings", () => {
    const manifest = sbomCompositeProvenanceManifestSchema.parse({
      reviewId: ids.component,
      sourceHashes: ["a".repeat(64)],
      mergeRulesVersion: "sbom-composite.v1",
      generatedAt: "2026-08-25T00:00:00.000Z",
      components: [],
      dependencies: [
        {
          compositeFromRef: "composite:a",
          compositeToRef: "composite:b",
          sourceId: ids.source,
          documentId: ids.otherSource,
          documentSha256: "b".repeat(64),
          sourceFromComponentRef: "source:a",
          sourceToComponentRef: "source:b",
          supplierSubmissionId: null,
          mergedAt: "2026-08-25T00:00:00.000Z",
          reviewDecisionId: null,
        },
      ],
    });
    expect(manifest.dependencies[0]).toMatchObject({
      compositeFromRef: "composite:a",
      sourceToComponentRef: "source:b",
    });
  });
});
