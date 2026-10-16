import type { z } from "zod";

import type {
  externalIdentityEntityTypeSchema,
  externalIdentityMatchConfidenceSchema,
  externalIdentityMatchMethodSchema,
  externalIdentityParamsSchema,
  linkExternalIdentityInputSchema,
  mergeExternalIdentitiesInputSchema,
  productExternalIdentitySchema,
  unlinkExternalIdentityInputSchema,
} from "../schemas/index.js";

export type ExternalIdentityEntityType = z.output<
  typeof externalIdentityEntityTypeSchema
>;
export type ExternalIdentityMatchMethod = z.output<
  typeof externalIdentityMatchMethodSchema
>;
export type ExternalIdentityMatchConfidence = z.output<
  typeof externalIdentityMatchConfidenceSchema
>;
export type ExternalIdentityParams = z.output<
  typeof externalIdentityParamsSchema
>;
export type ProductExternalIdentity = z.output<
  typeof productExternalIdentitySchema
>;
export type LinkExternalIdentityInput = z.output<
  typeof linkExternalIdentityInputSchema
>;
export type UnlinkExternalIdentityInput = z.output<
  typeof unlinkExternalIdentityInputSchema
>;
export type MergeExternalIdentitiesInput = z.output<
  typeof mergeExternalIdentitiesInputSchema
>;
