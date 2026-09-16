import { describe, expect, it } from "vitest";

import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  evidenceDocumentStatusSchema,
  evidenceMediaTypeSchema,
  evidenceScanProvenanceSchema,
  initializeEvidenceUploadInputSchema,
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
});
