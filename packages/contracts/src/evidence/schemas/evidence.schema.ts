import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

/** The policy limit is enforced again by private Storage and server inspection. */
export const EVIDENCE_MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable();
const utcDateTimeSchema = z.string().datetime({ offset: true });
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");

/**
 * Browser filenames are display/download metadata only. They cannot select a
 * parser or media type and can never contain a storage path.
 */
export const safeEvidenceFileNameSchema = z
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

export const evidenceDocumentClassSchema = z.enum([
  "risk_assessment",
  "test_report",
  "policy",
  "procedure",
  "supplier_attestation",
  "certificate",
  "architecture_document",
  "other",
]);

/** Actual type after server-side magic-byte and bounded structure inspection. */
export const evidenceMediaTypeSchema = z.enum([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const evidenceDocumentStatusSchema = z.enum([
  "uploading",
  "scan_pending",
  "clean",
  "quarantined",
  "failed",
]);

export const evidenceScanOutcomeSchema = z.enum([
  "clean",
  "detected",
  "unavailable",
  "failed",
]);

export const evidenceScanProvenanceSchema = z
  .object({
    outcome: evidenceScanOutcomeSchema,
    engineName: requiredText(120),
    engineVersion: nullableText(120),
    signatureVersion: nullableText(120),
    scannedAt: utcDateTimeSchema,
    /** Safe, bounded detector label only; never include uploaded bytes. */
    detectionName: nullableText(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.outcome === "detected" && value.detectionName === null) {
      context.addIssue({
        code: "custom",
        path: ["detectionName"],
        message: "Detected content requires a safe detector label",
      });
    }
    if (value.outcome !== "detected" && value.detectionName !== null) {
      context.addIssue({
        code: "custom",
        path: ["detectionName"],
        message: "Only detected content may carry a detector label",
      });
    }
  });

const signedStorageUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(4_096)
  .url()
  .superRefine((value, context) => {
    const parts =
      /^(https?):\/\/([^/?#:]+|\[[^\]]+\])(?::\d+)?(?:[/?#]|$)/i.exec(value);
    if (!parts) {
      context.addIssue({ code: "custom", message: "Use a valid signed URL" });
      return;
    }
    const protocol = parts[1]?.toLowerCase();
    const hostname = parts[2]?.toLowerCase();
    const loopback =
      hostname === "localhost" ||
      hostname === "127.0.0.1" ||
      hostname === "::1" ||
      hostname === "[::1]";
    if (protocol !== "https" && !(protocol === "http" && loopback)) {
      context.addIssue({
        code: "custom",
        message: "Use HTTPS or a loopback HTTP signed Storage URL",
      });
    }
  });

const evidenceUploadFieldsSchema = z
  .object({
    title: requiredText(500),
    documentClass: evidenceDocumentClassSchema,
    ownerUserId: z.uuid(),
    productIds: z
      .array(z.uuid())
      .min(1)
      .max(100)
      .superRefine((value, context) => {
        if (new Set(value).size !== value.length) {
          context.addIssue({
            code: "custom",
            message: "Applicable products must be unique",
          });
        }
      }),
    validFrom: utcDateTimeSchema.nullable(),
    validUntil: utcDateTimeSchema.nullable(),
    fileName: safeEvidenceFileNameSchema,
    /** A claim used only for an early request limit; the server recomputes it. */
    byteSize: z.number().int().min(1).max(EVIDENCE_MAX_UPLOAD_BYTES),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.validFrom !== null &&
      value.validUntil !== null &&
      new Date(value.validFrom).getTime() > new Date(value.validUntil).getTime()
    ) {
      context.addIssue({
        code: "custom",
        path: ["validUntil"],
        message: "Validity end must be on or after validity start",
      });
    }
  });

export const initializeEvidenceUploadInputSchema = evidenceUploadFieldsSchema;
/** Appends an immutable version; the expected id makes stale edits explicit. */
export const createEvidenceReplacementInputSchema = evidenceUploadFieldsSchema
  .extend({
    documentId: z.uuid(),
    expectedCurrentVersionId: z.uuid(),
  })
  .strict();
export const completeEvidenceUploadInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const evidenceDocumentParamsSchema = z
  .object({ documentId: z.uuid() })
  .strict();
export const evidenceDocumentVersionParamsSchema = z
  .object({ documentId: z.uuid(), versionId: z.uuid() })
  .strict();
export const evidenceDocumentAccessParamsSchema = z
  .object({ productId: z.uuid(), documentId: z.uuid(), versionId: z.uuid() })
  .strict();
export const evidenceDeliveryParamsSchema = z
  .object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
  .strict();
export const evidenceUploadVersionParamsSchema = z
  .object({ versionId: z.uuid() })
  .strict();
export const evidenceProductParamsSchema = z
  .object({ productId: z.uuid() })
  .strict();

export const evidenceDocumentListQuerySchema = z
  .object({
    status: evidenceDocumentStatusSchema.optional(),
    documentClass: evidenceDocumentClassSchema.optional(),
    cursor: z.string().trim().min(1).max(500).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export const evidenceDocumentVersionSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    organizationId: z.uuid(),
    versionNumber: z.number().int().positive(),
    title: requiredText(500),
    documentClass: evidenceDocumentClassSchema,
    ownerUserId: z.uuid(),
    productIds: z.array(z.uuid()).min(1).max(100),
    validFrom: utcDateTimeSchema.nullable(),
    validUntil: utcDateTimeSchema.nullable(),
    fileName: safeEvidenceFileNameSchema,
    mediaType: evidenceMediaTypeSchema.nullable(),
    byteSize: z.number().int().min(1).max(EVIDENCE_MAX_UPLOAD_BYTES).nullable(),
    sha256: sha256Schema.nullable(),
    status: evidenceDocumentStatusSchema,
    scan: evidenceScanProvenanceSchema.nullable(),
    uploadExpiresAt: utcDateTimeSchema.nullable(),
    uploadedByUserId: z.uuid(),
    completedAt: utcDateTimeSchema.nullable(),
    createdAt: utcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "clean" &&
      (value.mediaType === null ||
        value.byteSize === null ||
        value.sha256 === null ||
        value.scan?.outcome !== "clean")
    ) {
      context.addIssue({
        code: "custom",
        message: "Clean versions require verified content and a clean scan",
      });
    }
    if (value.status === "quarantined" && value.scan?.outcome !== "detected") {
      context.addIssue({
        code: "custom",
        message: "Quarantined versions require a detection result",
      });
    }
  });

export const evidenceDocumentSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    currentVersionId: z.uuid(),
    currentVersion: evidenceDocumentVersionSchema,
    createdByUserId: z.uuid(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.currentVersion.documentId !== value.id ||
      value.currentVersion.id !== value.currentVersionId
    ) {
      context.addIssue({
        code: "custom",
        message: "Current version must belong to this evidence document",
      });
    }
  });

export const evidenceDocumentListItemSchema = z
  .object({
    document: evidenceDocumentSchema,
    linkageCount: z.number().int().nonnegative(),
  })
  .strict();

export const evidenceUploadInstructionSchema = z
  .object({ uploadUrl: signedStorageUrlSchema, expiresAt: utcDateTimeSchema })
  .strict();
export const evidenceUploadInitializationResponseSchema = z
  .object({
    document: evidenceDocumentSchema,
    upload: evidenceUploadInstructionSchema,
  })
  .strict();

export const evidenceUploadCompletionSchema = z.discriminatedUnion("outcome", [
  z
    .object({
      outcome: z.literal("scan_pending"),
      version: evidenceDocumentVersionSchema,
    })
    .strict(),
  z
    .object({
      outcome: z.literal("replayed"),
      version: evidenceDocumentVersionSchema,
    })
    .strict(),
]);
export const evidenceUploadCompletionResponseSchema = z
  .object({ completion: evidenceUploadCompletionSchema })
  .strict();
export const evidenceDocumentResponseSchema = z
  .object({ document: evidenceDocumentSchema })
  .strict();
export const evidenceDocumentVersionsResponseSchema = z
  .object({ versions: z.array(evidenceDocumentVersionSchema).max(100) })
  .strict();
export const evidenceDocumentVersionResponseSchema = z
  .object({ version: evidenceDocumentVersionSchema })
  .strict();
export const evidenceDocumentListResponseSchema = z
  .object({
    items: z.array(evidenceDocumentListItemSchema).max(100),
    nextCursor: z.string().trim().min(1).max(500).nullable(),
  })
  .strict();
export const evidenceDocumentAccessInputSchema = z
  .object({
    purpose: requiredText(500).optional(),
    disposition: z.enum(["inline", "attachment"]).default("attachment"),
  })
  .strict();

export const evidenceDocumentAccessResponseSchema = z
  .object({
    access: z
      .object({
        /** Opaque same-origin, application-mediated delivery URL; never Storage. */
        deliveryUrl: z.string().startsWith("/api/v1/evidence-delivery/"),
        expiresAt: utcDateTimeSchema,
        fileName: safeEvidenceFileNameSchema,
        mediaType: evidenceMediaTypeSchema,
        disposition: z.enum(["inline", "attachment"]),
        previewSupported: z.boolean(),
      })
      .strict(),
  })
  .strict();

/** @deprecated Use evidenceDocumentAccessResponseSchema. */
export const evidenceOriginalDownloadResponseSchema =
  evidenceDocumentAccessResponseSchema;
