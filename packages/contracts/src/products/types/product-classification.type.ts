import type { z } from "zod";
import type {
  productClassificationSchema,
  productClassificationAnswersSchema,
  productClassificationPolicySchema,
  saveProductClassificationInputSchema,
  productClassificationRunSchema,
  productClassificationSummarySchema,
  productClassificationHistoryQuerySchema,
  productClassificationLatestQuerySchema,
  productClassificationPolicyResponseSchema,
  saveProductClassificationResponseSchema,
  productClassificationHistoryResponseSchema,
  productClassificationsResponseSchema,
} from "../schemas/product-classification.schema.js";
export type ProductClassification = z.output<
  typeof productClassificationSchema
>;
export type ProductClassificationAnswers = z.output<
  typeof productClassificationAnswersSchema
>;
export type ProductClassificationPolicy = z.output<
  typeof productClassificationPolicySchema
>;
export type SaveProductClassificationInput = z.output<
  typeof saveProductClassificationInputSchema
>;
export type ProductClassificationRun = z.output<
  typeof productClassificationRunSchema
>;
export type ProductClassificationSummary = z.output<
  typeof productClassificationSummarySchema
>;
export type ProductClassificationHistoryQuery = z.output<
  typeof productClassificationHistoryQuerySchema
>;
export type ProductClassificationLatestQuery = z.output<
  typeof productClassificationLatestQuerySchema
>;
export type ProductClassificationPolicyResponse = z.output<
  typeof productClassificationPolicyResponseSchema
>;
export type SaveProductClassificationResponse = z.output<
  typeof saveProductClassificationResponseSchema
>;
export type ProductClassificationHistoryResponse = z.output<
  typeof productClassificationHistoryResponseSchema
>;
export type ProductClassificationsResponse = z.output<
  typeof productClassificationsResponseSchema
>;
