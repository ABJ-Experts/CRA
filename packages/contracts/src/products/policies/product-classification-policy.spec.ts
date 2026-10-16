import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  deriveProductClassification,
  PRODUCT_CLASSIFICATION_POLICY,
} from "./product-classification-policy.js";
import { productClassificationPolicySchema } from "../schemas/product-classification.schema.js";
describe("provisional classification policy", () => {
  it.each([
    ["out_of_scope", null, null, null, "out_of_scope"],
    ["undetermined", null, null, null, "undetermined"],
    ["in_scope", "yes", null, null, "critical"],
    ["in_scope", "undetermined", null, null, "undetermined"],
    ["in_scope", "no", "yes", null, "important_class_ii"],
    ["in_scope", "no", "undetermined", null, "undetermined"],
    ["in_scope", "no", "no", "yes", "important_class_i"],
    ["in_scope", "no", "no", "undetermined", "undetermined"],
    ["in_scope", "no", "no", "no", "default"],
  ])(
    "derives %s/%s/%s/%s -> %s",
    (
      scope,
      criticalCoreFunction,
      classIICoreFunction,
      classICoreFunction,
      expected,
    ) => {
      expect(
        deriveProductClassification({
          scope,
          criticalCoreFunction,
          classIICoreFunction,
          classICoreFunction,
        }),
      ).toBe(expected);
    },
  );
  it("rejects unvalidated stale hidden declarations", () => {
    expect(() =>
      deriveProductClassification({
        scope: "out_of_scope",
        criticalCoreFunction: "yes",
        classIICoreFunction: null,
        classICoreFunction: null,
      }),
    ).toThrow();
  });
  it("records provisional, source-linked engineering metadata", () => {
    expect(
      productClassificationPolicySchema.parse(PRODUCT_CLASSIFICATION_POLICY)
        .status,
    ).toBe("engineering_provisional");
    expect(PRODUCT_CLASSIFICATION_POLICY.sourceRefs.length).toBeGreaterThan(0);
    const { hash, ...snapshot } = PRODUCT_CLASSIFICATION_POLICY;
    expect(
      createHash("sha256").update(JSON.stringify(snapshot)).digest("hex"),
    ).toBe(hash);
  });
});
