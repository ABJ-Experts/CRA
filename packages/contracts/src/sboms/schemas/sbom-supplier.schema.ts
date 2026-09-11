import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  SBOM_MAX_UPLOAD_BYTES,
  sbomDeclaredFormatSchema,
  sbomMediaTypeSchema,
} from "./sbom.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const opaqueInvitationTokenSchema = z.string().trim().min(32).max(512);
const opaqueSessionTokenSchema = z.string().trim().min(32).max(512);
const cursorSchema = requiredText(512);
const safeSbomFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(
    (value) =>
      value !== "." &&
      value !== ".." &&
      !value.includes("/") &&
      !value.includes("\\") &&
      !/[\p{Cc}\p{Cf}]/u.test(value),
    "Use a safe filename without paths or control characters",
  )
  .transform((value) => value.normalize("NFC"));
const signedStorageUrlSchema = z.string().trim().min(1).max(4_096).url();

export const supplierSbomRequestStateSchema = z.enum([
  "open",
  "closed",
  "revoked",
]);
export const supplierSbomInvitationStateSchema = z.enum([
  "active",
  "used",
  "expired",
  "revoked",
]);
export const supplierSbomSubmissionStateSchema = z.enum([
  "pending",
  "processing",
  "validation_failed",
  "awaiting_review",
  "accepted",
  "rejected",
  "superseded",
]);

export const sbomSupplierRequestParamsSchema = z
  .object({ requestId: z.uuid() })
  .strict();
export const sbomSupplierInvitationParamsSchema = z
  .object({ invitationId: z.uuid() })
  .strict();
export const sbomSupplierSubmissionParamsSchema = z
  .object({ submissionId: z.uuid() })
  .strict();
export const sbomSupplierRequestReleaseParamsSchema = z
  .object({ productId: z.uuid(), releaseId: z.uuid() })
  .strict();

export const createSupplierSbomRequestInputSchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid(),
    supplierDisplayName: requiredText(256),
    allowedComponentRef: requiredText(512),
    expiresAt: utcDateTimeSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const createSupplierSbomInvitationInputSchema = z
  .object({
    expiresAt: utcDateTimeSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const revokeSupplierSbomInvitationInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();
export const supplierSbomPortalSessionInputSchema = z
  .object({
    invitationToken: opaqueInvitationTokenSchema,
    /** M9-generated idempotency secret; persistence stores only its hash. */
    sessionToken: opaqueSessionTokenSchema,
  })
  .strict();

export const initializeSupplierSbomUploadInputSchema = z
  .object({
    sessionToken: opaqueSessionTokenSchema,
    fileName: safeSbomFileNameSchema,
    mediaType: sbomMediaTypeSchema,
    byteSize: z.number().int().min(1).max(SBOM_MAX_UPLOAD_BYTES),
    sha256: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
    declaredFormat: sbomDeclaredFormatSchema.optional(),
    declaredSpecVersion: requiredText(40).optional(),
  })
  .strict();
export const completeSupplierSbomUploadInputSchema = z
  .object({
    sessionToken: opaqueSessionTokenSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const reviewSupplierSbomSubmissionInputSchema = z
  .object({
    decision: z.enum(["accept", "reject"]),
    reason: requiredText(2_000),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const supplierSbomRequestSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    supplierDisplayName: requiredText(256),
    allowedComponentRef: requiredText(512),
    state: supplierSbomRequestStateSchema,
    expiresAt: utcDateTimeSchema,
    createdAt: utcDateTimeSchema,
    createdBy: z.uuid(),
    closedAt: utcDateTimeSchema.nullable(),
  })
  .strict();
export const supplierSbomInvitationSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    tokenPrefix: z.string().regex(/^cra_sup_[a-z0-9]{8}$/),
    state: supplierSbomInvitationStateSchema,
    expiresAt: utcDateTimeSchema,
    createdAt: utcDateTimeSchema,
    usedAt: utcDateTimeSchema.nullable(),
    revokedAt: utcDateTimeSchema.nullable(),
  })
  .strict();
export const supplierSbomSubmissionSchema = z
  .object({
    id: z.uuid(),
    requestId: z.uuid(),
    sourceId: z.uuid().nullable(),
    state: supplierSbomSubmissionStateSchema,
    fileName: safeSbomFileNameSchema,
    mediaType: sbomMediaTypeSchema,
    byteSize: z.number().int().min(1).max(SBOM_MAX_UPLOAD_BYTES),
    sha256: sha256Schema,
    validationMessage: requiredText(2_000).nullable(),
    reviewReason: requiredText(2_000).nullable(),
    reviewedAt: utcDateTimeSchema.nullable(),
    reviewedBy: z.uuid().nullable(),
    supersededBySubmissionId: z.uuid().nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

/**
 * Public supplier-session responses intentionally exclude the linked source,
 * request, reviewer, and tenant IDs. Those IDs are useful internally but add
 * no value to a scoped upload client and would widen its observation surface.
 */
export const supplierSbomPortalSubmissionSchema = z
  .object({
    id: z.uuid(),
    state: supplierSbomSubmissionStateSchema,
    fileName: safeSbomFileNameSchema,
    mediaType: sbomMediaTypeSchema,
    byteSize: z.number().int().min(1).max(SBOM_MAX_UPLOAD_BYTES),
    sha256: sha256Schema,
    validationMessage: requiredText(2_000).nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

/** Deliberately omits tenant, product, release, and source identifiers. */
export const supplierSbomPortalSessionSchema = z
  .object({
    /** Returned only from token exchange. Callers must not persist or log it. */
    sessionToken: opaqueSessionTokenSchema,
    expiresAt: utcDateTimeSchema,
    requestReference: requiredText(256),
    allowedComponentRef: requiredText(512),
  })
  .strict();
export const supplierSbomUploadInstructionSchema = z
  .object({ uploadUrl: signedStorageUrlSchema, expiresAt: utcDateTimeSchema })
  .strict();
export const supplierSbomUploadInitializationResponseSchema = z
  .object({
    submission: supplierSbomPortalSubmissionSchema,
    upload: supplierSbomUploadInstructionSchema,
  })
  .strict();
export const supplierSbomUploadCompletionResponseSchema = z
  .object({ submission: supplierSbomPortalSubmissionSchema })
  .strict();
export const supplierSbomPortalSessionResponseSchema = z
  .object({ session: supplierSbomPortalSessionSchema })
  .strict();
export const supplierSbomRequestResponseSchema = z
  .object({ request: supplierSbomRequestSchema })
  .strict();
/** Internal review list. The portal never receives this tenant-scoped shape. */
export const supplierSbomRequestSummarySchema = z
  .object({
    request: supplierSbomRequestSchema,
    invitations: z.array(supplierSbomInvitationSchema).max(100),
    submissions: z.array(supplierSbomSubmissionSchema).max(100),
  })
  .strict();
export const supplierSbomInvitationResponseSchema = z
  .object({ invitation: supplierSbomInvitationSchema })
  .strict();
/** The opaque invitation is returned exactly once, at creation time. */
export const createSupplierSbomInvitationResponseSchema = z
  .object({
    invitation: supplierSbomInvitationSchema,
    invitationToken: opaqueInvitationTokenSchema,
  })
  .strict();
export const supplierSbomSubmissionResponseSchema = z
  .object({ submission: supplierSbomSubmissionSchema })
  .strict();
export const supplierSbomPortalSubmissionResponseSchema = z
  .object({ submission: supplierSbomPortalSubmissionSchema })
  .strict();
export const supplierSbomRequestsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
    productId: z.uuid().optional(),
    releaseId: z.uuid().optional(),
    state: supplierSbomRequestStateSchema.optional(),
  })
  .strict();
export const supplierSbomRequestsResponseSchema = z
  .object({
    requests: z.array(supplierSbomRequestSummarySchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();
export const supplierSbomSubmissionsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
    requestId: z.uuid().optional(),
    state: supplierSbomSubmissionStateSchema.optional(),
  })
  .strict();
export const supplierSbomSubmissionsResponseSchema = z
  .object({
    submissions: z.array(supplierSbomSubmissionSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();
