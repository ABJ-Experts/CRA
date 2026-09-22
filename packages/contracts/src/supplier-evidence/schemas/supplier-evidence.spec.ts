import { describe, expect, it } from "vitest";

import {
  createSupplierEvidenceRequestInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
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
});
