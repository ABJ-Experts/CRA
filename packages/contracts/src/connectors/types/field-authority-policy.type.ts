import type { z } from "zod";

import type {
  fieldAuthorityEntityTypeSchema,
  fieldAuthorityImpactPreviewSchema,
  fieldAuthorityPolicyParamsSchema,
  fieldAuthorityPolicySchema,
  fieldAuthorityPolicyValueSchema,
  previewFieldAuthorityPolicyInputSchema,
  productFieldAuthorityFieldSchema,
  releaseFieldAuthorityFieldSchema,
  upsertFieldAuthorityPolicyInputSchema,
} from "../schemas/index.js";

export type FieldAuthorityEntityType = z.output<
  typeof fieldAuthorityEntityTypeSchema
>;
export type FieldAuthorityPolicyValue = z.output<
  typeof fieldAuthorityPolicyValueSchema
>;
export type ProductFieldAuthorityField = z.output<
  typeof productFieldAuthorityFieldSchema
>;
export type ReleaseFieldAuthorityField = z.output<
  typeof releaseFieldAuthorityFieldSchema
>;
export type FieldAuthorityPolicyParams = z.output<
  typeof fieldAuthorityPolicyParamsSchema
>;
export type FieldAuthorityPolicy = z.output<typeof fieldAuthorityPolicySchema>;
export type UpsertFieldAuthorityPolicyInput = z.output<
  typeof upsertFieldAuthorityPolicyInputSchema
>;
export type FieldAuthorityImpactPreview = z.output<
  typeof fieldAuthorityImpactPreviewSchema
>;
export type PreviewFieldAuthorityPolicyInput = z.output<
  typeof previewFieldAuthorityPolicyInputSchema
>;
