import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";

const uuid = z.uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/, "Use a lowercase SHA-256");
const timestamp = z.string().datetime({ offset: true });
const value = z
  .string()
  .trim()
  .min(1)
  .max(2_000)
  .transform((text) => text.normalize("NFC"));
const sourcePin = {
  productId: uuid,
  expectedRequestVersion: z.number().int().nonnegative(),
  expectedSubmissionUpdatedAt: timestamp,
  expectedEvidenceVersionId: uuid,
  expectedSha256: sha256,
  idempotencyKey: idempotencyKeySchema,
};

/** Provisional threshold; bulk confirmation stays disabled until evaluation approval. */
export const SUPPLIER_DOCUMENT_BULK_CONFIDENCE_THRESHOLD = 0.8;

export const supplierDocumentFieldKeySchema = z.enum([
  "certification_held",
  "valid_from",
  "valid_until",
  "scope",
  "contact",
  "component_version",
]);

/** Offsets index Unicode code points in the page text; end is exclusive. */
export const supplierDocumentSourceSpanSchema = z
  .object({
    page: z.number().int().positive().max(500),
    startOffset: z.number().int().nonnegative(),
    endOffset: z.number().int().positive(),
    quote: z.string().min(1).max(4_000),
  })
  .strict()
  .refine((span) => span.endOffset > span.startOffset, {
    path: ["endOffset"],
    message: "Source span end must follow start",
  });

/** Strict model output. Grounding against the stored page text is enforced after parsing. */
export const supplierDocumentCandidateSchema = z
  .object({
    fieldKey: supplierDocumentFieldKeySchema,
    candidateGroup: z.string().trim().min(1).max(80),
    originalValue: value,
    confidence: z.number().min(0).max(1),
    sourceSpan: supplierDocumentSourceSpanSchema,
  })
  .strict();

export const supplierDocumentModelOutputSchema = z
  .object({ candidates: z.array(supplierDocumentCandidateSchema).max(100) })
  .strict();

export const startSupplierDocumentExtractionInputSchema = z
  .object(sourcePin)
  .strict();

export const supplierDocumentExtractionQuerySchema = z
  .object({
    productId: uuid,
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().trim().min(1).max(512).optional(),
  })
  .strict();

export const decideSupplierDocumentFieldInputSchema = z
  .object({
    ...sourcePin,
    expectedFieldVersion: z.number().int().nonnegative(),
    decision: z.enum(["confirm", "reject"]),
    correctedValue: value.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.decision === "confirm" && !input.correctedValue) {
      context.addIssue({
        code: "custom",
        path: ["correctedValue"],
        message: "A confirmed value is required",
      });
    }
    if (input.decision === "reject" && input.correctedValue) {
      context.addIssue({
        code: "custom",
        path: ["correctedValue"],
        message: "Rejected suggestions cannot set a value",
      });
    }
  });

export const createManualSupplierDocumentFieldInputSchema = z
  .object({
    ...sourcePin,
    fieldKey: supplierDocumentFieldKeySchema,
    value,
  })
  .strict();

export const supplierDocumentFieldParamsSchema = z
  .object({ requestId: uuid, submissionId: uuid, fieldId: uuid })
  .strict();
export const supplierDocumentSubmissionParamsSchema = z
  .object({ requestId: uuid, submissionId: uuid })
  .strict();

export const supplierDocumentExtractionRunSchema = z
  .object({
    id: uuid,
    submissionId: uuid,
    evidenceVersionId: uuid,
    evidenceSha256: sha256,
    status: z.enum(["pending", "processing", "completed", "failed", "refused"]),
    model: z.string().trim().min(1).max(160),
    promptVersion: z.string().trim().min(1).max(80),
    createdAt: timestamp,
    completedAt: timestamp.nullable(),
    errorCode: z.string().trim().min(1).max(80).nullable(),
  })
  .strict();

const fieldReview = {
  id: uuid,
  fieldKey: supplierDocumentFieldKeySchema,
  version: z.number().int().nonnegative(),
  reviewedByUserId: uuid.nullable(),
  reviewedAt: timestamp.nullable(),
  createdAt: timestamp,
};

export const supplierDocumentSuggestionSchema = z.discriminatedUnion("origin", [
  supplierDocumentCandidateSchema
    .extend({
      ...fieldReview,
      origin: z.literal("ai"),
      runId: uuid,
      evidenceVersionId: uuid,
      evidenceSha256: sha256,
      model: z.string().trim().min(1).max(160),
      promptVersion: z.string().trim().min(1).max(80),
      correctedValue: value.nullable(),
      status: z.enum(["pending", "confirmed", "rejected"]),
    })
    .strict(),
  z
    .object({
      ...fieldReview,
      origin: z.literal("manual"),
      runId: z.null(),
      evidenceVersionId: uuid,
      evidenceSha256: sha256,
      model: z.null(),
      promptVersion: z.null(),
      candidateGroup: z.null(),
      originalValue: z.null(),
      correctedValue: value,
      confidence: z.null(),
      sourceSpan: z.null(),
      status: z.literal("confirmed"),
    })
    .strict(),
]);

export const supplierDocumentPageSchema = z
  .object({
    page: z.number().int().positive().max(500),
    text: z.string().max(50_000),
  })
  .strict();

export const supplierDocumentExtractionResponseSchema = z
  .object({
    run: supplierDocumentExtractionRunSchema.nullable(),
    suggestions: z.array(supplierDocumentSuggestionSchema).max(100),
    pages: z.array(supplierDocumentPageSchema).max(500),
    nextCursor: z.string().min(1).max(512).nullable(),
  })
  .strict();

export const supplierDocumentFieldResponseSchema = z
  .object({ field: supplierDocumentSuggestionSchema })
  .strict();
