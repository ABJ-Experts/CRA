import { describe, expect, it } from "vitest";

import {
  completeSupplierSbomUploadInputSchema,
  createSupplierSbomRequestInputSchema,
  initializeSupplierSbomUploadInputSchema,
  supplierSbomPortalSessionInputSchema,
  supplierSbomPortalSessionResponseSchema,
  supplierSbomSubmissionStateSchema,
} from "./sbom-supplier.schema.js";

const ids = {
  product: "00000000-0000-4000-8000-000000000001",
  release: "00000000-0000-4000-8000-000000000002",
};
const idempotencyKey = "00000000-0000-4000-8000-000000000003";
const sessionToken = "s".repeat(40);
const sha256 = "a".repeat(64);

describe("supplier SBOM contracts", () => {
  it("binds a request to one product release and allowed component reference", () => {
    expect(
      createSupplierSbomRequestInputSchema.parse({
        productId: ids.product,
        releaseId: ids.release,
        supplierDisplayName: "Acme Components",
        allowedComponentRef: "supplier-part-42",
        expiresAt: "2026-09-01T00:00:00.000Z",
        idempotencyKey,
      }),
    ).toMatchObject({ allowedComponentRef: "supplier-part-42" });
  });

  it("requires the scoped session for both reserve and complete", () => {
    const upload = {
      fileName: "supplier.cdx.json",
      mediaType: "application/json",
      byteSize: 123,
      sha256,
      idempotencyKey,
    };
    expect(
      initializeSupplierSbomUploadInputSchema.safeParse(upload).success,
    ).toBe(false);
    expect(
      initializeSupplierSbomUploadInputSchema.parse({
        ...upload,
        sessionToken,
      }),
    ).toMatchObject({ sessionToken });
    expect(
      completeSupplierSbomUploadInputSchema.safeParse({ idempotencyKey })
        .success,
    ).toBe(false);
  });

  it("requires a M9-generated session secret to make invitation exchange retry-safe", () => {
    expect(
      supplierSbomPortalSessionInputSchema.safeParse({
        invitationToken: "i".repeat(40),
      }).success,
    ).toBe(false);
    expect(
      supplierSbomPortalSessionInputSchema.parse({
        invitationToken: "i".repeat(40),
        sessionToken,
      }),
    ).toMatchObject({ sessionToken });
  });

  it("keeps portal session data scoped and preserves every auditable state", () => {
    expect(supplierSbomSubmissionStateSchema.options).toEqual([
      "pending",
      "processing",
      "validation_failed",
      "awaiting_review",
      "accepted",
      "rejected",
      "superseded",
    ]);
    const parsed = supplierSbomPortalSessionResponseSchema.parse({
      session: {
        sessionToken,
        expiresAt: "2026-09-01T00:00:00.000Z",
        requestReference: "request-123",
        allowedComponentRef: "supplier-part-42",
      },
    });
    expect(Object.keys(parsed.session)).not.toContain("organizationId");
    expect(Object.keys(parsed.session)).not.toContain("productId");
  });
});
