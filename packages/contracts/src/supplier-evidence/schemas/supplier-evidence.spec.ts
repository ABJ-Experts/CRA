import { describe, expect, it } from "vitest";

import {
  createSupplierEvidenceRequestInputSchema,
  completeSupplierEvidenceSbomUploadInputSchema,
  initializeSupplierEvidenceSbomUploadInputSchema,
  initializeSupplierEvidencePortalUploadInputSchema,
  reRequestSupplierEvidenceRequestInputSchema,
  reviewSupplierEvidenceSubmissionInputSchema,
  supplierEvidenceChecklistItemSchema,
  supplierEvidenceEligibleSbomRequestsQuerySchema,
  supplierEvidenceEligibleSbomRequestsResponseSchema,
  supplierEvidenceMetricsQuerySchema,
  supplierEvidencePortalChecklistItemSchema,
  supplierEvidencePortalSessionInputSchema,
  supplierEvidencePreviewChecklistItemSchema,
  supplierEvidenceReminderSettingsInputSchema,
  supplierEvidenceSbomCompletionParamsSchema,
  supplierEvidenceSbomUploadInitializationResponseSchema,
} from "./supplier-evidence.schema.js";

const id = "00000000-0000-4000-8000-000000000001";
const key = "00000000-0000-4000-8000-000000000002";

describe("supplier evidence contracts", () => {
  it("preserves legacy evidence items and requires an explicit SBOM request link", () => {
    const evidence = {
      title: "Certificate",
      documentClass: "supplier_attestation",
    };
    const base = {
      supplierId: id,
      productId: id,
      recipientContactId: id,
      ownerUserId: id,
      title: "Supplier evidence",
      dueAt: "2026-10-01T10:00:00.000Z",
      idempotencyKey: key,
    };
    expect(
      createSupplierEvidenceRequestInputSchema.parse({
        ...base,
        items: [evidence],
      }).items[0],
    ).toMatchObject({
      ...evidence,
      kind: "evidence",
      supplierSbomRequestId: null,
    });
    expect(
      createSupplierEvidenceRequestInputSchema.parse({
        ...base,
        items: [
          {
            title: "Component SBOM",
            kind: "sbom",
            documentClass: "sbom",
            supplierSbomRequestId: id,
          },
        ],
      }).items[0],
    ).toMatchObject({
      kind: "sbom",
      supplierSbomRequestId: id,
      documentClass: "sbom",
    });
    for (const item of [
      { title: "SBOM", kind: "sbom", documentClass: "sbom" },
      { ...evidence, supplierSbomRequestId: id },
      { ...evidence, kind: "unknown" },
      {
        title: "SBOM",
        kind: "sbom",
        supplierSbomRequestId: id,
        documentClass: "test_report",
      },
    ]) {
      expect(
        createSupplierEvidenceRequestInputSchema.safeParse({
          ...base,
          items: [item],
        }).success,
      ).toBe(false);
    }
    expect(
      supplierEvidenceChecklistItemSchema.parse({
        id,
        position: 0,
        instructions: null,
        ...evidence,
      }),
    ).toMatchObject({ kind: "evidence", supplierSbomRequestId: null });
  });

  it("bounds eligible linked requests and keeps portal SBOM data supplier-safe", () => {
    expect(
      supplierEvidenceEligibleSbomRequestsQuerySchema.parse({
        productId: id,
        supplierId: id,
      }),
    ).toMatchObject({ productId: id, supplierId: id, limit: 25 });
    expect(
      supplierEvidenceEligibleSbomRequestsQuerySchema.safeParse({
        productId: id,
        supplierId: id,
        limit: 101,
      }).success,
    ).toBe(false);
    const eligible = {
      requests: [
        {
          id,
          releaseId: id,
          supplierDisplayName: "Parts Co",
          allowedComponentRef: "pkg:npm/example@1.2.3",
          expiresAt: "2026-10-01T10:00:00.000Z",
        },
      ],
      nextCursor: null,
    };
    expect(
      supplierEvidenceEligibleSbomRequestsResponseSchema.parse(eligible),
    ).toEqual(eligible);
    const portalItem = {
      id,
      title: "Component SBOM",
      instructions: null,
      documentClass: "sbom",
      kind: "sbom",
      position: 0,
      reRequestReason: null,
      sbom: {
        allowedComponentRef: "pkg:npm/example@1.2.3",
        submission: {
          id,
          state: "processing",
          fileName: "component.json",
          validationMessage: null,
          createdAt: "2026-09-23T10:00:00.000Z",
          updatedAt: "2026-09-23T10:00:00.000Z",
        },
      },
    };
    expect(
      supplierEvidencePortalChecklistItemSchema.parse(portalItem).sbom,
    ).toEqual(portalItem.sbom);
    expect(
      supplierEvidencePortalChecklistItemSchema.safeParse({
        ...portalItem,
        supplierSbomRequestId: id,
      }).success,
    ).toBe(false);
    expect(
      supplierEvidencePortalChecklistItemSchema.safeParse({
        ...portalItem,
        sbom: { ...portalItem.sbom, productId: id },
      }).success,
    ).toBe(false);
    expect(
      supplierEvidencePortalChecklistItemSchema.safeParse({
        ...portalItem,
        sbom: null,
      }).success,
    ).toBe(false);
    expect(
      supplierEvidencePortalChecklistItemSchema.safeParse({
        ...portalItem,
        kind: "evidence",
        documentClass: "supplier_attestation",
      }).success,
    ).toBe(false);
  });

  it("shows the allowed component in supplier preview without leaking the linked request ID", () => {
    const previewItem = {
      id,
      title: "Component SBOM",
      instructions: null,
      documentClass: "sbom",
      kind: "sbom",
      position: 0,
      allowedComponentRef: "pkg:npm/example@1.2.3",
    };
    expect(
      supplierEvidencePreviewChecklistItemSchema.parse(previewItem),
    ).toEqual(previewItem);
    expect(
      supplierEvidencePreviewChecklistItemSchema.safeParse({
        ...previewItem,
        supplierSbomRequestId: id,
      }).success,
    ).toBe(false);
    expect(
      supplierEvidencePreviewChecklistItemSchema.safeParse({
        ...previewItem,
        allowedComponentRef: null,
      }).success,
    ).toBe(false);
  });

  it("uses M3 SBOM format and size constraints with retryable source-scoped completion", () => {
    const upload = {
      sessionToken: "a".repeat(32),
      fileName: "component.json",
      mediaType: "application/json",
      byteSize: 100,
      sha256: "a".repeat(64),
      idempotencyKey: key,
      declaredFormat: "cyclonedx",
      declaredSpecVersion: "1.6",
    };
    expect(
      initializeSupplierEvidenceSbomUploadInputSchema.parse(upload),
    ).toEqual(upload);
    expect(
      initializeSupplierEvidenceSbomUploadInputSchema.safeParse({
        ...upload,
        productId: id,
      }).success,
    ).toBe(false);
    expect(
      initializeSupplierEvidenceSbomUploadInputSchema.safeParse({
        ...upload,
        mediaType: "application/pdf",
      }).success,
    ).toBe(false);
    expect(
      initializeSupplierEvidenceSbomUploadInputSchema.safeParse({
        ...upload,
        fileName: "../escape.json",
      }).success,
    ).toBe(false);
    expect(
      completeSupplierEvidenceSbomUploadInputSchema.parse({
        sessionToken: upload.sessionToken,
        idempotencyKey: key,
      }),
    ).toEqual({ sessionToken: upload.sessionToken, idempotencyKey: key });
    expect(
      supplierEvidenceSbomCompletionParamsSchema.parse({
        checklistItemId: id,
        sourceId: id,
      }),
    ).toEqual({ checklistItemId: id, sourceId: id });
    expect(
      supplierEvidenceSbomUploadInitializationResponseSchema.parse({
        sourceId: id,
        submission: {
          id,
          state: "pending",
          fileName: "component.json",
          validationMessage: null,
          createdAt: "2026-09-23T10:00:00.000Z",
          updatedAt: "2026-09-23T10:00:00.000Z",
        },
        upload: {
          uploadUrl:
            "http://127.0.0.1:54321/storage/v1/object/upload/sign/opaque",
          expiresAt: "2026-09-23T10:05:00.000Z",
        },
      }).sourceId,
    ).toBe(id);
  });
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
