import { describe, expect, it } from "vitest";
import {
  addTechnicalFileSourceRequestSchema,
  technicalFileSourceSchema,
  technicalFileSourceKindSchema,
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

  it("allows the M7-02 risk register as a pinned internal evidence source", () => {
    expect(technicalFileSourceKindSchema.parse("risk_register")).toBe(
      "risk_register",
    );
  });

  it("accepts the version-pinned source metadata emitted by the readiness projection", () => {
    expect(
      technicalFileSourceSchema.parse({
        id,
        kind: "manual_reference",
        recordId: null,
        observedRevision: "EN 18031:2024",
        title: "EN 18031",
        editionOrRevision: "EN 18031:2024",
        issuer: "CEN",
        locator: "https://standards.example.test/en-18031",
        rationale: "Applies to the selected product release.",
        sourceFingerprint: "sha256:reference-v2",
        status: "stale",
        linkVersion: 2,
        staleAt: "2026-09-14T10:00:00.000Z",
        staleReason: "standard_edition_changed",
        currentObservedRevision: "EN 18031:2025",
        currentFingerprint: "sha256:reference-v3",
        reviewedAt: null,
        reviews: [
          {
            id: "00000000-0000-4000-8000-000000000002",
            sourceId: id,
            decision: "retain",
            rationale: "The cited edition remains applicable to this release.",
            previousObservedRevision: "EN 18031:2024",
            previousFingerprint: "sha256:reference-v2",
            reviewedObservedRevision: "EN 18031:2025",
            reviewedFingerprint: "sha256:reference-v3",
            reviewedByUserId: "00000000-0000-4000-8000-000000000003",
            createdAt: "2026-09-14T10:01:00.000Z",
          },
        ],
        createdAt: "2026-09-14T09:00:00.000Z",
      }),
    ).toMatchObject({
      staleReason: "standard_edition_changed",
      linkVersion: 2,
    });
  });
});
