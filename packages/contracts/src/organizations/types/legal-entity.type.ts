import type { z } from "zod";

import type {
  createLegalEntityInputSchema,
  legalEntitiesResponseSchema,
  legalEntityCompletionStatusSchema,
  legalEntityDependencyKindSchema,
  legalEntityDependencyProjectionSchema,
  legalEntityIdentifierSchema,
  legalEntityLifecycleInputSchema,
  legalEntityParamsSchema,
  legalEntityRegistrationIdentifierSchema,
  legalEntityResponseSchema,
  legalEntitySchema,
  legalEntityStatusSchema,
  legalEntityVersionInputSchema,
  legalEntityTaxIdentifierSchema,
  updateLegalEntityInputSchema,
} from "../schemas/index.js";

export type LegalEntityIdentifier = z.output<
  typeof legalEntityIdentifierSchema
>;
export type LegalEntityRegistrationIdentifier = z.output<
  typeof legalEntityRegistrationIdentifierSchema
>;
export type LegalEntityTaxIdentifier = z.output<
  typeof legalEntityTaxIdentifierSchema
>;
export type LegalEntityStatus = z.output<typeof legalEntityStatusSchema>;
export type LegalEntityCompletionStatus = z.output<
  typeof legalEntityCompletionStatusSchema
>;
export type LegalEntityDependencyKind = z.output<
  typeof legalEntityDependencyKindSchema
>;
export type LegalEntityDependencyProjection = z.output<
  typeof legalEntityDependencyProjectionSchema
>;
export type CreateLegalEntityInput = z.output<
  typeof createLegalEntityInputSchema
>;
export type UpdateLegalEntityInput = z.output<
  typeof updateLegalEntityInputSchema
>;
export type LegalEntityLifecycleInput = z.output<
  typeof legalEntityLifecycleInputSchema
>;
export type LegalEntityVersionInput = z.output<
  typeof legalEntityVersionInputSchema
>;
export type LegalEntityParams = z.output<typeof legalEntityParamsSchema>;
export type LegalEntity = z.output<typeof legalEntitySchema>;
export type LegalEntityResponse = z.output<typeof legalEntityResponseSchema>;
export type LegalEntitiesResponse = z.output<
  typeof legalEntitiesResponseSchema
>;
