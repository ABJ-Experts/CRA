import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Header,
  NotFoundException,
  Query,
  Res,
  ServiceUnavailableException,
} from "@nestjs/common";
import type { Response } from "express";
import {
  dashboardTrendsQuerySchema,
  dashboardTrendsResponseSchema,
  dashboardTrendSourcesQuerySchema,
  dashboardTrendSourcesResponseSchema,
  dashboardTrendsExportQuerySchema,
  dashboardTrendsCsvSchema,
} from "@repo/contracts/dashboard/schemas";
import type {
  DashboardTrendsQuery,
  DashboardTrendSourcesQuery,
  DashboardTrendsExportQuery,
} from "@repo/contracts/dashboard/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import {
  ZodResponse,
  NonJsonResponse,
} from "../common/http/zod-response.interceptor";
import { zodQuery } from "../common/pipes/zod-validation.pipe";
import { DashboardTrendsUseCases } from "./application/dashboard-trends-use-cases";
import { DashboardDatasetConflictError } from "./application/dashboard-trends.port";
import {
  DashboardForbiddenError,
  DashboardNotFoundError,
  DashboardUnavailableError,
  DashboardInvalidCursorError,
} from "./application/dashboard-read.port";
@Controller("dashboard")
export class DashboardTrendsController {
  constructor(private readonly trendsUseCases: DashboardTrendsUseCases) {}
  @Get("trends")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("can_view_dashboards")
  @ZodResponse(dashboardTrendsResponseSchema)
  trends(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(dashboardTrendsQuerySchema)) query: DashboardTrendsQuery,
  ) {
    return this.safe(() => this.trendsUseCases.trends(user, query));
  }
  @Get("trends/sources")
  @Header("Cache-Control", "no-store")
  @RequirePermissions("can_view_dashboards")
  @ZodResponse(dashboardTrendSourcesResponseSchema)
  sources(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(dashboardTrendSourcesQuerySchema))
    query: DashboardTrendSourcesQuery,
  ) {
    return this.safe(() => this.trendsUseCases.sources(user, query));
  }
  @Get("trends/export")
  @RequirePermissions("can_view_dashboards")
  @NonJsonResponse("stream")
  async export(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(dashboardTrendsExportQuerySchema))
    query: DashboardTrendsExportQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const csv = dashboardTrendsCsvSchema.parse(
      await this.safe(() => this.trendsUseCases.export(user, query)),
    );
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader(
      "Content-Disposition",
      'attachment; filename="cra-trends.csv"',
    );
    response.setHeader("Cache-Control", "no-store");
    return csv;
  }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DashboardDatasetConflictError)
        throw new ConflictException({
          code: "dataset_conflict",
          message: "Dataset expired or authorization changed. Refresh trends.",
        });
      if (error instanceof DashboardForbiddenError)
        throw new ForbiddenException({
          code: "forbidden",
          message: "Access denied",
        });
      if (error instanceof DashboardNotFoundError)
        throw new NotFoundException({
          code: "not_found",
          message: "Not found",
        });
      if (error instanceof DashboardInvalidCursorError)
        throw new BadRequestException({
          code: "invalid_cursor",
          message: "Invalid cursor",
        });
      if (error instanceof DashboardUnavailableError)
        throw new ServiceUnavailableException({
          code: "dashboard_unavailable",
          message: "Trends temporarily unavailable",
        });
      throw error;
    }
  }
}
