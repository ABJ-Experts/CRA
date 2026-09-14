import { describe, expect, it } from "vitest";
import {
  calculateTechnicalFileReadiness,
  reviewTechnicalFileSourceRequestSchema,
  signalTechnicalFileSourceMaterialChangeRequestSchema,
  technicalFileEvidenceLinkResponseSchema,
  technicalFileReadinessResponseSchema,
} from "./technical-file-readiness.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const timestamp = "2026-09-14T10:00:00.000Z";

describe("technical-file readiness schema boundaries", () => {
  it("makes stale applicable sections take precedence over completeness", () => {
    expect(
      calculateTechnicalFileReadiness([
        {
          sectionKey: "general_description",
          applicability: "applicable",
          narrativePresent: true,
          validEvidenceCount: 1,
          staleEvidenceCount: 1,
          unavailableEvidenceCount: 0,
        },
      ]),
    ).toEqual({
      overallStatus: "stale",
      applicableSectionCount: 1,
      completeSectionCount: 0,
      staleSectionCount: 1,
    });
  });

  it("excludes documented non-applicable sections from readiness", () => {
    expect(
      calculateTechnicalFileReadiness([
        {
          sectionKey: "test_reports",
          applicability: "not_applicable",
          narrativePresent: false,
          validEvidenceCount: 0,
          staleEvidenceCount: 0,
          unavailableEvidenceCount: 0,
        },
      ]),
    ).toMatchObject({ overallStatus: "complete", applicableSectionCount: 0 });
  });

  it("does not let an unavailable linked source count as complete evidence", () => {
    expect(
      calculateTechnicalFileReadiness([
        {
          sectionKey: "test_reports",
          applicability: "applicable",
          narrativePresent: true,
          validEvidenceCount: 1,
          staleEvidenceCount: 0,
          unavailableEvidenceCount: 1,
        },
      ]),
    ).toMatchObject({ overallStatus: "partial" });
  });

  it("represents legacy unavailable links without inventing a fingerprint", () => {
    expect(
      technicalFileEvidenceLinkResponseSchema.parse({
        source: {
          id,
          sectionId: "00000000-0000-4000-8000-000000000002",
          sectionKey: "release_sbom",
          sourceKind: "sbom_document",
          recordId: "00000000-0000-4000-8000-000000000003",
          linkVersion: 1,
          observedRevision: "legacy revision",
          sourceFingerprint: null,
          availability: "unavailable",
          staleAt: null,
          staleReason: null,
          currentObservedRevision: null,
          currentFingerprint: null,
          reviewedAt: null,
          createdAt: timestamp,
        },
      }),
    ).toMatchObject({ source: { availability: "unavailable" } });
  });

  it("requires a reason when a reviewer retains or updates a stale source", () => {
    expect(() =>
      reviewTechnicalFileSourceRequestSchema.parse({
        expectedVersion: 1,
        decision: "retain",
        rationale: "",
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("rejects timestamps as material-change evidence without version fingerprints", () => {
    expect(() =>
      signalTechnicalFileSourceMaterialChangeRequestSchema.parse({
        expectedVersion: 1,
        reason: "standard_edition_changed",
        currentObservedRevision: null,
        currentFingerprint: null,
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("does not accept a readiness response whose stale section has no reason", () => {
    expect(() =>
      technicalFileReadinessResponseSchema.parse({
        readiness: {
          technicalFileId: id,
          overallStatus: "stale",
          recalculationStatus: "current",
          calculatedAt: timestamp,
          sections: [
            {
              sectionKey: "general_description",
              status: "stale",
              gapCount: 0,
              validEvidenceCount: 1,
              staleEvidenceCount: 1,
              unavailableEvidenceCount: 0,
              gaps: [],
            },
          ],
          gaps: [],
        },
      }),
    ).toThrow();
  });
});
