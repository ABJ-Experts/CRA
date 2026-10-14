import { z } from "zod";
import {
  diagnosticDigestSchema,
  diagnosticSectionSchema,
  diagnosticSelectionSchema,
} from "./diagnostic-values.schema.js";

export const diagnosticPreviewInputSchema = diagnosticSelectionSchema;
export const diagnosticCreateSchema = z.strictObject({
  previewToken: z.string().min(1).max(8192),
  consent: z.literal(true),
  idempotencyKey: z.uuid(),
});
export const diagnosticMutationSchema = z.strictObject({
  expectedVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  idempotencyKey: z.uuid(),
});
export const diagnosticCleanupInputSchema = diagnosticMutationSchema.extend({
  reviewFingerprint: diagnosticDigestSchema,
});
export const diagnosticJobParamsSchema = z.strictObject({ jobId: z.uuid() });
export const diagnosticDownloadParamsSchema = diagnosticJobParamsSchema.extend({
  grantId: z.uuid(),
});

// HTTP query strings are accepted; booleans and empty values are not numbers.
const queryInteger = z
  .union([z.number(), z.string().regex(/^\d+$/).transform(Number)])
  .pipe(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER));
export const diagnosticListQuerySchema = z.strictObject({
  cursor: z.uuid().optional(),
  limit: queryInteger.pipe(z.number().min(1).max(100)).default(25),
});
export const diagnosticContentQuerySchema = z.strictObject({
  section: diagnosticSectionSchema.default("logs"),
  offset: queryInteger.default(0),
  limit: queryInteger.pipe(z.number().min(1).max(100)).default(100),
});
