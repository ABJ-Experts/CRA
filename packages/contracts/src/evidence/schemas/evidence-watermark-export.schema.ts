import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import {
  EVIDENCE_MAX_UPLOAD_BYTES,
  evidenceDocumentAccessParamsSchema,
  safeEvidenceFileNameSchema,
} from "./evidence.schema.js";
import { z } from "zod";

const utcDateTimeSchema = z.string().datetime({ offset: true });
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const watermarkTextSchema = z
  .string()
  .trim()
  .min(1)
  .max(640)
  .refine(
    (value) => !/[\p{Cc}\p{Cf}]/u.test(value),
    "Use watermark text without control characters",
  )
  .transform((value) => value.normalize("NFC"));
const graphemeCount = (value: string) =>
  [...new Intl.Segmenter("und", { granularity: "grapheme" }).segment(value)]
    .length;

export const evidenceWatermarkRecipientSchema = watermarkTextSchema.refine(
  (value) => graphemeCount(value) <= 160,
  "Use a recipient of at most 160 characters",
);
export const evidenceWatermarkPurposeSchema = watermarkTextSchema.refine(
  (value) => Array.from(value).length <= 160,
  "Use a purpose of at most 160 characters",
);
export const evidenceWatermarkMediaTypeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const evidenceWatermarkExportStatusSchema = z.enum([
  "queued",
  "claimed",
  "ready",
  "failed",
  "cancelled",
]);
export const evidenceWatermarkExportFailureCodeSchema = z.enum([
  "unsupported_media_type",
  "source_not_clean",
  "source_unavailable",
  "source_integrity_failed",
  "source_malformed",
  "renderer_unavailable",
  "page_limit",
  "output_limit",
  "storage_failed",
  "cancelled",
]);

export const createEvidenceWatermarkExportInputSchema = z
  .object({
    recipient: evidenceWatermarkRecipientSchema,
    purpose: evidenceWatermarkPurposeSchema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

export const evidenceWatermarkExportCollectionParamsSchema =
  evidenceDocumentAccessParamsSchema;
export const evidenceWatermarkExportParamsSchema =
  evidenceWatermarkExportCollectionParamsSchema
    .extend({ exportId: z.uuid() })
    .strict();
export const evidenceWatermarkExportPreviewInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();
export const evidenceWatermarkExportDeliveryInputSchema =
  evidenceWatermarkExportPreviewInputSchema;
/** Opaque application-delivery token, never a Supabase Storage URL or secret field. */
export const evidenceWatermarkExportDeliveryParamsSchema = z
  .object({
    exportId: z.uuid(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();

export const evidenceWatermarkDerivativeSchema = z
  .object({
    fileName: safeEvidenceFileNameSchema,
    mediaType: evidenceWatermarkMediaTypeSchema,
    byteSize: z.number().int().min(1).max(EVIDENCE_MAX_UPLOAD_BYTES),
    sha256: sha256Schema,
    createdAt: utcDateTimeSchema,
  })
  .strict();

export const evidenceWatermarkExportSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    documentId: z.uuid(),
    sourceVersionId: z.uuid(),
    sourceSha256: sha256Schema,
    requestedByUserId: z.uuid(),
    requestedAt: utcDateTimeSchema,
    recipient: evidenceWatermarkRecipientSchema,
    purpose: evidenceWatermarkPurposeSchema,
    status: evidenceWatermarkExportStatusSchema,
    failureCode: evidenceWatermarkExportFailureCodeSchema.nullable(),
    derivative: evidenceWatermarkDerivativeSchema.nullable(),
    previewedAt: utcDateTimeSchema.nullable(),
    deliveredAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "ready" && value.derivative === null) {
      context.addIssue({
        code: "custom",
        path: ["derivative"],
        message:
          "Ready watermark exports require a derivative integrity record",
      });
    }
    if (value.status !== "ready" && value.derivative !== null) {
      context.addIssue({
        code: "custom",
        path: ["derivative"],
        message: "Only ready watermark exports include a derivative",
      });
    }
    if (value.status === "failed" && value.failureCode === null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Failed watermark exports require a safe failure code",
      });
    }
    if (value.status !== "failed" && value.failureCode !== null) {
      context.addIssue({
        code: "custom",
        path: ["failureCode"],
        message: "Only failed watermark exports include a failure code",
      });
    }
    if (
      (value.previewedAt !== null || value.deliveredAt !== null) &&
      value.status !== "ready"
    ) {
      context.addIssue({
        code: "custom",
        message: "Only ready watermark exports can be previewed or delivered",
      });
    }
    if (value.deliveredAt !== null && value.previewedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["deliveredAt"],
        message: "Watermark delivery requires a recorded preview",
      });
    }
  });

export const evidenceWatermarkExportResponseSchema = z
  .object({ export: evidenceWatermarkExportSchema })
  .strict();

export const evidenceWatermarkExportAccessSchema = z
  .object({
    deliveryUrl: z
      .string()
      .regex(/^\/api\/v1\/evidence-watermark-(preview|delivery)\//),
    expiresAt: utcDateTimeSchema,
    fileName: safeEvidenceFileNameSchema,
    mediaType: evidenceWatermarkMediaTypeSchema,
    disposition: z.enum(["inline", "attachment"]),
  })
  .strict();
export const evidenceWatermarkExportPreviewResponseSchema = z
  .object({ preview: evidenceWatermarkExportAccessSchema })
  .strict();
export const evidenceWatermarkExportDeliveryResponseSchema = z
  .object({ access: evidenceWatermarkExportAccessSchema })
  .strict();
