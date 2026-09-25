import { describe, expect, it } from "vitest";

import {
  customFrameworkContentSchema,
  customFrameworkImportSchema,
  customFrameworkCommandInputSchema,
} from "./custom-framework.schema.js";

const content = {
  title: "Internal product controls",
  editionDate: "2026-09-25",
  language: "en",
  attribution: "Created by the organization",
  requirements: [
    {
      requirementKey: "control-1",
      identifier: "INT-1",
      parentKey: null,
      position: 1,
      heading: "Document design",
      text: "Keep design decisions available for review.",
      sourceReference: "Internal policy 1",
    },
  ],
} as const;

describe("customer-defined framework boundaries", () => {
  it("accepts a valid customer-defined content body", () => {
    expect(customFrameworkContentSchema.safeParse(content).success).toBe(true);
  });

  it("rejects markup, duplicate identifiers, and broken hierarchy", () => {
    const duplicate = customFrameworkContentSchema.safeParse({
      ...content,
      requirements: [
        content.requirements[0],
        { ...content.requirements[0], requirementKey: "control-2" },
      ],
    });
    expect(duplicate.success).toBe(false);
    if (!duplicate.success) {
      expect(duplicate.error.issues.map((issue) => issue.path)).toContainEqual([
        "requirements",
        1,
        "identifier",
      ]);
    }
    expect(
      customFrameworkContentSchema.safeParse({
        ...content,
        requirements: [
          { ...content.requirements[0], text: "<script>alert(1)</script>" },
        ],
      }).success,
    ).toBe(false);
    const missingParent = customFrameworkContentSchema.safeParse({
      ...content,
      requirements: [{ ...content.requirements[0], parentKey: "missing" }],
    });
    expect(missingParent.success).toBe(false);
    if (!missingParent.success) {
      expect(
        missingParent.error.issues.map((issue) => issue.path),
      ).toContainEqual(["requirements", 0, "parentKey"]);
    }
  });

  it("does not allow the client to supply an official or tenant key", () => {
    expect(
      customFrameworkImportSchema.safeParse({
        schemaVersion: 1,
        kind: "customer_defined",
        packKey: "cra-annex-i",
        content,
      }).success,
    ).toBe(false);
  });

  it("requires concurrency and idempotency information for writes", () => {
    expect(
      customFrameworkCommandInputSchema.safeParse({
        action: "publish",
        expectedRevision: 1,
      }).success,
    ).toBe(false);
  });
});
