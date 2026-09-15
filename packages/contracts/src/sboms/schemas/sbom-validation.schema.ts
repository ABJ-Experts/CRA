import { z } from "zod";

import { sbomSourceSchema } from "./sbom.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const cursorSchema = requiredText(512);

export const sbomValidationStatusSchema = z.enum([
  "pending",
  "valid",
  "valid_with_warnings",
  "invalid",
]);

export const sbomDetectedFormatSchema = z.enum(["cyclonedx", "spdx"]);
export const sbomDetectedSerializationSchema = z.enum([
  "json",
  "xml",
  "tag_value",
]);

export const sbomValidationDiagnosticSeveritySchema = z.enum([
  "error",
  "warning",
]);

export const sbomValidationDiagnosticSchema = z
  .object({
    severity: sbomValidationDiagnosticSeveritySchema,
    code: requiredText(120),
    location: requiredText(500),
    message: requiredText(1_000),
    remediation: requiredText(1_000),
  })
  .strict();

export const sbomValidatorMetadataSchema = z
  .object({
    name: requiredText(120),
    version: requiredText(80),
    schemaAssetSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();

export const sbomValidationDetectionSchema = z
  .object({
    format: sbomDetectedFormatSchema,
    serialization: sbomDetectedSerializationSchema,
    specificationVersion: requiredText(40),
  })
  .strict();

export const sbomValidationReportSchema = z
  .object({
    status: sbomValidationStatusSchema,
    detected: sbomValidationDetectionSchema.nullable(),
    validator: sbomValidatorMetadataSchema.nullable(),
    diagnostics: z.array(sbomValidationDiagnosticSchema).max(100),
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    omittedDiagnosticCount: z.number().int().min(0),
    completedAt: utcDateTimeSchema.nullable(),
  })
  .strict()
  .superRefine((report, context) => {
    if (report.status === "pending" && report.completedAt !== null) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Pending validation reports cannot be completed",
      });
    }
    if (report.status !== "pending" && report.completedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Terminal validation reports require a completion time",
      });
    }
    if (report.status === "pending" && report.validator !== null) {
      context.addIssue({
        code: "custom",
        path: ["validator"],
        message: "Pending validation reports cannot have validator metadata",
      });
    }
    if (report.status !== "pending" && report.validator === null) {
      context.addIssue({
        code: "custom",
        path: ["validator"],
        message: "Terminal validation reports require validator metadata",
      });
    }
  });

export const sbomValidationSummarySchema = z
  .object({
    status: sbomValidationStatusSchema,
    errorCount: z.number().int().min(0),
    warningCount: z.number().int().min(0),
    omittedDiagnosticCount: z.number().int().min(0),
    completedAt: utcDateTimeSchema.nullable(),
  })
  .strict();

export const sbomSourceHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: cursorSchema.optional(),
  })
  .strict();

export const sbomSourceHistoryItemSchema = z
  .object({
    source: sbomSourceSchema,
    validation: sbomValidationSummarySchema,
  })
  .strict();

export const sbomSourceHistoryResponseSchema = z
  .object({
    sources: z.array(sbomSourceHistoryItemSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

export const sbomValidationReportResponseSchema = z
  .object({
    source: sbomSourceSchema,
    report: sbomValidationReportSchema,
  })
  .strict();
