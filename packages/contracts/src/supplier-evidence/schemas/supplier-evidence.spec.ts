import { describe, expect, it } from "vitest";

import {
  createSupplierEvidenceRequestInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  reRequestSupplierEvidenceRequestInputSchema,
  reviewSupplierEvidenceSubmissionInputSchema,
  supplierEvidenceMetricsQuerySchema,
  supplierEvidencePortalSessionInputSchema,
  supplierEvidenceReminderSettingsInputSchema,
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

  it("accepts a bounded, unique reminder cadence and rejects a zero or duplicate offset", () => {
    expect(
      supplierEvidenceReminderSettingsInputSchema.parse({
        expectedVersion: 2,
        offsetsHours: [-168, -24, 24],
        idempotencyKey: key,
      }),
    ).toEqual({
      expectedVersion: 2,
      offsetsHours: [-168, -24, 24],
      idempotencyKey: key,
    });

    expect(() =>
      supplierEvidenceReminderSettingsInputSchema.parse({
        expectedVersion: 2,
        offsetsHours: [-168, -24, 24],
      }),
    ).toThrow();

    expect(() =>
      supplierEvidenceReminderSettingsInputSchema.parse({
        expectedVersion: 2,
        offsetsHours: [-24, -24],
      }),
    ).toThrow("Reminder offsets must be unique");
    expect(() =>
      supplierEvidenceReminderSettingsInputSchema.parse({
        expectedVersion: 2,
        offsetsHours: [0],
        idempotencyKey: key,
      }),
    ).toThrow("Reminder offsets cannot be zero");
    expect(() =>
      supplierEvidenceReminderSettingsInputSchema.parse({
        expectedVersion: 2,
        offsetsHours: [-24, 48],
        idempotencyKey: key,
      }),
    ).toThrow("Reminder cadence must include the 24-hour overdue milestone");
  });

  it("uses a half-open, ordered metrics window and preserves optional scope filters", () => {
    expect(
      supplierEvidenceMetricsQuerySchema.parse({
        from: "2026-09-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
        productId: id,
        supplierId: id,
      }),
    ).toMatchObject({
      from: "2026-09-01T00:00:00.000Z",
      to: "2026-10-01T00:00:00.000Z",
      productId: id,
      supplierId: id,
    });

    expect(() =>
      supplierEvidenceMetricsQuerySchema.parse({
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-01T00:00:00.000Z",
      }),
    ).toThrow("Metrics window start must precede its end");
  });
});
