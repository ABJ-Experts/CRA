import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  evidenceDocumentClassSchema,
  evidenceDocumentSchema,
  evidenceUploadInstructionSchema,
  safeEvidenceFileNameSchema,
} from "./evidence.schema.js";
import { z } from "zod";

export const EVIDENCE_BULK_INTAKE_MAX_ITEMS = 20;
export const EVIDENCE_BULK_INTAKE_MAX_BYTES = 250 * 1024 * 1024;

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const utcDateTimeSchema = z.string().datetime({ offset: true });

const productIdsSchema = z
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
  });

export const evidenceBulkIntakeClassificationSourceSchema =
  z.literal("filename_rules_v1");
export const evidenceBulkIntakeClassificationDecisionSchema = z.enum([
  "unconfirmed",
  "accepted",
  "corrected",
]);

const evidenceBulkIntakeItemMetadataShape = {
  clientItemId: z.uuid(),
  idempotencyKey: idempotencyKeySchema,
  title: requiredText(500),
  ownerUserId: z.uuid(),
  productIds: productIdsSchema,
  validFrom: utcDateTimeSchema.nullable(),
  validUntil: utcDateTimeSchema.nullable(),
  fileName: safeEvidenceFileNameSchema,
  byteSize: z.number().int().min(1).max(EVIDENCE_MAX_UPLOAD_BYTES),
};

const evidenceBulkIntakeItemMetadataSchema = z
  .object(evidenceBulkIntakeItemMetadataShape)
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

export const createEvidenceBulkIntakeBatchInputSchema = z
  .object({
    idempotencyKey: idempotencyKeySchema,
    items: z
      .array(evidenceBulkIntakeItemMetadataSchema)
      .min(1)
      .max(EVIDENCE_BULK_INTAKE_MAX_ITEMS),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new Set(value.items.map((item) => item.clientItemId)).size !==
      value.items.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each bulk-intake item must have a unique client item ID",
      });
    }
    if (
      new Set(value.items.map((item) => item.idempotencyKey)).size !==
      value.items.length
    ) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Each bulk-intake item must have a unique idempotency key",
      });
    }
    const totalBytes = value.items.reduce(
      (sum, item) => sum + item.byteSize,
      0,
    );
    if (totalBytes > EVIDENCE_BULK_INTAKE_MAX_BYTES) {
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Bulk intake cannot exceed 250 MiB",
      });
    }
  });

export const evidenceBulkIntakeBatchStatusSchema = z.enum([
  "active",
  "cancelled",
  "completed",
]);
export const evidenceBulkIntakeItemStatusSchema = z.enum([
  "unconfirmed",
  "ready",
  "uploading",
  "scan_pending",
  "clean",
  "quarantined",
  "failed",
  "cancelled",
]);
export const evidenceBulkIntakeFailureCodeSchema = z.enum([
  "upload_expired",
  "upload_cancelled",
  "invalid_content",
  "scan_unavailable",
  "scan_failed",
  "malware_detected",
  "storage_failed",
  "conflict",
]);

export const evidenceBulkIntakeItemClassificationSchema = z
  .object({
    source: evidenceBulkIntakeClassificationSourceSchema,
    suggestedDocumentClass: evidenceDocumentClassSchema,
    documentClass: evidenceDocumentClassSchema.nullable(),
    decision: evidenceBulkIntakeClassificationDecisionSchema,
    decidedByUserId: z.uuid().nullable(),
    decidedAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    const confirmed =
      value.decision === "accepted" || value.decision === "corrected";
    if (confirmed !== (value.documentClass !== null)) {
      context.addIssue({
        code: "custom",
        path: ["documentClass"],
        message: "Only confirmed classifications include a document class",
      });
    }
    if (
      confirmed !== (value.decidedByUserId !== null && value.decidedAt !== null)
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Only confirmed classifications include a decision actor and time",
      });
    }
  });

export const evidenceBulkIntakeItemSchema = z
  .object({
    clientItemId: evidenceBulkIntakeItemMetadataShape.clientItemId,
    title: evidenceBulkIntakeItemMetadataShape.title,
    ownerUserId: evidenceBulkIntakeItemMetadataShape.ownerUserId,
    productIds: evidenceBulkIntakeItemMetadataShape.productIds,
    validFrom: evidenceBulkIntakeItemMetadataShape.validFrom,
    validUntil: evidenceBulkIntakeItemMetadataShape.validUntil,
    fileName: evidenceBulkIntakeItemMetadataShape.fileName,
    byteSize: evidenceBulkIntakeItemMetadataShape.byteSize,
    id: z.uuid(),
    status: evidenceBulkIntakeItemStatusSchema,
    classification: evidenceBulkIntakeItemClassificationSchema,
    documentId: z.uuid().nullable(),
    versionId: z.uuid().nullable(),
    errorCode: evidenceBulkIntakeFailureCodeSchema.nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.status === "unconfirmed" &&
      value.classification.decision !== "unconfirmed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["classification", "decision"],
        message: "Unconfirmed items must retain an unconfirmed suggestion",
      });
    }
    if (
      value.status !== "unconfirmed" &&
      value.classification.decision === "unconfirmed"
    ) {
      context.addIssue({
        code: "custom",
        path: ["classification", "decision"],
        message: "Only unconfirmed items may lack a classification decision",
      });
    }
    const hasVersion = value.documentId !== null && value.versionId !== null;
    if (
      ["uploading", "scan_pending", "clean", "quarantined"].includes(
        value.status,
      ) &&
      !hasVersion
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Uploaded bulk-intake items require a document and immutable version",
      });
    }
    if ((value.documentId === null) !== (value.versionId === null)) {
      context.addIssue({
        code: "custom",
        message: "Document and version IDs must be present together",
      });
    }
    if (value.status === "failed" && value.errorCode === null) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "Failed bulk-intake items require a safe failure code",
      });
    }
    if (value.status !== "failed" && value.errorCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["errorCode"],
        message: "Only failed bulk-intake items include a failure code",
      });
    }
  });

export const evidenceBulkIntakeBatchCountsSchema = z
  .object({
    total: z.number().int().nonnegative(),
    unconfirmed: z.number().int().nonnegative(),
    ready: z.number().int().nonnegative(),
    uploading: z.number().int().nonnegative(),
    scanPending: z.number().int().nonnegative(),
    clean: z.number().int().nonnegative(),
    quarantined: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
    cancelled: z.number().int().nonnegative(),
    success: z.number().int().nonnegative(),
    pending: z.number().int().nonnegative(),
    rejected: z.number().int().nonnegative(),
  })
  .strict();

export const evidenceBulkIntakeBatchSchema = z
  .object({
    id: z.uuid(),
    productId: z.uuid(),
    createdByUserId: z.uuid(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
    status: evidenceBulkIntakeBatchStatusSchema,
    counts: evidenceBulkIntakeBatchCountsSchema,
    items: z
      .array(evidenceBulkIntakeItemSchema)
      .max(EVIDENCE_BULK_INTAKE_MAX_ITEMS),
  })
  .strict()
  .superRefine((value, context) => {
    const actual = {
      unconfirmed: 0,
      ready: 0,
      uploading: 0,
      scanPending: 0,
      clean: 0,
      quarantined: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const item of value.items) {
      if (item.status === "scan_pending") actual.scanPending += 1;
      else actual[item.status] += 1;
    }
    if (
      value.counts.total !== value.items.length ||
      value.counts.total !==
        Object.values(actual).reduce((sum, count) => sum + count, 0)
    ) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "Bulk-intake counts must match item states",
      });
    }
    for (const [key, count] of Object.entries(actual)) {
      if (value.counts[key as keyof typeof actual] !== count) {
        context.addIssue({
          code: "custom",
          path: ["counts", key],
          message: "Bulk-intake counts must match item states",
        });
      }
    }
    if (
      value.counts.success !== actual.clean ||
      value.counts.pending !==
        actual.unconfirmed +
          actual.ready +
          actual.uploading +
          actual.scanPending ||
      value.counts.rejected !== actual.quarantined + actual.failed
    ) {
      context.addIssue({
        code: "custom",
        path: ["counts"],
        message: "Bulk-intake aggregate counts must match item states",
      });
    }
  });

export const evidenceBulkIntakeBatchResponseSchema = z
  .object({ batch: evidenceBulkIntakeBatchSchema })
  .strict();

export const evidenceBulkIntakeBatchParamsSchema = z
  .object({ productId: z.uuid(), batchId: z.uuid() })
  .strict();
export const evidenceBulkIntakeItemParamsSchema =
  evidenceBulkIntakeBatchParamsSchema.extend({ itemId: z.uuid() }).strict();

export const initializeEvidenceBulkIntakeItemInputSchema = z
  .object({
    documentClass: evidenceDocumentClassSchema,
    classificationDecision: z.enum(["accepted", "corrected"]),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
const evidenceBulkIntakeItemMutationInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();
export const completeEvidenceBulkIntakeItemInputSchema =
  evidenceBulkIntakeItemMutationInputSchema;
export const cancelEvidenceBulkIntakeItemInputSchema =
  evidenceBulkIntakeItemMutationInputSchema;
/** A failed/quarantined retry is a new immutable attempt, so it repeats review. */
export const retryEvidenceBulkIntakeItemInputSchema =
  initializeEvidenceBulkIntakeItemInputSchema
    .extend({
      fileName: safeEvidenceFileNameSchema,
      byteSize: z.number().int().min(1).max(EVIDENCE_MAX_UPLOAD_BYTES),
    })
    .strict();

export const evidenceBulkIntakeItemResponseSchema = z
  .object({ item: evidenceBulkIntakeItemSchema })
  .strict();
export const evidenceBulkIntakeItemInitializationResponseSchema = z
  .object({
    item: evidenceBulkIntakeItemSchema,
    document: evidenceDocumentSchema,
    upload: evidenceUploadInstructionSchema,
  })
  .strict();
