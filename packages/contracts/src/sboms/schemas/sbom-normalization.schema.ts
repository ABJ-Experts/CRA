import { z } from "zod";

import {
  sbomDeclaredFormatSchema,
  sbomSourceParamsSchema,
} from "./sbom.schema.js";
import { sbomValidationStatusSchema } from "./sbom-validation.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const cursorSchema = requiredText(512);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const sourceByteSchema = z
  .number()
  .int()
  .min(0)
  .max(100 * 1024 * 1024);

export const sbomNormalizationStateSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);

export const sbomNormalizerMetadataSchema = z
  .object({ name: requiredText(120), version: requiredText(80) })
  .strict();

export const sbomNormalizationDiagnosticSchema = z
  .object({
    severity: z.enum(["warning", "error"]),
    code: requiredText(120),
    location: requiredText(1_000),
    message: requiredText(1_000),
    sourceByteStart: sourceByteSchema.nullable(),
    sourceByteEnd: sourceByteSchema.nullable(),
  })
  .strict();

export const sbomDocumentParamsSchema = z
  .object({ documentId: z.uuid() })
  .strict();
export const sbomComponentParamsSchema = z
  .object({ componentId: z.uuid() })
  .strict();

export const sbomDocumentSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    format: sbomDeclaredFormatSchema,
    specificationVersion: requiredText(40),
    parser: sbomNormalizerMetadataSchema,
    normalizer: sbomNormalizerMetadataSchema,
    state: sbomNormalizationStateSchema,
    validationStatus: sbomValidationStatusSchema,
    componentCount: z.number().int().min(0).max(50_000),
    dependencyCount: z.number().int().min(0),
    maximumDepth: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    error: z
      .object({
        code: requiredText(120),
        message: requiredText(1_000),
        retryable: z.boolean(),
      })
      .strict()
      .nullable(),
    completedAt: utcDateTimeSchema.nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict();

export const sbomDocumentListQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: cursorSchema.optional(),
  })
  .strict();

export const sbomDocumentListResponseSchema = z
  .object({
    documents: z.array(sbomDocumentSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

export const sbomDocumentDetailResponseSchema = z
  .object({
    document: sbomDocumentSchema,
    diagnostics: z.array(sbomNormalizationDiagnosticSchema).max(100),
  })
  .strict();

export const sbomComponentSourceLocationSchema = z
  .object({
    path: requiredText(1_000),
    byteStart: sourceByteSchema,
    byteEnd: sourceByteSchema,
    line: z.number().int().min(1).nullable(),
  })
  .strict()
  .superRefine((location, context) => {
    if (location.byteEnd < location.byteStart) {
      context.addIssue({
        code: "custom",
        path: ["byteEnd"],
        message: "Source end must follow source start",
      });
    }
  });

export const sbomComponentHashSchema = z
  .object({ algorithm: requiredText(32), value: requiredText(1_024) })
  .strict();

export const sbomComponentSchema = z
  .object({
    id: z.uuid(),
    documentId: z.uuid(),
    documentLocalRef: requiredText(1_024),
    originalName: requiredText(1_024),
    normalizedName: requiredText(1_024),
    originalVersion: requiredText(1_024).nullable(),
    normalizedVersion: requiredText(1_024).nullable(),
    originalPurl: requiredText(4_096).nullable(),
    canonicalPurl: requiredText(4_096).nullable(),
    cpe: requiredText(4_096).nullable(),
    ecosystem: requiredText(120).nullable(),
    scope: requiredText(120).nullable(),
    supplier: requiredText(1_024).nullable(),
    licenseExpression: requiredText(4_096).nullable(),
    hashes: z.array(sbomComponentHashSchema).max(100),
    depth: z.number().int().min(0),
    parentComponentId: z.uuid().nullable(),
    sourceLocation: sbomComponentSourceLocationSchema,
  })
  .strict();

export const sbomComponentSearchQuerySchema = z
  .object({
    q: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
  })
  .strict();

export const sbomComponentSearchResponseSchema = z
  .object({
    components: z.array(sbomComponentSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

export const sbomDependencyTreeQuerySchema = z
  .object({
    parentComponentId: z.uuid().optional(),
    q: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
  })
  .strict();

export const sbomDependencyTreeItemSchema = z
  .object({
    component: sbomComponentSchema,
    childCount: z.number().int().min(0),
  })
  .strict();

export const sbomDependencyTreeResponseSchema = z
  .object({
    items: z.array(sbomDependencyTreeItemSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

/** Re-exported for route implementations that bind normalized records to immutable evidence. */
export const sbomDocumentSourceParamsSchema = sbomSourceParamsSchema;
