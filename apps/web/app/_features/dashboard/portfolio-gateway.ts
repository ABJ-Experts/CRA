import {
  portfolioProductsQuerySchema,
  portfolioProductsResponseSchema,
  portfolioConcentrationQuerySchema,
  portfolioConcentrationResponseSchema,
  portfolioDetailQuerySchema,
  portfolioDetailResponseSchema,
} from "@repo/contracts/dashboard/schemas";
import type {
  PortfolioProductsQuery,
  PortfolioConcentrationQuery,
  PortfolioDetailQuery,
} from "@repo/contracts/dashboard/types";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";

function path(endpoint: string, values: Record<string, unknown>): `/${string}` {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined) params.set(key, String(value));
  return `/api/v1/dashboard/portfolio/${endpoint}?${params}`;
}

/** Authenticated reads parse outgoing queries and incoming wire contracts. */
export class PortfolioGateway {
  constructor(
    private readonly transport: typeof authenticatedRequestJson = authenticatedRequestJson,
  ) {}
  products(query: Partial<PortfolioProductsQuery>, signal?: AbortSignal) {
    return this.transport({
      path: path("products", portfolioProductsQuerySchema.parse(query)),
      schema: portfolioProductsResponseSchema,
      signal,
    });
  }
  concentration(
    query: Partial<PortfolioConcentrationQuery>,
    signal?: AbortSignal,
  ) {
    return this.transport({
      path: path(
        "concentration",
        portfolioConcentrationQuerySchema.parse(query),
      ),
      schema: portfolioConcentrationResponseSchema,
      signal,
    });
  }
  detail(query: Partial<PortfolioDetailQuery>, signal?: AbortSignal) {
    return this.transport({
      path: path(
        "concentration/detail",
        portfolioDetailQuerySchema.parse(query),
      ),
      schema: portfolioDetailResponseSchema,
      signal,
    });
  }
}
