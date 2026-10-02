import { describe, expect, it } from "vitest";

import {
  createControlInputSchema,
  createControlMappingInputSchema,
  controlStatusSchema,
  requirementCoverageQuerySchema,
  requirementCoverageResponseSchema,
  setFrameworkApplicabilityInputSchema,
} from "./control.schema.js";

const key = "2f564a90-a9ef-46e9-afd8-b743866860ff";
const id = "00000000-0000-4000-8000-000000000001";

describe("framework control boundary schemas", () => {
  it("rejects hostile markup and unknown fields in controls", () => {
    const base = {
      title: "Security update policy",
      description: "Documented review process",
      ownerUserId: id,
      status: "not_started",
      expectedRevision: null,
      idempotencyKey: key,
    };
    expect(createControlInputSchema.safeParse(base).success).toBe(true);
    expect(
      createControlInputSchema.safeParse({
        ...base,
        title: "<script>x</script>",
      }).success,
    ).toBe(false);
    expect(
      createControlInputSchema.safeParse({ ...base, organizationId: id })
        .success,
    ).toBe(false);
  });

  it("requires explicit unique product applicability and stable requirement keys", () => {
    const base = {
      packKey: "cra",
      versionKey: "oj-2024-11-20",
      requirementKey: "annex-i-i-1",
      rationale: "Applies to this product",
      productIds: [id],
      expectedRevision: 2,
      idempotencyKey: key,
    };
    expect(createControlMappingInputSchema.safeParse(base).success).toBe(true);
    expect(
      createControlMappingInputSchema.safeParse({ ...base, productIds: [] })
        .success,
    ).toBe(false);
    expect(
      createControlMappingInputSchema.safeParse({
        ...base,
        productIds: [id, id],
      }).success,
    ).toBe(false);
  });

  it("keeps implementation status and coverage scope narrow", () => {
    expect(controlStatusSchema.safeParse("compliant").success).toBe(false);
    expect(
      requirementCoverageQuerySchema.safeParse({ productId: id }).success,
    ).toBe(true);
    expect(requirementCoverageQuerySchema.safeParse({}).success).toBe(false);
  });

  it("requires a reason and concurrency key for approved non-applicability", () => {
    const input = {
      productId: id,
      state: "not_applicable",
      reason: "This product has no network interface",
      expectedRevision: 0,
      idempotencyKey: key,
    };
    expect(setFrameworkApplicabilityInputSchema.safeParse(input).success).toBe(
      true,
    );
    expect(
      setFrameworkApplicabilityInputSchema.safeParse({ ...input, reason: "" })
        .success,
    ).toBe(false);
    expect(
      setFrameworkApplicabilityInputSchema.safeParse({
        ...input,
        reason: "<script>x</script>",
      }).success,
    ).toBe(false);
    expect(
      setFrameworkApplicabilityInputSchema.safeParse({
        ...input,
        organizationId: id,
      }).success,
    ).toBe(false);
    expect(
      setFrameworkApplicabilityInputSchema.safeParse({
        ...input,
        state: "applicable",
        reason: "Old approval",
      }).success,
    ).toBe(false);
  });

  it("requires a transparent scope summary and per-requirement gap state", () => {
    const response = {
      packKey: "cra",
      versionKey: "oj-2024-11-20",
      productId: id,
      calculation: { status: "current", calculatedAt: "2026-09-24T00:00:00Z" },
      summary: {
        totalRequirements: 1,
        applicableRequirements: 1,
        excludedRequirements: 0,
        evidenceBackedRequirements: 0,
        gapRequirements: 1,
      },
      requirements: [
        {
          requirementKey: "annex-i-i-1",
          identifier: "Annex I, Part I, 1",
          heading: null,
          text: "A requirement.",
          parentKey: null,
          assessable: true,
          applicability: { state: "applicable", reason: null, revision: 0 },
          coverageState: "no_mapping",
          remediation: { kind: "map_control", controlId: null },
          controls: [],
        },
      ],
      nextCursor: null,
    };
    expect(requirementCoverageResponseSchema.safeParse(response).success).toBe(
      true,
    );
    expect(
      requirementCoverageResponseSchema.safeParse({
        ...response,
        summary: { ...response.summary, gapRequirements: -1 },
      }).success,
    ).toBe(false);
    expect(
      requirementCoverageResponseSchema.safeParse({
        ...response,
        requirements: [
          { ...response.requirements[0], coverageState: "compliant" },
        ],
      }).success,
    ).toBe(false);
  });
});
