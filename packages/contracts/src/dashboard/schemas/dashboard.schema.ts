import { z } from "zod";
import { utcZDateTimeSchema as timestamp } from "../../products/schemas/release-market-lifecycle.schema.js";
import { productClassificationSchema } from "../../products/schemas/product-classification.schema.js";
import {
  reportingObligationTypeSchema,
  reportingObligationStatusSchema,
  reportingObligationStageKindSchema,
  reportingObligationStageStateSchema,
} from "../../reporting/schemas/reporting-obligations.schema.js";
import {
  technicalFileReadinessStatusSchema,
  technicalFileReadinessGapSchema,
} from "../../technical-files/schemas/technical-file-readiness.schema.js";
import { technicalFileSectionKeySchema } from "../../technical-files/schemas/technical-file.schema.js";
import { vulnerabilityTriageSeveritySchema } from "../../vulnerabilities/schemas/vulnerability-triage.schema.js";
import {
  vulnerabilityFeedKeySchema,
  vulnerabilityFeedStatusSchema,
  vulnerabilityFeedFreshnessSchema,
} from "../../vulnerabilities/schemas/vulnerability-feed.schema.js";
import { sbomJobStatusSchema } from "../../sboms/schemas/sbom.schema.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(500);
const observations = {
  observedAt: timestamp.nullable(),
  updatedAt: timestamp.nullable(),
};
/** Hidden and failed sources carry no data, counts or identifiers. */
export function dashboardSectionSchema<T extends z.ZodType>(data: T) {
  return z.discriminatedUnion("state", [
    z.object({ state: z.literal("available"), ...observations, data }).strict(),
    z.object({ state: z.literal("empty"), ...observations, data }).strict(),
    z.object({ state: z.literal("stale"), ...observations, data }).strict(),
    z.object({ state: z.literal("restricted"), ...observations }).strict(),
    z.object({ state: z.literal("not_initialized"), ...observations }).strict(),
    z.object({ state: z.literal("unavailable"), ...observations }).strict(),
  ]);
}
export const dashboardCursorSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{1,2048}$/);
const limit = z.preprocess(
  (value) =>
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(100).default(20),
);
const booleanQuery = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean().default(false),
);
const pageQuery = {
  productId: z.uuid().optional(),
  cursor: dashboardCursorSchema.optional(),
  limit,
};
export const dashboardOverviewQuerySchema = z.object({}).strict();
export const dashboardProductPostureParamsSchema = z
  .object({ productId: z.uuid() })
  .strict();
export const dashboardProductPostureQuerySchema = z.object({}).strict();
export const dashboardObligationsQuerySchema = z
  .object({
    ...pageQuery,
    state: z.enum(["active", "history"]).default("active"),
  })
  .strict();
export const dashboardReadinessQuerySchema = z.object(pageQuery).strict();
export const dashboardIngestionQuerySchema = z.object(pageQuery).strict();
export const dashboardTechnicalFileDrilldownQuerySchema = z
  .object({ section: technicalFileSectionKeySchema.optional() })
  .strict();
export const dashboardFindingsDrilldownQuerySchema = z
  .object({
    productId: z.uuid().optional(),
    severity: vulnerabilityTriageSeveritySchema.optional(),
    openOnly: booleanQuery,
  })
  .strict();

function fractionValid(
  numerator: number,
  denominator: number,
  percent: number | null,
) {
  return (
    numerator <= denominator &&
    (denominator === 0
      ? percent === null
      : percent !== null &&
        Math.abs(percent - (numerator / denominator) * 100) <= 0.01)
  );
}
export const dashboardCoverageSchema = z
  .object({
    coveredReleases: count,
    eligibleReleases: count,
    percent: z.number().min(0).max(100).nullable(),
  })
  .strict()
  .refine(
    (value) =>
      fractionValid(
        value.coveredReleases,
        value.eligibleReleases,
        value.percent,
      ),
    "Coverage must describe the eligible release fraction",
  );
export const dashboardFindingsSummarySchema = z
  .object({
    openCount: count,
    suppressedOpenCount: count,
    bySeverity: z
      .object({
        critical: count,
        high: count,
        medium: count,
        low: count,
        unknown: count,
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      Object.values(value.bySeverity).reduce((total, n) => total + n, 0) ===
        value.openCount && value.suppressedOpenCount <= value.openCount,
    "Severity and suppression counts must reconcile",
  );
export const dashboardProductsSummarySchema = z
  .object({
    totalProducts: count,
    activeProducts: count,
    archivedProducts: count,
  })
  .strict()
  .refine(
    (value) =>
      value.totalProducts === value.activeProducts + value.archivedProducts,
    "Product counts must reconcile",
  );
export const dashboardSupportSchema = z
  .object({
    state: z.enum(["missing", "not_started", "active", "ended"]),
    startsAt: timestamp.nullable(),
    endsAt: timestamp.nullable(),
  })
  .strict()
  .refine(
    (value) =>
      value.state === "missing"
        ? value.startsAt === null && value.endsAt === null
        : value.startsAt !== null && value.endsAt !== null,
    "Support availability must agree with dates",
  );
export const dashboardProductSchema = z
  .object({
    productId: z.uuid(),
    productName: text,
    archived: z.boolean(),
    classification: productClassificationSchema.nullable(),
    support: dashboardSupportSchema,
  })
  .strict();
export const dashboardObligationRowSchema = z
  .object({
    obligationId: z.uuid(),
    stageId: z.uuid(),
    productId: z.uuid().nullable(),
    productName: text.nullable(),
    type: reportingObligationTypeSchema,
    kind: reportingObligationStageKindSchema,
    state: reportingObligationStageStateSchema,
    obligationStatus: reportingObligationStatusSchema,
    dueAt: timestamp.nullable(),
    elapsedPercent: z.number().min(0).max(100).nullable(),
    breachedAt: timestamp.nullable(),
    submittedAt: timestamp.nullable(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.state === "pending_anchor" &&
      (value.dueAt !== null || value.elapsedPercent !== null)
    )
      context.addIssue({
        code: "custom",
        message: "Pending anchors have no deadline or progress",
      });
    if (["running", "overdue"].includes(value.state) && value.dueAt === null)
      context.addIssue({
        code: "custom",
        message: "Running stages require a source deadline",
      });
    if (value.state === "submitted" && value.submittedAt === null)
      context.addIssue({
        code: "custom",
        message: "Submitted stages require submission time",
      });
  });
export const dashboardReadinessAvailableRowSchema = z
  .object({
    productId: z.uuid(),
    productName: text,
    status: technicalFileReadinessStatusSchema,
    completeSections: count,
    applicableSections: count,
    percent: z.number().min(0).max(100).nullable(),
    calculatedAt: timestamp.nullable(),
    gaps: z.array(technicalFileReadinessGapSchema).max(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      !fractionValid(
        value.completeSections,
        value.applicableSections,
        value.percent,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Readiness must describe applicable sections",
      });
    if (value.status !== "complete" && value.percent === 100)
      context.addIssue({
        code: "custom",
        message: "Incomplete or stale readiness cannot show complete progress",
      });
    if (value.status === "empty" && value.completeSections !== 0)
      context.addIssue({
        code: "custom",
        message: "Empty readiness has no complete sections",
      });
    if (
      value.status === "complete" &&
      (value.applicableSections === 0 ||
        value.completeSections !== value.applicableSections ||
        value.gaps.length !== 0 ||
        value.calculatedAt === null)
    )
      context.addIssue({
        code: "custom",
        message:
          "Complete readiness requires current applicable sections without gaps",
      });
  });
/** Product identity is authorized independently from source evidence. */
export const dashboardReadinessWithheldRowSchema = z
  .object({
    productId: z.uuid(),
    productName: text,
    state: z.enum(["restricted", "not_initialized", "unavailable"]),
  })
  .strict();
export const dashboardReadinessRowSchema = z.union([
  dashboardReadinessAvailableRowSchema,
  dashboardReadinessWithheldRowSchema,
]);
export const dashboardIngestionRowSchema = z
  .object({
    jobId: z.uuid(),
    productId: z.uuid(),
    productName: text,
    releaseId: z.uuid(),
    status: sbomJobStatusSchema,
    createdAt: timestamp,
    updatedAt: timestamp,
  })
  .strict();
export const dashboardFeedFreshnessRowSchema = z
  .object({
    feedKey: vulnerabilityFeedKeySchema,
    status: vulnerabilityFeedStatusSchema,
    freshness: vulnerabilityFeedFreshnessSchema,
    lastSuccessfulSyncAt: timestamp.nullable(),
    updatedAt: timestamp.nullable(),
  })
  .strict();
export function dashboardPageSchema<T extends z.ZodType>(
  row: T,
  maximum = 100,
) {
  return z
    .object({
      rows: z.array(row).max(maximum),
      nextCursor: dashboardCursorSchema.nullable(),
    })
    .strict();
}
const metadata = {
  organizationId: z.uuid(),
  serverNow: timestamp,
  generatedAt: timestamp,
};
const summarySections = {
  findings: dashboardSectionSchema(dashboardFindingsSummarySchema),
  sbomCoverage: dashboardSectionSchema(dashboardCoverageSchema),
  feedFreshness: dashboardSectionSchema(
    z.array(dashboardFeedFreshnessRowSchema).max(6),
  ),
};
const initialSections = {
  obligations: dashboardSectionSchema(
    dashboardPageSchema(dashboardObligationRowSchema, 10),
  ),
  readiness: dashboardSectionSchema(
    dashboardPageSchema(dashboardReadinessRowSchema, 10),
  ),
  ingestion: dashboardSectionSchema(
    dashboardPageSchema(dashboardIngestionRowSchema, 10),
  ),
};
export const dashboardOverviewResponseSchema = z
  .object({
    ...metadata,
    products: dashboardSectionSchema(dashboardProductsSummarySchema),
    ...summarySections,
    ...initialSections,
  })
  .strict();
export const dashboardProductPostureResponseSchema = z
  .object({
    ...metadata,
    product: dashboardProductSchema,
    ...summarySections,
    ...initialSections,
  })
  .strict();
export const dashboardObligationsResponseSchema = z
  .object({
    ...metadata,
    obligations: dashboardSectionSchema(
      dashboardPageSchema(dashboardObligationRowSchema),
    ),
  })
  .strict();
export const dashboardReadinessResponseSchema = z
  .object({
    ...metadata,
    readiness: dashboardSectionSchema(
      dashboardPageSchema(dashboardReadinessRowSchema),
    ),
  })
  .strict();
export const dashboardIngestionResponseSchema = z
  .object({
    ...metadata,
    ingestion: dashboardSectionSchema(
      dashboardPageSchema(dashboardIngestionRowSchema),
    ),
  })
  .strict();
