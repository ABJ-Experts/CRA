import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
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
} from "@repo/contracts/dashboard/schemas";
import type {
  DashboardOverviewQuery,
  DashboardProductPostureParams,
  DashboardProductPostureQuery,
  DashboardObligationsQuery,
  DashboardReadinessQuery,
  DashboardIngestionQuery,
} from "@repo/contracts/dashboard/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodParams, zodQuery } from "../common/pipes/zod-validation.pipe";
import { DashboardUseCases } from "./application/dashboard-use-cases";
import {
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardNotFoundError,
  DashboardUnavailableError,
} from "./application/dashboard-read.port";

@Controller("dashboard")
export class DashboardController {
  constructor(private readonly dashboard: DashboardUseCases) {}

  @Get("overview")
  @RequirePermissions("can_view_dashboards")
  @ZodResponse(dashboardOverviewResponseSchema)
  overview(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(dashboardOverviewQuerySchema))
    query: DashboardOverviewQuery,
  ) {
    return this.safe(() => this.dashboard.overview(user, query));
  }

  @Get("products/:productId/posture")
  @RequirePermissions("can_view_dashboards")
  @ZodResponse(dashboardProductPostureResponseSchema)
  posture(
    @CurrentUser() user: RequestUser,
    @Param(zodParams(dashboardProductPostureParamsSchema))
    params: DashboardProductPostureParams,
    @Query(zodQuery(dashboardProductPostureQuerySchema))
    query: DashboardProductPostureQuery,
  ) {
    return this.safe(() => this.dashboard.posture(user, params, query));
  }

  @Get("obligations")
  @RequirePermissions("can_view_dashboards")
  @ZodResponse(dashboardObligationsResponseSchema)
  obligations(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(dashboardObligationsQuerySchema))
    query: DashboardObligationsQuery,
  ) {
    return this.safe(() => this.dashboard.obligations(user, query));
  }

  @Get("readiness")
  @RequirePermissions("can_view_dashboards")
  @ZodResponse(dashboardReadinessResponseSchema)
  readiness(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(dashboardReadinessQuerySchema))
    query: DashboardReadinessQuery,
  ) {
    return this.safe(() => this.dashboard.readiness(user, query));
  }

  @Get("ingestion")
  @RequirePermissions("can_view_dashboards")
  @ZodResponse(dashboardIngestionResponseSchema)
  ingestion(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(dashboardIngestionQuerySchema))
    query: DashboardIngestionQuery,
  ) {
    return this.safe(() => this.dashboard.ingestion(user, query));
  }

  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DashboardNotFoundError)
        throw new NotFoundException({
          message: "Not found",
          code: "not_found",
        });
      if (error instanceof DashboardForbiddenError)
        throw new ForbiddenException({
          message: "Access denied",
          code: "forbidden",
        });
      if (error instanceof DashboardInvalidCursorError)
        throw new BadRequestException({
          message: "Invalid dashboard cursor",
          code: "invalid_cursor",
        });
      if (error instanceof DashboardUnavailableError)
        throw new ServiceUnavailableException({
          message: "Dashboard temporarily unavailable",
          code: "dashboard_unavailable",
        });
      throw error;
    }
  }
}
