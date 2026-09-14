import { describe, expect, it } from "vitest";
import {
  addTechnicalFileSourceRequestSchema,
  updateTechnicalFileSectionRequestSchema,
} from "./technical-file.schema.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("technical-file schema boundaries", () => {
  it("requires an explicit reason for non-applicable hardware evidence", () => {
    expect(() =>
      updateTechnicalFileSectionRequestSchema.parse({
        expectedVersion: 1,
        narrative: null,
        applicability: "not_applicable",
        nonApplicabilityReason: null,
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("does not let a manual citation impersonate an internal source", () => {
    expect(() =>
      addTechnicalFileSourceRequestSchema.parse({
        expectedVersion: 1,
        sourceKind: "manual_reference",
        recordId: id,
        manualReference: {
          title: "EN 18031",
          editionOrRevision: null,
          issuer: null,
          locator: null,
          rationale: null,
        },
        idempotencyKey: id,
      }),
    ).toThrow();
  });
});
