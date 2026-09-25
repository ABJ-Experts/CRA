import { describe, expect, it } from "vitest";

import {
  curatedFrameworkRelationSchema,
  upsertFrameworkUpgradeDecisionInputSchema,
} from "./upgrade.schema.js";
import { frameworkPackImportSchema } from "./framework.schema.js";

const reference = {
  packKey: "cra-annex-i",
  versionKey: "oj-2024-11-20-en",
  requirementKey: "part-i-1",
};

describe("M10-04 wire contracts", () => {
  it("keeps one-way and uncertain curated relations explicit", () => {
    const parsed = curatedFrameworkRelationSchema.parse({
      id: "11111111-1111-4111-8111-111111111111",
      source: reference,
      target: { ...reference, packKey: "fixture-standard" },
      relationship: "uncertain",
      direction: "one_way",
      rationale: "A reviewer found only partial overlap.",
      provenance: "Approved review fixture",
      reviewer: "Fixture reviewer",
      reviewedAt: "2026-09-25T00:00:00Z",
      curated: true,
    });
    expect(parsed.relationship).toBe("uncertain");
    expect(parsed.direction).toBe("one_way");
  });

  it("rejects markup and unreviewed mapping decisions", () => {
    expect(
      curatedFrameworkRelationSchema.safeParse({
        id: "11111111-1111-4111-8111-111111111111",
        source: reference,
        target: reference,
        relationship: "equivalent",
        direction: "bidirectional",
        rationale: "<script>alert(1)</script>",
        provenance: "Fixture",
        reviewer: "Reviewer",
        reviewedAt: "2026-09-25T00:00:00Z",
        curated: true,
      }).success,
    ).toBe(false);
    expect(
      upsertFrameworkUpgradeDecisionInputSchema.safeParse({
        action: "map",
        targetRequirementKeys: [],
        expectedReviewRevision: 1,
        idempotencyKey: "11111111-1111-4111-8111-111111111111",
      }).success,
    ).toBe(false);
  });

  it("requires documented rights for a licensed standard import", () => {
    const payload = {
      schemaVersion: 1,
      packKey: "fixture-standard",
      versionKey: "test-1",
      title: "Approved test fixture",
      editionDate: "2026-09-25",
      language: "en",
      sourceUrl: "https://example.test/approved-fixture",
      sourcePublicationDate: "2026-09-25",
      attribution: "Test fixture only",
      reviewEvidence: "Test review record",
      sourceKind: "licensed_standard",
      requirements: [
        {
          requirementKey: "one",
          identifier: "One",
          parentKey: null,
          position: 1,
          heading: null,
          text: "Fixture text",
          sourceReference: "Fixture 1",
        },
      ],
    };
    expect(frameworkPackImportSchema.safeParse(payload).success).toBe(false);
    expect(
      frameworkPackImportSchema.safeParse({
        ...payload,
        editionLabel: "Fixture edition",
        distributionRights: "Licensed for this test deployment only.",
        rightsEvidence: "Written fixture approval for this test deployment.",
        reviewOwner: "Fixture reviewer",
        approvedAt: "2026-09-25T00:00:00Z",
      }).success,
    ).toBe(true);
  });
});
