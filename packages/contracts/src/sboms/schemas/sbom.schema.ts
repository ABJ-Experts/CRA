import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { z } from "zod";

export const SBOM_MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const sha256Schema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const utcDateTimeSchema = z.string().datetime({ offset: true });

/**
 * The browser's accept attribute is only a hint. The same narrow allowlist is
 * enforced at every API boundary and rechecked after Storage upload.
 */
export const sbomMediaTypeSchema = z.enum([
  "application/json",
  "application/xml",
  "text/xml",
  "application/octet-stream",
  "application/vnd.cyclonedx+json",
  "application/vnd.cyclonedx+xml",
  "application/spdx+json",
  "application/spdx+xml",
]);

export const sbomSourceKindSchema = z.enum([
  "manual_upload",
  "ci_upload",
  "integration",
  "supplier",
  "generated",
]);

export const sbomSourceStatusSchema = z.enum([
  "upload_pending",
  "verified",
  "rejected",
  "expired",
]);

export const sbomJobStatusSchema = z.enum([
  "queued",
  "processing",
  "failed",
  "completed",
  "dead_letter",
]);

export const sbomJobStageSchema = z.enum([
  "queued",
  "claiming",
  "verifying_original",
  "recording_evidence",
  "completed",
  "failed",
  "dead_letter",
]);

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

const normalizedSbomMediaTypeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(sbomMediaTypeSchema);

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

const initializeSbomUploadFieldsSchema = z
  .object({
    productId: z.uuid(),
    releaseId: z.uuid(),
    fileName: safeSbomFileNameSchema,
    mediaType: normalizedSbomMediaTypeSchema,
    byteSize: z.number().int().min(1).max(SBOM_MAX_UPLOAD_BYTES),
    sha256: sha256Schema,
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();

/** Session/API callers can create only a manually attributed source. */
export const initializeSbomUploadInputSchema = initializeSbomUploadFieldsSchema
  .extend({
    source: z.literal("manual_upload").default("manual_upload"),
  })
  .strict();

/** CI callers use an ingestion-only credential and cannot choose attribution. */
export const ciInitializeSbomUploadInputSchema =
  initializeSbomUploadFieldsSchema
    .extend({
      source: z.literal("ci_upload").default("ci_upload"),
    })
    .strict();

/** Internal future producers use this schema after their source is authenticated. */
export const createSbomSourceInputSchema = initializeSbomUploadFieldsSchema
  .extend({ source: sbomSourceKindSchema })
  .strict();

export const completeSbomUploadInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const ciCompleteSbomUploadInputSchema = completeSbomUploadInputSchema;

export const sbomUploadParamsSchema = z
  .object({ productId: z.uuid(), releaseId: z.uuid(), sourceId: z.uuid() })
  .strict();
export const sbomReleaseParamsSchema = z
  .object({ productId: z.uuid(), releaseId: z.uuid() })
  .strict();
export const sbomSourceParamsSchema = z.object({ sourceId: z.uuid() }).strict();
export const sbomJobParamsSchema = z.object({ jobId: z.uuid() }).strict();

export const sbomSourceSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    source: sbomSourceKindSchema,
    fileName: safeSbomFileNameSchema,
    mediaType: sbomMediaTypeSchema,
    byteSize: z.number().int().min(1).max(SBOM_MAX_UPLOAD_BYTES),
    sha256: sha256Schema,
    status: sbomSourceStatusSchema,
    createdAt: utcDateTimeSchema,
    completedAt: utcDateTimeSchema.nullable(),
  })
  .strict();

export const sbomJobProgressSchema = z
  .object({
    stage: sbomJobStageSchema,
    percent: z.number().int().min(0).max(100),
    message: requiredText(500),
  })
  .strict();

export const sbomJobErrorSchema = z
  .object({
    code: z.enum([
      "original_missing",
      "hash_mismatch",
      "media_type_mismatch",
      "storage_unavailable",
      "persistence_unavailable",
      "unexpected_failure",
    ]),
    message: requiredText(500),
    retryable: z.boolean(),
  })
  .strict();

export const sbomJobResultSchema = z
  .object({
    outcome: z.literal("original_evidence_captured"),
    sourceId: z.uuid(),
    sha256: sha256Schema,
  })
  .strict();

export const sbomJobSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    sourceId: z.uuid(),
    releaseId: z.uuid(),
    inputSha256: sha256Schema,
    correlationId: z.uuid(),
    status: sbomJobStatusSchema,
    progress: sbomJobProgressSchema,
    attempts: z.number().int().min(0).max(5),
    maxAttempts: z.literal(5),
    error: sbomJobErrorSchema.nullable(),
    result: sbomJobResultSchema.nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
    completedAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((job, context) => {
    if (job.status === "completed" && job.result === null) {
      context.addIssue({
        code: "custom",
        message: "Completed jobs require a result",
      });
    }
    if (job.status !== "completed" && job.result !== null) {
      context.addIssue({
        code: "custom",
        message: "Only completed jobs have a result",
      });
    }
    if (
      job.status === "dead_letter" &&
      (job.error === null || job.error.retryable)
    ) {
      context.addIssue({
        code: "custom",
        message: "Dead-letter jobs require a final error",
      });
    }
  });

export const sbomJobProgressUrlSchema = z
  .string()
  .regex(
    /^\/api\/v1\/sbom-jobs\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    "Use a versioned SBOM job progress URL",
  );

export const sbomUploadInstructionSchema = z
  .object({ uploadUrl: signedStorageUrlSchema, expiresAt: utcDateTimeSchema })
  .strict();

export const sbomUploadInitializationResponseSchema = z
  .object({ source: sbomSourceSchema, upload: sbomUploadInstructionSchema })
  .strict();
export const sbomJobResponseSchema = z
  .object({ job: sbomJobSchema, progressUrl: sbomJobProgressUrlSchema })
  .strict();
export const sbomOriginalDownloadResponseSchema = z
  .object({
    download: z
      .object({
        downloadUrl: signedStorageUrlSchema,
        expiresAt: utcDateTimeSchema,
        fileName: safeSbomFileNameSchema,
        mediaType: sbomMediaTypeSchema,
      })
      .strict(),
  })
  .strict();

export const createSbomCiCredentialInputSchema = z
  .object({ label: requiredText(120), idempotencyKey: idempotencyKeySchema })
  .strict();
export const revokeSbomCiCredentialInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();
export const sbomCiCredentialParamsSchema = z
  .object({ credentialId: z.uuid() })
  .strict();
export const sbomCiCredentialSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    label: requiredText(120),
    tokenPrefix: z.string().regex(/^cra_sbom_[a-z0-9]{8}$/),
    createdAt: utcDateTimeSchema,
    createdBy: z.uuid(),
    revokedAt: utcDateTimeSchema.nullable(),
    revokedBy: z.uuid().nullable(),
    lastUsedAt: utcDateTimeSchema.nullable(),
  })
  .strict();
export const createSbomCiCredentialResponseSchema = z
  .object({
    credential: sbomCiCredentialSchema,
    secret: z.string().min(32).max(512),
  })
  .strict();
export const sbomCiCredentialListResponseSchema = z
  .object({ credentials: z.array(sbomCiCredentialSchema).max(100) })
  .strict();
export const sbomCiCredentialResponseSchema = z
  .object({ credential: sbomCiCredentialSchema })
  .strict();

export const replaySbomJobInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();
