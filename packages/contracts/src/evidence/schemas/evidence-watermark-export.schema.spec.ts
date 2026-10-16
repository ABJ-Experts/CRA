import { describe, expect, it } from "vitest";

import {
  createEvidenceWatermarkExportInputSchema,
  evidenceWatermarkExportSchema,
} from "./evidence-watermark-export.schema.js";

const id = "00000000-0000-4000-8000-000000000001";

describe("evidence watermark-export contract boundaries", () => {
  it("normalizes confidential recipient and purpose while rejecting controls", () => {
    expect(
      createEvidenceWatermarkExportInputSchema.parse({
        recipient: "  Zo\u00eb Auditor  ",
        purpose: "  External review  ",
        idempotencyKey: id,
      }),
    ).toMatchObject({ recipient: "Zo\u00eb Auditor", purpose: "External review" });
    expect(() =>
      createEvidenceWatermarkExportInputSchema.parse({
        recipient: "Zo\u00eb\u0000 Auditor",
        purpose: "External review",
        idempotencyKey: id,
      }),
    ).toThrow();
    expect(
      createEvidenceWatermarkExportInputSchema.safeParse({
        recipient: "e\u0301".repeat(160),
        purpose: "External review",
        idempotencyKey: id,
      }).success,
    ).toBe(true);
  });

  it("keeps original and derivative integrity distinct", () => {
    const ready = {
      id,
      organizationId: "00000000-0000-4000-8000-000000000002",
      productId: "00000000-0000-4000-8000-000000000003",
      documentId: "00000000-0000-4000-8000-000000000004",
      sourceVersionId: "00000000-0000-4000-8000-000000000005",
      sourceSha256: "a".repeat(64),
      requestedByUserId: "00000000-0000-4000-8000-000000000006",
      requestedAt: "2026-09-21T10:00:00.000Z",
      recipient: "Zo\u00eb Auditor",
      purpose: "External review",
      status: "ready",
      failureCode: null,
      derivative: {
        fileName: "test-report-watermarked.pdf",
        mediaType: "application/pdf",
        byteSize: 2048,
        sha256: "b".repeat(64),
        createdAt: "2026-09-21T10:01:00.000Z",
      },
      previewedAt: null,
      deliveredAt: null,
    };
    expect(evidenceWatermarkExportSchema.parse(ready)).toMatchObject({
      sourceSha256: "a".repeat(64),
      derivative: { sha256: "b".repeat(64) },
    });
    expect(() =>
      evidenceWatermarkExportSchema.parse({ ...ready, derivative: null }),
    ).toThrow();
  });
});
