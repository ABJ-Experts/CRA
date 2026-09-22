import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  evidenceDocumentClassSchema,
  safeEvidenceFileNameSchema,
} from "../../evidence/schemas/evidence.schema.js";
import { z } from "zod";

const text = (maximum: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(maximum)
    .transform((value) => value.normalize("NFC"));
const safeText = (maximum: number) =>
  text(maximum).refine(
    (value) => !/[\p{Cc}\p{Cf}]/u.test(value),
    "Control characters are not allowed",
  );
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const token = z
  .string()
  .trim()
  .min(32)
  .max(1024)
  .regex(/^[A-Za-z0-9_-]+$/, "Use an opaque URL-safe bearer");
const fingerprint = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a SHA-256 fingerprint");
/** M9-02 delegates finalization to the current M8 scanner contract. */
export const supplierEvidenceUploadMediaTypeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
]);

export const supplierEvidenceRequestStateSchema = z.enum([
  "draft",
  "open",
  "closed",
  "revoked",
]);
export const supplierEvidenceInvitationStateSchema = z.enum([
  "active",
  "revoked",
  "expired",
]);
export const supplierEvidenceSubmissionStateSchema = z.enum([
  "uploading",
  "scan_pending",
  "submitted_pending_review",
  "rejected",
  "failed",
]);

export const supplierEvidenceRequestParamsSchema = z
  .object({ requestId: z.uuid() })
  .strict();
export const supplierEvidenceRevisionParamsSchema = z
  .object({ requestId: z.uuid(), revisionId: z.uuid() })
  .strict();
export const supplierEvidencePortalSubmissionParamsSchema = z
  .object({ versionId: z.uuid() })
  .strict();

export const supplierEvidenceChecklistItemInputSchema = z
  .object({
    title: safeText(160),
    instructions: safeText(2_000).optional(),
    documentClass: evidenceDocumentClassSchema,
  })
  .strict();

const requestContentSchema = z
  .object({
    title: safeText(160),
    instructions: safeText(10_000).optional(),
    dueAt: timestamp,
    disclosureContent: safeText(10_000).optional(),
    items: z.array(supplierEvidenceChecklistItemInputSchema).min(1).max(25),
  })
  .strict();

export const createSupplierEvidenceRequestInputSchema = requestContentSchema
  .extend({
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const previewSupplierEvidenceRequestInputSchema = requestContentSchema
  .extend({
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
  })
  .strict();

export const reviseSupplierEvidenceRequestInputSchema = requestContentSchema
  .extend({
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    previewFingerprint: fingerprint,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const issueSupplierEvidenceRequestInputSchema = z
  .object({
    revisionId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    previewFingerprint: fingerprint,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const reissueSupplierEvidenceRequestInputSchema = z
  .object({
    expectedVersion: z.number().int().nonnegative(),
    previewFingerprint: fingerprint,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const revokeSupplierEvidenceRequestInputSchema = z
  .object({
    invitationId: z.uuid(),
    reason: safeText(1_000),
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const closeSupplierEvidenceRequestInputSchema = z
  .object({
    reason: safeText(1_000),
    expectedVersion: z.number().int().nonnegative(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const supplierEvidenceRequestListQuerySchema = z
  .object({
    productId: z.uuid().optional(),
    supplierId: z.uuid().optional(),
    state: supplierEvidenceRequestStateSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const supplierEvidenceChecklistItemSchema = z
  .object({
    id: z.uuid(),
    title: safeText(160),
    instructions: safeText(2_000).nullable(),
    documentClass: evidenceDocumentClassSchema,
    position: z.number().int().nonnegative(),
  })
  .strict();

export const supplierEvidenceRevisionSchema = z
  .object({
    id: z.uuid(),
    revisionNumber: z.number().int().positive(),
    title: safeText(160),
    instructions: safeText(10_000).nullable(),
    dueAt: timestamp,
    disclosureContent: safeText(10_000).nullable(),
    disclosureFingerprint: fingerprint,
    items: z.array(supplierEvidenceChecklistItemSchema).max(25),
    createdAt: timestamp,
    createdBy: z.uuid(),
  })
  .strict();

export const supplierEvidenceInvitationSchema = z
  .object({
    id: z.uuid(),
    state: supplierEvidenceInvitationStateSchema,
    expiresAt: timestamp,
    issuedAt: timestamp,
    revokedAt: timestamp.nullable(),
    revisionId: z.uuid(),
  })
  .strict();

export const supplierEvidenceRequestSummarySchema = z
  .object({
    id: z.uuid(),
    supplierId: z.uuid(),
    productId: z.uuid(),
    recipientContactId: z.uuid(),
    ownerUserId: z.uuid(),
    state: supplierEvidenceRequestStateSchema,
    version: z.number().int().nonnegative(),
    currentRevision: supplierEvidenceRevisionSchema,
    activeInvitation: supplierEvidenceInvitationSchema.nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const supplierEvidenceRequestDetailSchema =
  supplierEvidenceRequestSummarySchema
    .extend({
      revisions: z.array(supplierEvidenceRevisionSchema),
      invitations: z.array(supplierEvidenceInvitationSchema),
    })
    .strict();

export const supplierEvidenceRequestResponseSchema = z
  .object({ request: supplierEvidenceRequestDetailSchema })
  .strict();
export const supplierEvidenceRequestsResponseSchema = z
  .object({
    requests: z.array(supplierEvidenceRequestSummarySchema),
    nextCursor: z.string().nullable(),
  })
  .strict();
export const supplierEvidencePreviewSchema = z
  .object({
    fingerprint,
    portalPayload: z
      .object({
        title: safeText(160),
        instructions: safeText(10_000).nullable(),
        disclosureContent: safeText(10_000).nullable(),
        dueAt: timestamp,
        items: z.array(supplierEvidenceChecklistItemSchema),
      })
      .strict(),
  })
  .strict();
export const supplierEvidencePreviewResponseSchema = z
  .object({ preview: supplierEvidencePreviewSchema })
  .strict();

export const supplierEvidenceIssuedResponseSchema = z
  .object({
    request: supplierEvidenceRequestDetailSchema,
    invitation: supplierEvidenceInvitationSchema,
  })
  .strict();

export const supplierEvidencePortalSessionInputSchema = z
  .object({
    invitationToken: token,
  })
  .strict();

export const supplierEvidencePortalSubmissionSchema = z
  .object({
    id: z.uuid(),
    checklistItemId: z.uuid(),
    state: supplierEvidenceSubmissionStateSchema,
    fileName: safeEvidenceFileNameSchema,
    mediaType: supplierEvidenceUploadMediaTypeSchema,
    byteSize: z.number().int().nonnegative().max(EVIDENCE_MAX_UPLOAD_BYTES),
    sha256,
    rejectionReason: safeText(500).nullable(),
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();

export const supplierEvidencePortalRequestSchema = z
  .object({
    requestReference: z.string().trim().min(8).max(120),
    title: safeText(160),
    instructions: safeText(10_000).nullable(),
    disclosureContent: safeText(10_000).nullable(),
    dueAt: timestamp,
    items: z.array(supplierEvidenceChecklistItemSchema),
    submissions: z.array(supplierEvidencePortalSubmissionSchema),
  })
  .strict();

export const supplierEvidencePortalSessionSchema = z
  .object({
    sessionToken: token,
    expiresAt: timestamp,
    request: supplierEvidencePortalRequestSchema,
  })
  .strict();
export const supplierEvidencePortalSessionResponseSchema = z
  .object({ session: supplierEvidencePortalSessionSchema })
  .strict();

export const initializeSupplierEvidencePortalUploadInputSchema = z
  .object({
    sessionToken: token,
    checklistItemId: z.uuid(),
    fileName: safeEvidenceFileNameSchema,
    mediaType: supplierEvidenceUploadMediaTypeSchema,
    byteSize: z.number().int().positive().max(EVIDENCE_MAX_UPLOAD_BYTES),
    sha256,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const supplierEvidenceUploadSchema = z
  .object({ uploadUrl: z.string().url().max(4096), expiresAt: timestamp })
  .strict();
export const supplierEvidencePortalUploadInitializationResponseSchema = z
  .object({
    submission: supplierEvidencePortalSubmissionSchema,
    versionId: z.uuid(),
    upload: supplierEvidenceUploadSchema,
  })
  .strict();
export const completeSupplierEvidencePortalUploadInputSchema = z
  .object({ sessionToken: token, idempotencyKey: idempotencyKeySchema })
  .strict();
export const supplierEvidencePortalUploadCompletionResponseSchema = z
  .object({ submission: supplierEvidencePortalSubmissionSchema })
  .strict();
