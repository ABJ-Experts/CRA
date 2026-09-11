import { idempotencyKeySchema } from "./organization-input.schema.js";
import { z } from "zod";

const safeOrganizationErrorMessage =
  "Organization administration request could not be completed.";

export const organizationAdministrationErrorCodeSchema = z.enum([
  "invalid_request",
  "conflict",
  "forbidden",
  "not_found",
  "unavailable",
  "malformed_provider",
  "invalid_state",
  "verification_failed",
]);

/** A stable error shape that intentionally excludes provider and tenant details. */
export const organizationAdministrationErrorSchema = z
  .object({
    code: organizationAdministrationErrorCodeSchema,
    message: z.literal(safeOrganizationErrorMessage),
  })
  .strict();

export const exportRequestInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const organizationExportParamsSchema = z
  .object({ exportId: z.uuid() })
  .strict();

export const organizationExportStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "expired",
]);

export const exportProgressSchema = z
  .object({
    completedParts: z.number().int().nonnegative(),
    totalParts: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.completedParts > value.totalParts) {
      context.addIssue({
        code: "custom",
        message: "Completed parts cannot exceed total parts",
        path: ["completedParts"],
      });
    }
  });

export const exportManifestSchema = z
  .object({
    formatVersion: z.number().int().positive(),
    sha256: z.string().regex(/^[a-f0-9]{64}$/, "Use a SHA-256 hex digest"),
    fileCount: z.number().int().nonnegative(),
    verifiedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

const organizationExportFieldsSchema = z
  .object({
    id: z.uuid(),
    status: organizationExportStatusSchema,
    progress: exportProgressSchema,
    error: organizationAdministrationErrorSchema.nullable(),
    manifest: exportManifestSchema.nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .strict();

export const organizationExportSchema =
  organizationExportFieldsSchema.superRefine((value, context) => {
    if (value.status === "completed") {
      if (value.manifest === null) {
        context.addIssue({
          code: "custom",
          message: "Completed exports require a verified manifest",
          path: ["manifest"],
        });
      }
      if (value.progress.completedParts !== value.progress.totalParts) {
        context.addIssue({
          code: "custom",
          message: "Completed exports require all parts to be complete",
          path: ["progress", "completedParts"],
        });
      }
    }
    if (value.status === "failed" && value.error === null) {
      context.addIssue({
        code: "custom",
        message: "Failed exports require a safe error",
        path: ["error"],
      });
    }
    if (value.status !== "failed" && value.error !== null) {
      context.addIssue({
        code: "custom",
        message: "Only failed exports can contain an error",
        path: ["error"],
      });
    }
  });

export const exportRequestResponseSchema = z
  .object({ export: organizationExportSchema, idempotent: z.boolean() })
  .strict();

export const organizationExportResponseSchema = z
  .object({ export: organizationExportSchema })
  .strict();

/**
 * The current owner can rediscover the most recent durable export after a
 * browser restart. A missing export is explicit instead of being inferred from
 * browser state.
 */
export const latestOrganizationExportResponseSchema = z
  .object({ export: organizationExportSchema.nullable() })
  .strict();

export const exportAttachmentDownloadResponseSchema = z
  .object({
    url: z.url().regex(/^https:\/\//i, "Export attachment URLs must use HTTPS"),
    filename: z
      .string()
      .min(1)
      .max(255)
      .regex(/^[^/\\]+$/),
    expiresInSeconds: z.number().int().positive().max(900),
  })
  .strict();
