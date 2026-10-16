import { z } from "zod";
import { utcZDateTimeSchema as timestamp } from "../../products/schemas/release-market-lifecycle.schema.js";
import {
  dashboardCoverageSchema,
  dashboardCursorSchema,
  dashboardFeedFreshnessRowSchema,
  dashboardFindingsSummarySchema,
  dashboardPageSchema,
  dashboardProductSchema,
  dashboardReadinessAvailableRowSchema,
  dashboardSectionSchema,
} from "./dashboard.schema.js";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const text = z.string().trim().min(1).max(500);
const limit = z.preprocess(
  (value) =>
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value,
  z.number().int().min(1).max(100).default(20),
);
const includeArchived = z.preprocess(
  (value) => (value === "true" ? true : value === "false" ? false : value),
  z.boolean().default(false),
);
const filters = {
  legalEntityId: z.uuid().optional(),
  productId: z.uuid().optional(),
  includeArchived,
  limit,
  cursor: dashboardCursorSchema.optional(),
};
export const portfolioProductsQuerySchema = z.object(filters).strict();
export const portfolioConcentrationQuerySchema = z.object(filters).strict();
export const portfolioDetailQuerySchema = z
  .object({
    ...filters,
    componentRef: dashboardCursorSchema,
  })
  .strict();
export const portfolioScopeSchema = z
  .object({
    legalEntityId: z.uuid().nullable(),
    productId: z.uuid().nullable(),
    includeArchived: z.boolean(),
  })
  .strict();

/** Component denominator is distinct selected release/document/component membership.
 * Exclusion categories are mutually exclusive; no name-only identity fallback. */
export const portfolioCoverageSchema = z
  .object({
    eligibleReleases: count,
    coveredReleases: count,
    missingReleases: count,
    percent: z.number().min(0).max(100).nullable(),
    totalComponents: count,
    rankableComponents: count,
    excludedIdentity: z
      .object({
        missingPurl: count,
        missingVersion: count,
        invalidPurl: count,
        versionConflict: count,
      })
      .strict(),
  })
  .strict()
  .refine(
    (value) =>
      value.eligibleReleases ===
        value.coveredReleases + value.missingReleases &&
      (value.eligibleReleases === 0
        ? value.percent === null
        : value.percent !== null &&
          Math.abs(
            value.percent -
              (100 * value.coveredReleases) / value.eligibleReleases,
          ) <= 0.01) &&
      value.totalComponents ===
        value.rankableComponents +
          Object.values(value.excludedIdentity).reduce((sum, n) => sum + n, 0),
    "Portfolio coverage fractions and exclusions must reconcile",
  );
/** An evaluated release has at least one completed matching evaluation. This
 * reports evidence presence, not exhaustive vulnerability matching coverage. */
export const portfolioMatchingCoverageSchema = z
  .object({
    eligibleReleases: count,
    evaluatedReleases: count,
    pendingReleases: count,
  })
  .strict()
  .refine(
    (value) =>
      value.eligibleReleases ===
      value.evaluatedReleases + value.pendingReleases,
    "Matching evidence counts must reconcile",
  );
const entity = {
  legalEntityId: z.uuid().nullable(),
  legalEntityName: text.nullable(),
};
function entityPair(value: {
  legalEntityId: string | null;
  legalEntityName: string | null;
}) {
  return (value.legalEntityId === null) === (value.legalEntityName === null);
}
export const portfolioProductRowSchema = dashboardProductSchema
  .extend({
    ...entity,
    sbomCoverage: dashboardSectionSchema(dashboardCoverageSchema),
    findings: dashboardSectionSchema(dashboardFindingsSummarySchema),
    readiness: dashboardSectionSchema(dashboardReadinessAvailableRowSchema),
  })
  .strict()
  .refine(entityPair, "Entity identity and label must agree");
const identity = {
  packageIdentity: z.string().trim().min(5).max(4096).startsWith("pkg:"),
  version: z.string().trim().min(1).max(1024),
  componentRef: dashboardCursorSchema,
  productCount: count.min(2),
  releaseCount: count.min(2),
};
function distinctMemberships(value: {
  productCount: number;
  releaseCount: number;
}) {
  return value.releaseCount >= value.productCount;
}
export const portfolioComponentSchema = z
  .object(identity)
  .strict()
  .refine(
    distinctMemberships,
    "Release count cannot be smaller than distinct product count",
  );
export const portfolioConcentrationRowSchema = z
  .object({
    ...identity,
    findings: dashboardSectionSchema(dashboardFindingsSummarySchema),
  })
  .strict()
  .refine(
    distinctMemberships,
    "Release count cannot be smaller than distinct product count",
  );
export const portfolioAffectedReleaseRowSchema = z
  .object({
    productId: z.uuid(),
    productName: text,
    archived: z.boolean(),
    ...entity,
    releaseId: z.uuid(),
    releaseVersion: text,
    releaseArchived: z.boolean(),
    findings: dashboardSectionSchema(dashboardFindingsSummarySchema),
  })
  .strict()
  .refine(entityPair, "Entity identity and label must agree");
const metadata = {
  organizationId: z.uuid(),
  serverNow: timestamp,
  generatedAt: timestamp,
  scope: portfolioScopeSchema,
  coverage: dashboardSectionSchema(portfolioCoverageSchema),
  matchingCoverage: dashboardSectionSchema(portfolioMatchingCoverageSchema),
  feedFreshness: dashboardSectionSchema(
    z.array(dashboardFeedFreshnessRowSchema).max(6),
  ),
};
export const portfolioProductsResponseSchema = z
  .object({
    ...metadata,
    products: dashboardSectionSchema(
      dashboardPageSchema(portfolioProductRowSchema),
    ),
  })
  .strict();
export const portfolioConcentrationResponseSchema = z
  .object({
    ...metadata,
    concentration: dashboardSectionSchema(
      dashboardPageSchema(portfolioConcentrationRowSchema),
    ),
  })
  .strict();
export const portfolioDetailResponseSchema = z
  .object({
    ...metadata,
    component: portfolioComponentSchema,
    affectedReleases: dashboardSectionSchema(
      dashboardPageSchema(portfolioAffectedReleaseRowSchema),
    ),
  })
  .strict();

export const portfolioErrorSchema = z
  .object({
    code: z.enum([
      "not_found",
      "forbidden",
      "invalid_cursor",
      "portfolio_scope_changed",
      "portfolio_unavailable",
    ]),
    message: text,
  })
  .strict();
