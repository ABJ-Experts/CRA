import {
  dashboardTrendsQuerySchema,
  dashboardTrendsResponseSchema,
  dashboardTrendSourcesQuerySchema,
  dashboardTrendSourcesResponseSchema,
  dashboardTrendsExportQuerySchema,
  dashboardTrendsCsvSchema,
  dashboardOverviewQuerySchema,
  dashboardOverviewResponseSchema,
  dashboardProductPostureParamsSchema,
  dashboardProductPostureResponseSchema,
  dashboardObligationsQuerySchema,
  dashboardObligationsResponseSchema,
  dashboardReadinessQuerySchema,
  dashboardReadinessResponseSchema,
  dashboardIngestionQuerySchema,
  dashboardIngestionResponseSchema,
} from "@repo/contracts/dashboard/schemas";
import type {
  DashboardTrendsQuery,
  DashboardTrendSourcesQuery,
  DashboardObligationsQuery,
  DashboardReadinessQuery,
  DashboardIngestionQuery,
} from "@repo/contracts/dashboard/types";
import {
  authenticatedRequestJson,
  authenticatedRequestText,
} from "../../_lib/http/authenticated-request";

function queryPath(
  endpoint: string,
  query: Record<string, unknown>,
): `/${string}` {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value !== undefined) params.set(key, String(value));
  });
  return `/api/v1/dashboard/${endpoint}?${params.toString()}`;
}

/** Owns the authenticated transport boundary; all consumed paths/queries are parsed. */
export class DashboardGateway {
  constructor(
    private readonly transport: typeof authenticatedRequestJson = authenticatedRequestJson,
  ) {}
  trends(query: Partial<DashboardTrendsQuery>, signal?: AbortSignal) {
    return this.transport({
      path: queryPath("trends", dashboardTrendsQuerySchema.parse(query)),
      schema: dashboardTrendsResponseSchema,
      signal,
    });
  }
  trendSources(
    query: Partial<DashboardTrendSourcesQuery>,
    signal?: AbortSignal,
  ) {
    return this.transport({
      path: queryPath(
        "trends/sources",
        dashboardTrendSourcesQuerySchema.parse(query),
      ),
      schema: dashboardTrendSourcesResponseSchema,
      signal,
    });
  }
  trendExport(datasetToken: string, signal?: AbortSignal) {
    return authenticatedRequestText({
      path: queryPath(
        "trends/export",
        dashboardTrendsExportQuerySchema.parse({ datasetToken }),
      ),
      schema: dashboardTrendsCsvSchema,
      contentType: "text/csv",
      maxBytes: 4 * 1024 * 1024,
      signal,
    });
  }
  overview(signal?: AbortSignal) {
    dashboardOverviewQuerySchema.parse({});
    return this.transport({
      path: "/api/v1/dashboard/overview",
      schema: dashboardOverviewResponseSchema,
      signal,
    });
  }
  posture(productId: string, signal?: AbortSignal) {
    const parsed = dashboardProductPostureParamsSchema.parse({ productId });
    return this.transport({
      path: `/api/v1/dashboard/products/${parsed.productId}/posture`,
      schema: dashboardProductPostureResponseSchema,
      signal,
    });
  }
  obligations(
    query: Partial<DashboardObligationsQuery> = {},
    signal?: AbortSignal,
  ) {
    return this.transport({
      path: queryPath(
        "obligations",
        dashboardObligationsQuerySchema.parse(query),
      ),
      schema: dashboardObligationsResponseSchema,
      signal,
    });
  }
  readiness(
    query: Partial<DashboardReadinessQuery> = {},
    signal?: AbortSignal,
  ) {
    return this.transport({
      path: queryPath("readiness", dashboardReadinessQuerySchema.parse(query)),
      schema: dashboardReadinessResponseSchema,
      signal,
    });
  }
  ingestion(
    query: Partial<DashboardIngestionQuery> = {},
    signal?: AbortSignal,
  ) {
    return this.transport({
      path: queryPath("ingestion", dashboardIngestionQuerySchema.parse(query)),
      schema: dashboardIngestionResponseSchema,
      signal,
    });
  }
}
