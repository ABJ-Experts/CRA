import { describe, expect, it } from "vitest";

import {
  createSupplierInputSchema,
  createSupplierResponsibilityInputSchema,
  supplierCriticalitySchema,
  supplierDuplicateCandidatesErrorSchema,
  supplierContactSchema,
  supplierListQuerySchema,
  supplierResponsibilitySchema,
} from "./supplier-registry.schema.js";

const UUID = "11111111-1111-4111-8111-111111111111";
const UTC = "2026-09-21T12:00:00.000Z";

describe("supplier registry contracts", () => {
  it("keeps supplier identity tenant-local and requires explicit duplicate confirmation", () => {
    expect(
      createSupplierInputSchema.safeParse({
        name: "  Example Components  ",
        criticality: "high",
        duplicateCandidateIdsConfirmed: [UUID],
        idempotencyKey: UUID,
      }).data,
    ).toMatchObject({
      name: "Example Components",
      duplicateCandidateIdsConfirmed: [UUID],
    });
    expect(supplierCriticalitySchema.safeParse("urgent").success).toBe(false);
  });

  it("bounds searchable registry reads and parses archived filters", () => {
    expect(
      supplierListQuerySchema.parse({
        search: "  sensor  ",
        includeArchived: "true",
        limit: "25",
      }),
    ).toEqual({ search: "sensor", includeArchived: true, limit: 25 });
    expect(supplierListQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
  });

  it("pins a responsibility to a concrete product, release, and occurrence", () => {
    expect(
      supplierResponsibilitySchema.safeParse({
        id: UUID,
        organizationId: UUID,
        supplierId: UUID,
        productId: UUID,
        releaseId: UUID,
        occurrenceId: UUID,
        componentId: UUID,
        documentId: UUID,
        componentIdentity: "pkg:npm/example@1.0.0",
        componentVersion: "1.0.0",
        identityKind: "purl",
        canonicalPurl: "pkg:npm/example@1.0.0",
        provenance: "manual",
        state: "active",
        endedAt: null,
        endedBy: null,
        endReason: null,
        supersededByResponsibilityId: null,
        version: 0,
        createdAt: UTC,
        createdBy: UUID,
      }).success,
    ).toBe(true);
  });

  it("requires an explicit request only for supplier-SBOM provenance", () => {
    expect(
      createSupplierResponsibilityInputSchema.safeParse({
        productId: UUID,
        releaseId: UUID,
        occurrenceId: UUID,
        provenance: "supplier_sbom_request",
        idempotencyKey: UUID,
      }).success,
    ).toBe(false);
    expect(
      createSupplierResponsibilityInputSchema.safeParse({
        productId: UUID,
        releaseId: UUID,
        occurrenceId: UUID,
        provenance: "manual",
        supplierRequestId: UUID,
        idempotencyKey: UUID,
      }).success,
    ).toBe(false);
  });

  it("parses only the public, typed duplicate-review error details", () => {
    expect(
      supplierDuplicateCandidatesErrorSchema.safeParse({
        statusCode: 409,
        message:
          "Confirm the listed same-name suppliers before creating another.",
        code: "duplicate_confirmation_required",
        details: {
          candidates: [
            {
              id: UUID,
              name: "Example Components",
              criticality: "high",
              state: "active",
            },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      supplierDuplicateCandidatesErrorSchema.safeParse({
        statusCode: 409,
        message: "Conflict",
        code: "duplicate_confirmation_required",
        details: { candidates: [{ id: UUID, name: "untyped" }] },
      }).success,
    ).toBe(false);
  });

  it("keeps phone-only contacts representable in projections", () => {
    expect(
      supplierContactSchema.safeParse({
        id: UUID,
        supplierId: UUID,
        name: "Operations contact",
        email: null,
        role: null,
        phone: "+1 555 0100",
        state: "active",
        version: 0,
        createdAt: UTC,
        updatedAt: UTC,
        archivedAt: null,
      }).success,
    ).toBe(true);
  });
});
