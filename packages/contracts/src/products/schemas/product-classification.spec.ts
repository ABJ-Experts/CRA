import { PRODUCT_CLASSIFICATION_POLICY } from "../policies/product-classification-policy.js";
import { describe, expect, it } from "vitest";
import {
  productClassificationAnswersSchema,
  saveProductClassificationInputSchema,
  productClassificationLatestQuerySchema,
  productClassificationRunSchema,
  productClassificationPolicySchema,
} from "./product-classification.schema.js";
const answers = {
  scope: "in_scope",
  criticalCoreFunction: "no",
  classIICoreFunction: "no",
  classICoreFunction: "no",
};
describe("classification boundaries", () => {
  it("rejects executable source links and duplicate questionnaire keys", () => {
    for (const url of [
      "javascript:alert(1)",
      "data:text/html,unsafe",
      "http://example.com",
    ])
      expect(
        productClassificationPolicySchema.safeParse({
          ...PRODUCT_CLASSIFICATION_POLICY,
          sourceRefs: [{ title: "Source", url }],
        }).success,
      ).toBe(false);
    expect(
      productClassificationPolicySchema.safeParse({
        ...PRODUCT_CLASSIFICATION_POLICY,
        questions: PRODUCT_CLASSIFICATION_POLICY.questions.map((question) => ({
          ...question,
          key: "scope",
        })),
      }).success,
    ).toBe(false);
  });
  it("rejects stale hidden answers and missing visible answers", () => {
    expect(
      productClassificationAnswersSchema.safeParse({
        ...answers,
        scope: "out_of_scope",
      }).success,
    ).toBe(false);
    expect(
      productClassificationAnswersSchema.safeParse({
        ...answers,
        criticalCoreFunction: "yes",
      }).success,
    ).toBe(false);
    expect(
      productClassificationAnswersSchema.safeParse({
        ...answers,
        criticalCoreFunction: null,
      }).success,
    ).toBe(false);
    expect(
      productClassificationAnswersSchema.safeParse({
        ...answers,
        classIICoreFunction: "undetermined",
      }).success,
    ).toBe(false);
    expect(
      productClassificationAnswersSchema.safeParse({
        ...answers,
        criticalCoreFunction: "yes",
        classIICoreFunction: null,
        classICoreFunction: null,
      }).success,
    ).toBe(true);
  });
  it("bounds and normalizes rationale, rejects caller result and approval", () => {
    const input = {
      expectedProductVersion: 0,
      expectedRevision: 0,
      policyVersion: "cra-human-declarations-v1",
      policyHash: "a".repeat(64),
      idempotencyKey: "00000000-0000-4000-8000-000000000001",
      answers,
      rationale: "  <script>alert(1)</script>  ",
    };
    expect(saveProductClassificationInputSchema.parse(input).rationale).toBe(
      "<script>alert(1)</script>",
    );
    for (const change of [
      { rationale: " " },
      { rationale: "x".repeat(4001) },
      { expectedRevision: -1 },
      { policyHash: "bad" },
      { classification: "critical" },
      { approved: true },
    ])
      expect(
        saveProductClassificationInputSchema.safeParse({ ...input, ...change })
          .success,
      ).toBe(false);
  });
  it("bounds latest IDs and rejects duplicates/foreign query fields", () => {
    const id = "00000000-0000-4000-8000-000000000001";
    expect(
      productClassificationLatestQuerySchema.parse({ productIds: id })
        .productIds,
    ).toEqual([id]);
    for (const productIds of [
      "",
      "invalid",
      `${id},${id}`,
      Array.from(
        { length: 101 },
        (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
      ).join(","),
    ])
      expect(
        productClassificationLatestQuerySchema.safeParse({ productIds })
          .success,
      ).toBe(false);
    expect(
      productClassificationLatestQuerySchema.safeParse({
        productIds: id,
        organizationId: id,
      }).success,
    ).toBe(false);
  });
  it("rejects missing run fields and inconsistent snapshot hash", () => {
    expect(productClassificationRunSchema.safeParse({}).success).toBe(false);
    const run = {
      id: "00000000-0000-4000-8000-000000000001",
      productId: "00000000-0000-4000-8000-000000000002",
      revision: 1,
      productVersion: 0,
      classification: "default",
      answers,
      rationale: "Reviewed",
      policySnapshot: PRODUCT_CLASSIFICATION_POLICY,
      policyHash: PRODUCT_CLASSIFICATION_POLICY.hash,
      createdBy: "00000000-0000-4000-8000-000000000003",
      createdAt: "2026-09-28T00:00:00.000Z",
      supersedesId: null,
    };
    expect(productClassificationRunSchema.parse(run)).toEqual(run);
    expect(
      productClassificationRunSchema.safeParse({
        ...run,
        policyHash: "a".repeat(64),
      }).success,
    ).toBe(false);
  });
});
