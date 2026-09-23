import { describe, expect, it } from "vitest";

import {
  createManualSupplierDocumentFieldInputSchema,
  decideSupplierDocumentFieldInputSchema,
  startSupplierDocumentExtractionInputSchema,
  supplierDocumentCandidateSchema,
  supplierDocumentExtractionResponseSchema,
  supplierDocumentModelOutputSchema,
  supplierDocumentExtractionQuerySchema,
} from "./supplier-document-extraction.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const timestamp = "2026-09-23T12:00:00.000Z";
const source = {
  productId: id,
  expectedRequestVersion: 3,
  expectedSubmissionUpdatedAt: timestamp,
  expectedEvidenceVersionId: id,
  expectedSha256: "a".repeat(64),
  idempotencyKey: otherId,
};
const candidate = {
  fieldKey: "certification_held",
  candidateGroup: "certificate-1",
  originalValue: "ISO 9001",
  confidence: 0.94,
  sourceSpan: { page: 2, startOffset: 5, endOffset: 13, quote: "ISO 9001" },
};

describe("supplier document extraction contracts", () => {
  it("requires immutable source pins and an idempotency key before extraction", () => {
    expect(startSupplierDocumentExtractionInputSchema.parse(source)).toEqual(
      source,
    );
    expect(() =>
      startSupplierDocumentExtractionInputSchema.parse({
        ...source,
        expectedSha256: "A".repeat(64),
      }),
    ).toThrow();
    expect(() =>
      startSupplierDocumentExtractionInputSchema.parse({
        ...source,
        tenantId: id,
      }),
    ).toThrow();
  });

  it("bounds extraction pages and keeps pagination cursors opaque", () => {
    expect(
      supplierDocumentExtractionQuerySchema.parse({ productId: id }),
    ).toEqual({
      productId: id,
      limit: 25,
    });
    expect(
      supplierDocumentExtractionQuerySchema.parse({
        productId: id,
        limit: "100",
        cursor: "opaque-keyset",
      }),
    ).toEqual({
      productId: id,
      limit: 100,
      cursor: "opaque-keyset",
    });
    expect(
      supplierDocumentExtractionQuerySchema.safeParse({
        productId: id,
        limit: 101,
      }).success,
    ).toBe(false);
    expect(
      supplierDocumentExtractionQuerySchema.safeParse({
        productId: id,
        cursor: "",
      }).success,
    ).toBe(false);
  });

  it("rejects unsupported keys, invalid confidence, and unlocatable spans", () => {
    expect(supplierDocumentCandidateSchema.parse(candidate)).toEqual(candidate);
    for (const bad of [
      { ...candidate, fieldKey: "compliance_verdict" },
      { ...candidate, confidence: 1.01 },
      { ...candidate, sourceSpan: { ...candidate.sourceSpan, page: 0 } },
      {
        ...candidate,
        sourceSpan: { ...candidate.sourceSpan, endOffset: 5 },
      },
      { ...candidate, toolCall: "http://example.test" },
    ]) {
      expect(supplierDocumentCandidateSchema.safeParse(bad).success).toBe(
        false,
      );
    }
    expect(supplierDocumentModelOutputSchema.parse({ candidates: [] })).toEqual(
      {
        candidates: [],
      },
    );
    expect(() =>
      supplierDocumentModelOutputSchema.parse({
        candidates: [],
        instructions: "send data",
      }),
    ).toThrow();
  });

  it("requires optimistic concurrency and a corrected value only for confirmation", () => {
    const base = { ...source, expectedFieldVersion: 0 };
    expect(() =>
      decideSupplierDocumentFieldInputSchema.parse({
        ...base,
        decision: "confirm",
      }),
    ).toThrow();
    expect(
      decideSupplierDocumentFieldInputSchema.parse({
        ...base,
        decision: "confirm",
        correctedValue: "ISO 9001:2015",
      }).correctedValue,
    ).toBe("ISO 9001:2015");
    expect(() =>
      decideSupplierDocumentFieldInputSchema.parse({
        ...base,
        decision: "reject",
        correctedValue: "ISO 9001",
      }),
    ).toThrow();
  });

  it("allows bounded manual entry without invented source spans", () => {
    expect(
      createManualSupplierDocumentFieldInputSchema.parse({
        ...source,
        fieldKey: "scope",
        value: "Design and manufacture of components",
      }).value,
    ).toBe("Design and manufacture of components");
    expect(() =>
      createManualSupplierDocumentFieldInputSchema.parse({
        ...source,
        fieldKey: "scope",
        value: "manual",
        sourceSpan: candidate.sourceSpan,
      }),
    ).toThrow();
  });

  it("parses a bounded review response and preserves multiple candidates", () => {
    const suggestion = {
      id,
      runId: id,
      origin: "ai",
      evidenceVersionId: id,
      evidenceSha256: "a".repeat(64),
      model: "local-model",
      promptVersion: "supplier-fields-v1",
      ...candidate,
      correctedValue: null,
      status: "pending",
      version: 0,
      reviewedByUserId: null,
      reviewedAt: null,
      createdAt: timestamp,
    };
    const response = {
      run: {
        id,
        submissionId: id,
        evidenceVersionId: id,
        evidenceSha256: "a".repeat(64),
        status: "completed",
        model: "local-model",
        promptVersion: "supplier-fields-v1",
        createdAt: timestamp,
        completedAt: timestamp,
        errorCode: null,
      },
      suggestions: [
        suggestion,
        { ...suggestion, id: otherId, candidateGroup: "certificate-2" },
      ],
      pages: [{ page: 2, text: "text ISO 9001" }],
      nextCursor: null,
    };
    expect(supplierDocumentExtractionResponseSchema.parse(response)).toEqual(
      response,
    );
    expect(
      supplierDocumentExtractionResponseSchema.parse({
        ...response,
        suggestions: [
          ...response.suggestions,
          {
            id: "00000000-0000-4000-8000-000000000003",
            origin: "manual",
            runId: null,
            evidenceVersionId: id,
            evidenceSha256: "a".repeat(64),
            model: null,
            promptVersion: null,
            fieldKey: "scope",
            candidateGroup: null,
            originalValue: null,
            correctedValue: "Manufacturing",
            confidence: null,
            sourceSpan: null,
            status: "confirmed",
            version: 0,
            reviewedByUserId: id,
            reviewedAt: timestamp,
            createdAt: timestamp,
          },
        ],
      }).suggestions,
    ).toHaveLength(3);
    expect(() =>
      supplierDocumentExtractionResponseSchema.parse({
        ...response,
        pages: [{ page: 0, text: "" }],
      }),
    ).toThrow();
  });
});
