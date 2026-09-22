import { describe, expect, it } from "vitest";

import {
  createSupplierEvidenceRequestInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  reRequestSupplierEvidenceRequestInputSchema,
  reviewSupplierEvidenceSubmissionInputSchema,
  supplierEvidencePortalSessionInputSchema,
} from "./supplier-evidence.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const key = "00000000-0000-4000-8000-000000000002";

describe("supplier evidence contracts", () => {
  it("requires explicit checklist content and a future offset due timestamp", () => {
    expect(() =>
      createSupplierEvidenceRequestInputSchema.parse({
        productId: id,
        recipientContactId: id,
        ownerUserId: id,
        title: "Supplier evidence",
        dueAt: "2026-10-01T10:00:00.000Z",
        items: [],
        idempotencyKey: key,
      }),
    ).toThrow();
  });

  it("rejects portal filenames with paths and oversized requests", () => {
    expect(() =>
      initializeSupplierEvidencePortalUploadInputSchema.parse({
        sessionToken: "a".repeat(32),
        checklistItemId: id,
        fileName: "../secret.pdf",
        mediaType: "application/pdf",
        byteSize: 1,
        sha256: "a".repeat(64),
        idempotencyKey: key,
      }),
    ).toThrow();
  });

  it("accepts only an opaque invitation bearer at exchange", () => {
    expect(() => supplierEvidencePortalSessionInputSchema.parse({})).toThrow();
    expect(
      supplierEvidencePortalSessionInputSchema.parse({
        invitationToken: "a".repeat(32),
      }).invitationToken,
    ).toHaveLength(32);
  });

  it("requires a supplier-safe reason only when rejecting evidence", () => {
    const base = {
      expectedRequestVersion: 3,
      expectedSubmissionUpdatedAt: "2026-10-01T10:00:00.000Z",
      expectedEvidenceVersionId: id,
      expectedSha256: "a".repeat(64),
      idempotencyKey: key,
    };
    expect(() =>
      reviewSupplierEvidenceSubmissionInputSchema.parse({
        ...base,
        decision: "reject",
      }),
    ).toThrow();
    expect(
      reviewSupplierEvidenceSubmissionInputSchema.parse({
        ...base,
        decision: "reject",
        supplierVisibleReason: "Please provide the current declaration.",
      }).supplierVisibleReason,
    ).toBe("Please provide the current declaration.");
    expect(() =>
      reviewSupplierEvidenceSubmissionInputSchema.parse({
        ...base,
        decision: "accept",
        supplierVisibleReason: "Not applicable",
      }),
    ).toThrow();
  });

  it("requires each re-requested item to point to a distinct prior item", () => {
    expect(() =>
      reRequestSupplierEvidenceRequestInputSchema.parse({
        expectedVersion: 3,
        dueAt: "2026-10-01T10:00:00.000Z",
        idempotencyKey: key,
        items: [
          {
            sourceRequestItemId: id,
            title: "Current declaration",
            documentClass: "other",
          },
          {
            sourceRequestItemId: id,
            title: "Updated declaration",
            documentClass: "other",
          },
        ],
      }),
    ).toThrow();
  });
});
