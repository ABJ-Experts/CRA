import { z } from "zod";
import {
  DIAGNOSTIC_DISCLOSURE_VERSION,
  DIAGNOSTIC_LIMITS,
} from "../constants.js";
import {
  diagnosticConfigurationSchema,
  diagnosticDigestSchema,
  diagnosticLogSchema,
  diagnosticManifestSchema,
  diagnosticMetricSchema,
  diagnosticOmissionSchema,
  diagnosticOmissionsSchema,
  diagnosticSelectionSchema,
  diagnosticTimestampSchema,
} from "./diagnostic-values.schema.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const safeCode = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const blockers = z.array(safeCode).max(30);
const cursor = z.uuid().nullable();
export const diagnosticJobSchema = z.strictObject({
  id: z.uuid(),
  organizationId: z.uuid(),
  state: z.enum([
    "queued",
    "running",
    "ready",
    "failed",
    "cancelled",
    "expired",
    "deleted",
  ]),
  stage: z.enum([
    "queued",
    "collecting",
    "redacting",
    "packaging",
    "ready",
    "cleanup",
  ]),
  version: count.positive(),
  consentedAt: diagnosticTimestampSchema,
  createdAt: diagnosticTimestampSchema,
  completedAt: diagnosticTimestampSchema.nullable(),
  expiresAt: diagnosticTimestampSchema.nullable(),
  selection: diagnosticSelectionSchema,
  progress: z
    .strictObject({ completed: count, total: count })
    .refine(
      (progress) => progress.completed <= progress.total,
      "Completed progress must not exceed total",
    ),
  omissions: diagnosticOmissionsSchema,
  artifact: z
    .strictObject({
      sha256: diagnosticDigestSchema,
      byteSize: count.max(DIAGNOSTIC_LIMITS.maxBundleBytes),
      fileName: z.string().regex(/^support-diagnostics-[0-9a-f-]{36}\.zip$/),
    })
    .nullable(),
  failureCode: safeCode.nullable(),
  cleanup: z.strictObject({
    state: z.enum(["none", "requested", "deleting", "deleted", "blocked"]),
    blockers,
  }),
});
export const diagnosticListSchema = z.strictObject({
  organizationId: z.uuid(),
  items: z.array(diagnosticJobSchema).max(100),
  nextCursor: cursor,
});
const contentBase = {
  organizationId: z.uuid(),
  jobId: z.uuid(),
  manifest: diagnosticManifestSchema,
  nextOffset: count.nullable(),
};
export const diagnosticContentSchema = z.discriminatedUnion("section", [
  z.strictObject({
    ...contentBase,
    section: z.literal("logs"),
    data: z.array(diagnosticLogSchema).max(100),
  }),
  z.strictObject({
    ...contentBase,
    section: z.literal("configuration"),
    data: diagnosticConfigurationSchema.nullable(),
  }),
  z.strictObject({
    ...contentBase,
    section: z.literal("metrics"),
    data: z.array(diagnosticMetricSchema).max(100),
  }),
  z.strictObject({
    ...contentBase,
    section: z.literal("omissions"),
    data: z.array(diagnosticOmissionSchema).max(100),
  }),
]);
export const diagnosticGrantSchema = z.strictObject({
  organizationId: z.uuid(),
  jobId: z.uuid(),
  grantId: z.uuid(),
  downloadPath: z
    .string()
    .regex(
      /^\/api\/v1\/system\/diagnostics\/bundles\/[0-9a-f-]{36}\/download\/[0-9a-f-]{36}$/,
    ),
  expiresAt: diagnosticTimestampSchema,
});
export const diagnosticCleanupReviewSchema = z.strictObject({
  organizationId: z.uuid(),
  jobId: z.uuid(),
  eligible: z.boolean(),
  blockers,
  reviewFingerprint: diagnosticDigestSchema,
});

const fieldNames = z
  .array(z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,63}$/))
  .max(20);
const example = z.string().min(1).max(500);
export const diagnosticPreviewSchema = z.strictObject({
  organizationId: z.uuid(),
  disclosureVersion: z.literal(DIAGNOSTIC_DISCLOSURE_VERSION),
  selection: diagnosticSelectionSchema,
  estimate: z.strictObject({
    maxBytes: z.literal(DIAGNOSTIC_LIMITS.maxBundleBytes),
    maxLogRows: z.literal(DIAGNOSTIC_LIMITS.maxLogRows),
    measured: z.literal(false),
  }),
  fields: z.strictObject({
    logs: fieldNames,
    configuration: fieldNames,
    metrics: fieldNames,
  }),
  examples: z.strictObject({
    logs: example,
    configuration: example,
    metrics: example,
  }),
  previewToken: z.string().min(1).max(8192),
  expiresAt: diagnosticTimestampSchema,
});
