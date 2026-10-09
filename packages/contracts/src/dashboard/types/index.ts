import type { z } from "zod";
import type {
  dashboardOverviewQuerySchema,
  dashboardProductPostureParamsSchema,
  dashboardProductPostureQuerySchema,
  dashboardObligationsQuerySchema,
  dashboardReadinessQuerySchema,
  dashboardIngestionQuerySchema,
  dashboardOverviewResponseSchema,
  dashboardProductPostureResponseSchema,
  dashboardObligationsResponseSchema,
  dashboardReadinessResponseSchema,
  dashboardIngestionResponseSchema,
  dashboardCoverageSchema,
  dashboardFindingsSummarySchema,
  dashboardProductsSummarySchema,
  dashboardSupportSchema,
  dashboardProductSchema,
  dashboardObligationRowSchema,
  dashboardReadinessRowSchema,
  dashboardReadinessAvailableRowSchema,
  dashboardReadinessWithheldRowSchema,
  dashboardIngestionRowSchema,
  dashboardFeedFreshnessRowSchema,
  dashboardTechnicalFileDrilldownQuerySchema,
  dashboardFindingsDrilldownQuerySchema,
} from "../schemas/index.js";

export type DashboardOverviewQuery = z.output<
  typeof dashboardOverviewQuerySchema
>;
export type DashboardProductPostureParams = z.output<
  typeof dashboardProductPostureParamsSchema
>;
export type DashboardProductPostureQuery = z.output<
  typeof dashboardProductPostureQuerySchema
>;
export type DashboardObligationsQuery = z.output<
  typeof dashboardObligationsQuerySchema
>;
export type DashboardReadinessQuery = z.output<
  typeof dashboardReadinessQuerySchema
>;
export type DashboardIngestionQuery = z.output<
  typeof dashboardIngestionQuerySchema
>;
export type DashboardOverviewResponse = z.output<
  typeof dashboardOverviewResponseSchema
>;
export type DashboardProductPostureResponse = z.output<
  typeof dashboardProductPostureResponseSchema
>;
export type DashboardObligationsResponse = z.output<
  typeof dashboardObligationsResponseSchema
>;
export type DashboardReadinessResponse = z.output<
  typeof dashboardReadinessResponseSchema
>;
export type DashboardIngestionResponse = z.output<
  typeof dashboardIngestionResponseSchema
>;
export type DashboardCoverage = z.output<typeof dashboardCoverageSchema>;
export type DashboardFindingsSummary = z.output<
  typeof dashboardFindingsSummarySchema
>;
export type DashboardProductsSummary = z.output<
  typeof dashboardProductsSummarySchema
>;
export type DashboardSupport = z.output<typeof dashboardSupportSchema>;
export type DashboardProduct = z.output<typeof dashboardProductSchema>;
export type DashboardObligationRow = z.output<
  typeof dashboardObligationRowSchema
>;
export type DashboardReadinessRow = z.output<
  typeof dashboardReadinessRowSchema
>;
export type DashboardIngestionRow = z.output<
  typeof dashboardIngestionRowSchema
>;
export type DashboardFeedFreshnessRow = z.output<
  typeof dashboardFeedFreshnessRowSchema
>;
export type DashboardTechnicalFileDrilldownQuery = z.output<
  typeof dashboardTechnicalFileDrilldownQuerySchema
>;
export type DashboardFindingsDrilldownQuery = z.output<
  typeof dashboardFindingsDrilldownQuerySchema
>;

export type DashboardReadinessAvailableRow = z.output<
  typeof dashboardReadinessAvailableRowSchema
>;
export type DashboardReadinessWithheldRow = z.output<
  typeof dashboardReadinessWithheldRowSchema
>;
export * from "./trends.types.js";
