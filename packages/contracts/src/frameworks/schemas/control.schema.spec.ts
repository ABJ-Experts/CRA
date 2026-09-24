import { describe, expect, it } from "vitest";

import {
  createControlInputSchema,
  createControlMappingInputSchema,
  controlStatusSchema,
  requirementCoverageQuerySchema,
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
});
