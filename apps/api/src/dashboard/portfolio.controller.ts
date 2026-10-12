import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Query,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  portfolioErrorSchema,
  portfolioProductsQuerySchema,
  portfolioConcentrationQuerySchema,
  portfolioDetailQuerySchema,
  portfolioProductsResponseSchema,
  portfolioConcentrationResponseSchema,
  portfolioDetailResponseSchema,
} from "@repo/contracts/dashboard/schemas";
import type {
  PortfolioProductsQuery,
  PortfolioConcentrationQuery,
  PortfolioDetailQuery,
} from "@repo/contracts/dashboard/types";
import {
  CurrentUser,
  RequirePermissions,
  type RequestUser,
} from "../auth/auth.types";
import { ZodResponse } from "../common/http/zod-response.interceptor";
import { zodQuery } from "../common/pipes/zod-validation.pipe";
import { PortfolioUseCases } from "./application/portfolio-use-cases";
import {
  DashboardForbiddenError,
  DashboardInvalidCursorError,
  DashboardNotFoundError,
  DashboardUnavailableError,
} from "./application/dashboard-read.port";
import { PortfolioScopeChangedError } from "./application/portfolio-read.port";
@Controller("dashboard/portfolio")
export class PortfolioController {
  constructor(private readonly portfolio: PortfolioUseCases) {}
  @Get("products")
  @RequirePermissions("can_view_dashboards", "can_view_products")
  @ZodResponse(portfolioProductsResponseSchema)
  products(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(portfolioProductsQuerySchema))
    query: PortfolioProductsQuery,
  ) {
    return this.safe(() => this.portfolio.products(user, query));
  }
  @Get("concentration")
  @RequirePermissions("can_view_dashboards", "can_view_products")
  @ZodResponse(portfolioConcentrationResponseSchema)
  concentration(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(portfolioConcentrationQuerySchema))
    query: PortfolioConcentrationQuery,
  ) {
    return this.safe(() => this.portfolio.concentration(user, query));
  }
  @Get("concentration/detail")
  @RequirePermissions("can_view_dashboards", "can_view_products")
  @ZodResponse(portfolioDetailResponseSchema)
  detail(
    @CurrentUser() user: RequestUser,
    @Query(zodQuery(portfolioDetailQuerySchema)) query: PortfolioDetailQuery,
  ) {
    return this.safe(() => this.portfolio.detail(user, query));
  }
  private async safe<T>(operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      if (error instanceof DashboardNotFoundError)
        throw new NotFoundException(
          portfolioErrorSchema.parse({
            message: "Not found",
            code: "not_found",
          }),
        );
      if (error instanceof DashboardForbiddenError)
        throw new ForbiddenException(
          portfolioErrorSchema.parse({
            message: "Access denied",
            code: "forbidden",
          }),
        );
      if (error instanceof DashboardInvalidCursorError)
        throw new BadRequestException(
          portfolioErrorSchema.parse({
            message: "Invalid portfolio cursor",
            code: "invalid_cursor",
          }),
        );
      if (error instanceof PortfolioScopeChangedError)
        throw new ConflictException(
          portfolioErrorSchema.parse({
            message: "Portfolio changed; refresh to continue",
            code: "portfolio_scope_changed",
          }),
        );
      if (error instanceof DashboardUnavailableError)
        throw new ServiceUnavailableException(
          portfolioErrorSchema.parse({
            message: "Portfolio temporarily unavailable",
            code: "portfolio_unavailable",
          }),
        );
      throw error;
    }
  }
}
