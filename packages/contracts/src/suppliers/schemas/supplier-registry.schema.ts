import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { apiErrorSchema } from "../../shared/schemas/http.schema.js";
import { z } from "zod";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalText = (maximum: number) => requiredText(maximum).optional();
const nullableText = (maximum: number) => requiredText(maximum).nullable();
const expectedVersionSchema = z.number().int().nonnegative();
const utcDateTimeSchema = z.string().datetime({ offset: true });
const rawBoolean = z
  .union([z.boolean(), z.enum(["true", "false"])])
  .transform((value) => value === true || value === "true");

/** Criticality is an operational assessment, not an external supplier identity. */
export const supplierCriticalitySchema = z.enum([
  "unknown",
  "low",
  "medium",
  "high",
  "critical",
]);
export const supplierStateSchema = z.enum(["active", "archived"]);
export const supplierResponsibilityStateSchema = z.enum([
  "active",
  "ended",
  "superseded",
]);
export const supplierResponsibilityProvenanceSchema = z.enum([
  "manual",
  "supplier_sbom_request",
]);

export const supplierParamsSchema = z.object({ supplierId: z.uuid() }).strict();
export const supplierContactParamsSchema = z
  .object({ supplierId: z.uuid(), contactId: z.uuid() })
  .strict();
export const supplierResponsibilityParamsSchema = z
  .object({ supplierId: z.uuid(), responsibilityId: z.uuid() })
  .strict();
export const supplierRequestParamsSchema = z
  .object({ supplierId: z.uuid(), requestId: z.uuid() })
  .strict();
export const findingResponsibleSuppliersParamsSchema = z
  .object({ findingId: z.uuid() })
  .strict();

export const supplierListQuerySchema = z
  .object({
    search: z.string().trim().min(1).max(200).optional(),
    includeArchived: rawBoolean.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const createSupplierInputSchema = z
  .object({
    name: requiredText(255),
    legalName: optionalText(255),
    website: z.string().trim().url().max(2_048).optional(),
    criticality: supplierCriticalitySchema,
    /** Names are not unique. Explicit confirmation prevents silent merging. */
    duplicateCandidateIdsConfirmed: z.array(z.uuid()).max(25),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const updateSupplierInputSchema = z
  .object({
    name: requiredText(255).optional(),
    legalName: nullableText(255).optional(),
    website: z.string().trim().url().max(2_048).nullable().optional(),
    criticality: supplierCriticalitySchema.optional(),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .refine(
    ({ name, legalName, website, criticality }) =>
      name !== undefined ||
      legalName !== undefined ||
      website !== undefined ||
      criticality !== undefined,
    "Provide at least one supplier field to update",
  );

export const archiveSupplierInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: requiredText(500),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const createSupplierContactInputSchema = z
  .object({
    name: requiredText(160),
    email: z.string().trim().email().max(320).optional(),
    role: optionalText(160),
    phone: optionalText(80),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const updateSupplierContactInputSchema = z
  .object({
    name: requiredText(160).optional(),
    email: z.string().trim().email().max(320).optional(),
    role: nullableText(160).optional(),
    phone: nullableText(80).optional(),
    expectedVersion: expectedVersionSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .refine(
    ({ name, email, role, phone }) =>
      name !== undefined ||
      email !== undefined ||
      role !== undefined ||
      phone !== undefined,
    "Provide at least one contact field to update",
  );

export const archiveSupplierContactInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: requiredText(500),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/** A responsibility always targets one immutable, release-specific occurrence. */
export const createSupplierResponsibilityInputSchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid(),
    occurrenceId: z.uuid(),
    provenance: supplierResponsibilityProvenanceSchema,
    supplierRequestId: z.uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    const requiresRequest = value.provenance === "supplier_sbom_request";
    if (requiresRequest !== (value.supplierRequestId !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["supplierRequestId"],
        message: requiresRequest
          ? "Supplier-SBOM request provenance requires its explicit request identifier"
          : "Manual responsibility must not attach a supplier-SBOM request",
      });
    }
  });

export const endSupplierResponsibilityInputSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    reason: requiredText(1_000),
    supersededByResponsibilityId: z.uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const associateSupplierRequestInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const supplierDuplicateCandidateSchema = z
  .object({
    id: z.uuid(),
    name: requiredText(255),
    criticality: supplierCriticalitySchema,
    state: supplierStateSchema,
  })
  .strict();

export const supplierSummarySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    name: requiredText(255),
    legalName: nullableText(255),
    website: z.string().url().max(2_048).nullable(),
    criticality: supplierCriticalitySchema,
    state: supplierStateSchema,
    version: expectedVersionSchema,
    componentCount: z.number().int().nonnegative(),
    requestCount: z.number().int().nonnegative(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
    archivedAt: utcDateTimeSchema.nullable(),
  })
  .strict();

export const supplierContactSchema = z
  .object({
    id: z.uuid(),
    supplierId: z.uuid(),
    name: requiredText(160),
    email: z.string().email().max(320).nullable(),
    role: nullableText(160),
    phone: nullableText(80),
    state: supplierStateSchema,
    version: expectedVersionSchema,
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
    archivedAt: utcDateTimeSchema.nullable(),
  })
  .strict();

export const supplierResponsibilitySchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    supplierId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    occurrenceId: z.uuid(),
    componentId: z.uuid(),
    documentId: z.uuid(),
    componentIdentity: requiredText(4_096),
    componentVersion: z.string().trim().min(1).max(1_024).nullable(),
    identityKind: requiredText(80),
    canonicalPurl: z.string().trim().min(1).max(4_096).nullable(),
    provenance: supplierResponsibilityProvenanceSchema,
    state: supplierResponsibilityStateSchema,
    endedAt: utcDateTimeSchema.nullable(),
    endedBy: z.uuid().nullable(),
    endReason: nullableText(1_000),
    supersededByResponsibilityId: z.uuid().nullable(),
    version: expectedVersionSchema,
    createdAt: utcDateTimeSchema,
    createdBy: z.uuid(),
  })
  .strict();

export const supplierRequestHistorySchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    supplierDisplayName: requiredText(255),
    state: z.enum(["open", "closed", "revoked"]),
    expiresAt: utcDateTimeSchema,
    createdAt: utcDateTimeSchema,
  })
  .strict();

export const supplierDetailSchema = supplierSummarySchema
  .extend({
    contacts: z.array(supplierContactSchema),
    responsibilities: z.array(supplierResponsibilitySchema),
    requestHistory: z.array(supplierRequestHistorySchema),
  })
  .strict();

export const supplierResponseSchema = z
  .object({ supplier: supplierDetailSchema })
  .strict();
export const suppliersResponseSchema = z
  .object({
    suppliers: z
      .object({
        items: z.array(supplierSummarySchema),
        nextCursor: z.string().min(1).max(512).nullable(),
      })
      .strict(),
  })
  .strict();
export const supplierContactResponseSchema = z
  .object({ contact: supplierContactSchema })
  .strict();
export const supplierResponsibilityResponseSchema = z
  .object({ responsibility: supplierResponsibilitySchema })
  .strict();
export const supplierDuplicateCandidatesResponseSchema = z
  .object({ candidates: z.array(supplierDuplicateCandidateSchema) })
  .strict();
export const supplierDuplicateCandidatesErrorSchema = apiErrorSchema
  .extend({
    code: z.literal("duplicate_confirmation_required"),
    details: supplierDuplicateCandidatesResponseSchema,
  })
  .strict();

export const findingResponsibleSupplierSchema = z
  .object({
    supplier: supplierSummarySchema,
    responsibilityId: z.uuid(),
    occurrenceId: z.uuid(),
  })
  .strict();
export const findingResponsibleSuppliersResolutionSchema = z
  .object({
    findingId: z.uuid(),
    responsibility: z.enum(["known", "unknown"]),
    suppliers: z.array(findingResponsibleSupplierSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.responsibility === "unknown" && value.suppliers.length > 0) {
      context.addIssue({
        code: "custom",
        path: ["suppliers"],
        message: "Unknown responsibility cannot include suppliers",
      });
    }
    if (value.responsibility === "known" && value.suppliers.length === 0) {
      context.addIssue({
        code: "custom",
        path: ["suppliers"],
        message: "Known responsibility requires at least one supplier",
      });
    }
  });
export const findingResponsibleSuppliersResponseSchema = z
  .object({ resolution: findingResponsibleSuppliersResolutionSchema })
  .strict();
