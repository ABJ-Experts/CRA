import type { z } from "zod";
import type {
  dashboardTrendsQuerySchema,
  dashboardTrendsResponseSchema,
  dashboardTrendsDataSchema,
  dashboardTrendFiltersSchema,
  dashboardTrendSourcesQuerySchema,
  dashboardTrendSourcesResponseSchema,
  dashboardTrendsExportQuerySchema,
  dashboardTrendBucketSchema,
  dashboardTrendSeriesSchema,
  dashboardTrendMetricSchema,
} from "../schemas/index.js";
export type DashboardTrendsQuery = z.output<typeof dashboardTrendsQuerySchema>;
export type DashboardTrendsResponse = z.output<
  typeof dashboardTrendsResponseSchema
>;
export type DashboardTrendsData = z.output<typeof dashboardTrendsDataSchema>;
export type DashboardTrendFilters = z.output<
  typeof dashboardTrendFiltersSchema
>;
export type DashboardTrendSourcesQuery = z.output<
  typeof dashboardTrendSourcesQuerySchema
>;
export type DashboardTrendSourcesResponse = z.output<
  typeof dashboardTrendSourcesResponseSchema
>;
export type DashboardTrendsExportQuery = z.output<
  typeof dashboardTrendsExportQuerySchema
>;
export type DashboardTrendBucket = z.output<typeof dashboardTrendBucketSchema>;
export type DashboardTrendSeries = z.output<typeof dashboardTrendSeriesSchema>;
export type DashboardTrendMetric = z.output<typeof dashboardTrendMetricSchema>;
