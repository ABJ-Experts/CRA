import { describe, expect, it } from "vitest";

import {
  createEvidenceBulkIntakeBatchInputSchema,
  evidenceBulkIntakeBatchSchema,
  initializeEvidenceBulkIntakeItemInputSchema,
  retryEvidenceBulkIntakeItemInputSchema,
} from "./evidence-bulk-intake.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const itemId = "00000000-0000-4000-8000-000000000002";
const productId = "00000000-0000-4000-8000-000000000003";

describe("evidence bulk-intake contract boundaries", () => {
  it("bounds an unconfirmed batch and preserves independent item idempotency", () => {
    const input = {
      idempotencyKey: id,
      items: [
        {
          clientItemId: itemId,
          idempotencyKey: "00000000-0000-4000-8000-000000000004",
          title: "Device test report",
          ownerUserId: "00000000-0000-4000-8000-000000000005",
          productIds: [productId],
          validFrom: null,
          validUntil: null,
          fileName: "test-report.pdf",
          byteSize: 1024,
        },
      ],
    };

    expect(createEvidenceBulkIntakeBatchInputSchema.parse(input)).toEqual(
      input,
    );
    expect(() =>
      createEvidenceBulkIntakeBatchInputSchema.parse({
        ...input,
        items: Array.from({ length: 21 }, () => input.items[0]),
      }),
    ).toThrow();
    expect(() =>
      createEvidenceBulkIntakeBatchInputSchema.parse({
        ...input,
        items: [{ ...input.items[0], productIds: [productId, productId] }],
      }),
    ).toThrow();
  });

  it("requires a later explicit classification decision", () => {
    expect(
      initializeEvidenceBulkIntakeItemInputSchema.parse({
        documentClass: "test_report",
        classificationDecision: "accepted",
        idempotencyKey: id,
      }),
    ).toEqual({
      documentClass: "test_report",
      classificationDecision: "accepted",
      idempotencyKey: id,
    });

    expect(() =>
      initializeEvidenceBulkIntakeItemInputSchema.parse({
        documentClass: "test_report",
        idempotencyKey: id,
        accepted: true,
      }),
    ).toThrow();
    expect(
      retryEvidenceBulkIntakeItemInputSchema.parse({
        documentClass: "test_report",
        classificationDecision: "accepted",
        fileName: "retry.pdf",
        byteSize: 1024,
        idempotencyKey: id,
      }),
    ).toMatchObject({ fileName: "retry.pdf", byteSize: 1024 });
    expect(() =>
      retryEvidenceBulkIntakeItemInputSchema.parse({
        documentClass: "test_report",
        classificationDecision: "accepted",
        byteSize: 1024,
        idempotencyKey: id,
      }),
    ).toThrow();
  });

  it("does not represent an unconfirmed suggestion as a usable class", () => {
    const base = {
      id,
      productId,
      createdByUserId: "00000000-0000-4000-8000-000000000005",
      createdAt: "2026-09-21T10:00:00.000Z",
      updatedAt: "2026-09-21T10:00:00.000Z",
      status: "active",
      counts: {
        total: 1,
        unconfirmed: 1,
        ready: 0,
        uploading: 0,
        scanPending: 0,
        clean: 0,
        quarantined: 0,
        failed: 0,
        cancelled: 0,
        success: 0,
        pending: 1,
        rejected: 0,
      },
      items: [
        {
          id: itemId,
          clientItemId: itemId,
          fileName: "test-report.pdf",
          byteSize: 1024,
          title: "Device test report",
          ownerUserId: "00000000-0000-4000-8000-000000000005",
          productIds: [productId],
          validFrom: null,
          validUntil: null,
          status: "unconfirmed",
          classification: {
            source: "filename_rules_v1",
            suggestedDocumentClass: "test_report",
            documentClass: null,
            decision: "unconfirmed",
            decidedByUserId: null,
            decidedAt: null,
          },
          documentId: null,
          versionId: null,
          errorCode: null,
          createdAt: "2026-09-21T10:00:00.000Z",
          updatedAt: "2026-09-21T10:00:00.000Z",
        },
      ],
    };
    expect(evidenceBulkIntakeBatchSchema.parse(base)).toMatchObject({
      counts: { unconfirmed: 1 },
    });
    expect(() =>
      evidenceBulkIntakeBatchSchema.parse({
        ...base,
        items: [
          {
            ...base.items[0],
            classification: {
              ...base.items[0].classification,
              documentClass: "test_report",
            },
          },
        ],
      }),
    ).toThrow();
  });
});
