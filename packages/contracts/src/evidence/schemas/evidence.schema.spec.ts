import { describe, expect, it } from "vitest";

import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  evidenceDocumentStatusSchema,
  evidenceExtractedTextResponseSchema,
  evidenceExtractionMetadataSchema,
  evidenceMediaTypeSchema,
  evidenceScanProvenanceSchema,
  evidenceSearchQuerySchema,
  evidenceSearchResponseSchema,
  evidenceDeliveryParamsSchema,
  initializeEvidenceUploadInputSchema,
  retryEvidenceExtractionInputSchema,
} from "./evidence.schema.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("evidence schema boundaries", () => {
  const validInput = {
    title: "Independent test report",
    documentClass: "test_report",
    ownerUserId: id,
    productIds: ["00000000-0000-4000-8000-000000000002"],
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    fileName: "report.pdf",
    byteSize: 1,
    idempotencyKey: "00000000-0000-4000-8000-000000000003",
  };

  it("accepts bounded metadata but treats the file type as server output", () => {
    expect(initializeEvidenceUploadInputSchema.parse(validInput)).toMatchObject(
      {
        documentClass: "test_report",
        fileName: "report.pdf",
      },
    );
    expect(evidenceMediaTypeSchema.parse("application/pdf")).toBe(
      "application/pdf",
    );
    expect(evidenceMediaTypeSchema.parse("image/webp")).toBe("image/webp");
  });

  it("rejects duplicate products, paths, reverse validity, and oversized claims", () => {
    expect(() =>
      initializeEvidenceUploadInputSchema.parse({
        ...validInput,
        productIds: [validInput.productIds[0], validInput.productIds[0]],
      }),
    ).toThrow();
    expect(() =>
      initializeEvidenceUploadInputSchema.parse({
        ...validInput,
        fileName: "../../dangerous.pdf",
      }),
    ).toThrow();
    expect(() =>
      initializeEvidenceUploadInputSchema.parse({
        ...validInput,
        validFrom: validInput.validUntil,
        validUntil: validInput.validFrom,
      }),
    ).toThrow();
    expect(() =>
      initializeEvidenceUploadInputSchema.parse({
        ...validInput,
        byteSize: EVIDENCE_MAX_UPLOAD_BYTES + 1,
      }),
    ).toThrow();
  });

  it("does not admit browser-declared MIME types or unrecognized states", () => {
    expect(() =>
      initializeEvidenceUploadInputSchema.parse({
        ...validInput,
        mediaType: "application/pdf",
      }),
    ).toThrow();
    expect(() => evidenceMediaTypeSchema.parse("application/zip")).toThrow();
    expect(() => evidenceDocumentStatusSchema.parse("verified")).toThrow();
    expect(() =>
      evidenceDeliveryParamsSchema.parse({ token: "not-a-grant" }),
    ).toThrow();
  });

  it("keeps detection provenance bounded and internally consistent", () => {
    expect(
      evidenceScanProvenanceSchema.parse({
        outcome: "detected",
        engineName: "ClamAV",
        engineVersion: "1.4.3",
        signatureVersion: "daily-12345",
        scannedAt: "2026-09-16T10:00:00.000Z",
        detectionName: "Eicar-Test-Signature",
      }),
    ).toMatchObject({ outcome: "detected" });
    expect(() =>
      evidenceScanProvenanceSchema.parse({
        outcome: "clean",
        engineName: "ClamAV",
        engineVersion: null,
        signatureVersion: null,
        scannedAt: "2026-09-16T10:00:00.000Z",
        detectionName: "Eicar-Test-Signature",
      }),
    ).toThrow();
  });

  it("normalizes bounded product-scoped search input and defaults to current versions", () => {
    expect(evidenceSearchQuerySchema.parse({ q: "  Annex   II  " })).toEqual({
      q: "Annex II",
      includeHistorical: false,
      limit: 25,
    });
    expect(
      evidenceSearchQuerySchema.parse({
        q: "Annex II",
        includeHistorical: "true",
        limit: "50",
      }),
    ).toMatchObject({ includeHistorical: true, limit: 50 });
  });

  it("rejects invalid search cursors, filters, and query bounds", () => {
    expect(() => evidenceSearchQuerySchema.parse({ q: "x" })).toThrow();
    expect(() =>
      evidenceSearchQuerySchema.parse({ q: "valid\u0000query" }),
    ).toThrow();
    expect(() =>
      evidenceSearchQuerySchema.parse({ q: "valid", limit: 51 }),
    ).toThrow();
    expect(() =>
      evidenceSearchQuerySchema.parse({ q: "valid", cursor: "not a cursor" }),
    ).toThrow();
    expect(() =>
      evidenceSearchQuerySchema.parse({
        q: "valid",
        documentClass: "unknown_class",
      }),
    ).toThrow();
    expect(() =>
      evidenceSearchQuerySchema.parse({ q: "valid", includeHistorical: "yes" }),
    ).toThrow();
  });

  it("requires provenance and a safe failure state for derived text", () => {
    const extraction = {
      status: "complete",
      sourceSha256: "a".repeat(64),
      extractorVersion: "local-ocr-v1",
      updatedAt: "2026-09-18T10:00:00.000Z",
      failureCode: null,
      truncated: false,
      quality: "sufficient",
    } as const;
    expect(evidenceExtractionMetadataSchema.parse(extraction)).toEqual(
      extraction,
    );
    expect(() =>
      evidenceExtractionMetadataSchema.parse({
        ...extraction,
        status: "failed",
      }),
    ).toThrow();
    expect(() =>
      evidenceExtractionMetadataSchema.parse({
        ...extraction,
        status: "complete",
        quality: "low",
      }),
    ).toThrow();
  });

  it("keeps snippets bounded text segments rather than an executable HTML payload", () => {
    const extraction = {
      status: "complete",
      sourceSha256: "a".repeat(64),
      extractorVersion: "local-ocr-v1",
      updatedAt: "2026-09-18T10:00:00.000Z",
      failureCode: null,
      truncated: false,
      quality: "sufficient",
    } as const;
    const response = evidenceSearchResponseSchema.parse({
      results: [
        {
          documentId: id,
          versionId: "00000000-0000-4000-8000-000000000004",
          versionNumber: 1,
          title: "Evidence",
          documentClass: "test_report",
          fileName: "evidence.pdf",
          createdAt: "2026-09-18T10:00:00.000Z",
          validUntil: null,
          currentVersion: true,
          score: 0.42,
          snippet: {
            segments: [
              { text: "Use ", highlighted: false },
              { text: "<script>alert(1)</script>", highlighted: true },
            ],
            truncated: false,
          },
          extraction,
        },
      ],
      totalCount: 1,
      facets: [{ documentClass: "test_report", count: 1 }],
      coverage: { indexed: 1, pending: 2, unavailable: 1 },
      nextCursor: null,
    });
    expect(response.results[0]?.snippet.segments[1]).toEqual({
      text: "<script>alert(1)</script>",
      highlighted: true,
    });
    expect(response.coverage).toEqual({
      indexed: 1,
      pending: 2,
      unavailable: 1,
    });
  });

  it("makes unavailable extraction explicit instead of returning an empty success", () => {
    const unavailable = {
      status: "failed",
      sourceSha256: "a".repeat(64),
      extractorVersion: "local-ocr-v1",
      updatedAt: "2026-09-18T10:00:00.000Z",
      failureCode: "unavailable",
      truncated: false,
      quality: "not_assessed",
    } as const;
    expect(
      evidenceExtractedTextResponseSchema.parse({
        extractedText: {
          documentId: id,
          versionId: "00000000-0000-4000-8000-000000000004",
          extraction: unavailable,
          snippet: null,
        },
      }).extractedText.extraction.failureCode,
    ).toBe("unavailable");
    expect(() =>
      evidenceExtractedTextResponseSchema.parse({
        extractedText: {
          documentId: id,
          versionId: "00000000-0000-4000-8000-000000000004",
          extraction: unavailable,
          snippet: {
            segments: [{ text: "wrong", highlighted: false }],
            truncated: false,
          },
        },
      }),
    ).toThrow();
  });

  it("requires an explicit idempotency key when retrying extraction", () => {
    expect(
      retryEvidenceExtractionInputSchema.parse({
        idempotencyKey: "00000000-0000-4000-8000-000000000005",
      }),
    ).toMatchObject({
      idempotencyKey: "00000000-0000-4000-8000-000000000005",
    });
    expect(() => retryEvidenceExtractionInputSchema.parse({})).toThrow();
  });
});
