import { z } from "zod";

import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";

const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const cursorSchema = requiredText(512);
const utcDateTimeSchema = z.string().datetime({ offset: true });
const percentageSchema = z.number().min(0).max(100);

/** A diff is always source-scoped so a shared immutable document retains release lineage. */
export const sbomSourceDiffParamsSchema = z
  .object({ sourceId: z.uuid() })
  .strict();
export const sbomDiffParamsSchema = z.object({ diffId: z.uuid() }).strict();

export const sbomDiffReportStateSchema = z.enum([
  "queued",
  "processing",
  "completed",
  "failed",
]);
export const sbomDiffJobStageSchema = z.enum([
  "queued",
  "projecting_identities",
  "comparing",
  "recording_changes",
  "completed",
  "failed",
]);
export const sbomDiffComparisonStatusSchema = z.enum([
  "ready",
  "identical",
  "no_comparable_version",
  "partial_integration_unavailable",
  "failed",
]);
export const sbomComponentChangeKindSchema = z.enum([
  "added",
  "removed",
  "unchanged",
  "upgraded",
  "downgraded",
  "unresolved",
]);
export const sbomFindingDeltaStatusSchema = z.enum([
  "available",
  "partial_integration_unavailable",
]);
export const sbomFindingDeltaKindSchema = z.enum([
  "new",
  "removed",
  "resolved",
  "unchanged",
]);
export const sbomFindingDeltaOriginSchema = z.enum([
  "component_change",
  "advisory_reevaluation",
]);

export const sbomDiffProgressSchema = z
  .object({
    stage: sbomDiffJobStageSchema,
    percent: z.number().int().min(0).max(100),
    message: requiredText(500),
  })
  .strict();

export const sbomDiffErrorSchema = z
  .object({
    code: z.enum([
      "baseline_unavailable",
      "normalized_document_missing",
      "normalizer_version_mismatch",
      "diff_persistence_unavailable",
      "diff_statement_timeout",
      "diff_calculation_failed",
      "provider_unavailable",
      "unexpected_failure",
    ]),
    message: requiredText(500),
    retryable: z.boolean(),
  })
  .strict();

export const sbomDiffSummarySchema = z
  .object({
    componentChanges: z.number().int().nonnegative(),
  })
  .strict();

export const sbomFindingDeltaSchema = z
  .object({
    status: sbomFindingDeltaStatusSchema,
    reason: requiredText(500).nullable(),
    summary: z
      .object({
        new: z.number().int().nonnegative(),
        removed: z.number().int().nonnegative(),
        resolved: z.number().int().nonnegative(),
        unchanged: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.status === "available" && value.summary === null) {
      context.addIssue({
        code: "custom",
        path: ["summary"],
        message: "Available finding deltas require a summary",
      });
    }
    if (value.status === "partial_integration_unavailable" && !value.reason) {
      context.addIssue({
        code: "custom",
        path: ["reason"],
        message: "Unavailable finding deltas require an explanation",
      });
    }
  });

export const sbomDiffReportSchema = z
  .object({
    id: z.uuid(),
    releaseId: z.uuid(),
    sourceId: z.uuid(),
    baselineSourceId: z.uuid(),
    documentId: z.uuid(),
    baselineDocumentId: z.uuid(),
    state: sbomDiffReportStateSchema,
    comparisonStatus: sbomDiffComparisonStatusSchema,
    comparatorVersion: requiredText(120),
    counts: sbomDiffSummarySchema,
    findingDelta: sbomFindingDeltaSchema,
    progress: sbomDiffProgressSchema,
    error: sbomDiffErrorSchema.nullable(),
    completedAt: utcDateTimeSchema.nullable(),
    createdAt: utcDateTimeSchema,
    updatedAt: utcDateTimeSchema,
  })
  .strict()
  .superRefine((report, context) => {
    if (report.state === "completed" && report.completedAt === null) {
      context.addIssue({
        code: "custom",
        path: ["completedAt"],
        message: "Completed diffs require a completion timestamp",
      });
    }
  });

export const createSbomDiffInputSchema = z
  .object({
    baseSourceId: z.uuid().optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const sbomSourceDiffQuerySchema = z
  .object({ baseSourceId: z.uuid().optional() })
  .strict();
export const retrySbomDiffInputSchema = z
  .object({ idempotencyKey: idempotencyKeySchema })
  .strict();

export const sbomDiffComponentChangeSchema = z
  .object({
    id: z.uuid(),
    diffId: z.uuid(),
    identity: requiredText(4_096).nullable(),
    ecosystem: requiredText(120).nullable(),
    change: sbomComponentChangeKindSchema,
    currentComponentId: z.uuid().nullable(),
    baselineComponentId: z.uuid().nullable(),
    currentSourceOffset: z.number().int().nonnegative().nullable(),
    baselineSourceOffset: z.number().int().nonnegative().nullable(),
    currentPurl: requiredText(4_096).nullable(),
    baselinePurl: requiredText(4_096).nullable(),
    currentVersion: requiredText(1_024).nullable(),
    baselineVersion: requiredText(1_024).nullable(),
    explanation: requiredText(1_000),
    createdAt: utcDateTimeSchema,
  })
  .strict();

export const sbomDiffComponentsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
    change: sbomComponentChangeKindSchema.optional(),
    ecosystem: requiredText(120).optional(),
    q: requiredText(512).optional(),
  })
  .strict();
export const sbomDiffComponentsResponseSchema = z
  .object({
    changes: z.array(sbomDiffComponentChangeSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

export const sbomFindingDeltaItemSchema = z
  .object({
    findingId: z.uuid(),
    change: sbomFindingDeltaKindSchema,
    origin: sbomFindingDeltaOriginSchema,
    explanation: requiredText(1_000),
  })
  .strict();
export const sbomDiffFindingsQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(50),
    cursor: cursorSchema.optional(),
  })
  .strict();
export const sbomDiffFindingsResponseSchema = z
  .object({
    status: sbomFindingDeltaStatusSchema,
    reason: requiredText(500).nullable(),
    findings: z.array(sbomFindingDeltaItemSchema).max(100),
    nextCursor: cursorSchema.nullable(),
  })
  .strict();

export const sbomDiffReportResponseSchema = z
  .object({ report: sbomDiffReportSchema })
  .strict();
export const sbomDiffStartResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("queued"),
      report: sbomDiffReportSchema,
      replayed: z.boolean(),
    })
    .strict(),
  z
    .object({
      status: z.literal("no_comparable_version"),
      sourceId: z.uuid(),
      reason: requiredText(500),
    })
    .strict(),
]);
export const sbomSourceDiffResponseSchema = z.discriminatedUnion("status", [
  z
    .object({ status: z.literal("found"), report: sbomDiffReportSchema })
    .strict(),
  z
    .object({
      status: z.literal("not_started"),
      sourceId: z.uuid(),
      baselineSourceId: z.uuid(),
    })
    .strict(),
  z
    .object({
      status: z.literal("no_comparable_version"),
      sourceId: z.uuid(),
      reason: requiredText(500),
    })
    .strict(),
]);

export const sbomDiffRateSchema = z
  .object({ value: percentageSchema, label: requiredText(120) })
  .strict();
