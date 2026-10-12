import type { z } from "zod";
import type {
  portfolioErrorSchema,
  portfolioProductsQuerySchema,
  portfolioConcentrationQuerySchema,
  portfolioDetailQuerySchema,
  portfolioProductsResponseSchema,
  portfolioConcentrationResponseSchema,
  portfolioDetailResponseSchema,
  portfolioScopeSchema,
  portfolioCoverageSchema,
  portfolioMatchingCoverageSchema,
  portfolioProductRowSchema,
  portfolioConcentrationRowSchema,
  portfolioComponentSchema,
  portfolioAffectedReleaseRowSchema,
} from "../schemas/portfolio.schema.js";
export type PortfolioProductsQuery = z.output<
  typeof portfolioProductsQuerySchema
>;
export type PortfolioConcentrationQuery = z.output<
  typeof portfolioConcentrationQuerySchema
>;
export type PortfolioDetailQuery = z.output<typeof portfolioDetailQuerySchema>;
export type PortfolioProductsResponse = z.output<
  typeof portfolioProductsResponseSchema
>;
export type PortfolioConcentrationResponse = z.output<
  typeof portfolioConcentrationResponseSchema
>;
export type PortfolioDetailResponse = z.output<
  typeof portfolioDetailResponseSchema
>;
export type PortfolioScope = z.output<typeof portfolioScopeSchema>;
export type PortfolioCoverage = z.output<typeof portfolioCoverageSchema>;
export type PortfolioMatchingCoverage = z.output<
  typeof portfolioMatchingCoverageSchema
>;
export type PortfolioProductRow = z.output<typeof portfolioProductRowSchema>;
export type PortfolioConcentrationRow = z.output<
  typeof portfolioConcentrationRowSchema
>;
export type PortfolioComponent = z.output<typeof portfolioComponentSchema>;
export type PortfolioAffectedReleaseRow = z.output<
  typeof portfolioAffectedReleaseRowSchema
>;

export type PortfolioError = z.output<typeof portfolioErrorSchema>;
