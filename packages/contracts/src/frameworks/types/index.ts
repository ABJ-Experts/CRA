import type { z } from "zod";
import type {
  customFrameworkContentSchema,
  customFrameworkImportSchema,
  customFrameworkCommandInputSchema,
  customFrameworkCommandResponseSchema,
  customFrameworkDetailResponseSchema,
  customFrameworkListResponseSchema,
} from "../schemas/custom-framework.schema.js";

export type CustomFrameworkContent = z.output<
  typeof customFrameworkContentSchema
>;
export type CustomFrameworkImport = z.output<
  typeof customFrameworkImportSchema
>;
export type CustomFrameworkCommandInput = z.output<
  typeof customFrameworkCommandInputSchema
>;
export type CustomFrameworkCommandResponse = z.output<
  typeof customFrameworkCommandResponseSchema
>;
export type CustomFrameworkDetailResponse = z.output<
  typeof customFrameworkDetailResponseSchema
>;
export type CustomFrameworkListResponse = z.output<
  typeof customFrameworkListResponseSchema
>;
import type {
  curatedFrameworkRelationSchema,
  frameworkCrosswalkResponseSchema,
  frameworkUpgradePreviewResponseSchema,
  frameworkUpgradeReviewResponseSchema,
  upsertFrameworkUpgradeDecisionInputSchema,
  commitFrameworkUpgradeResponseSchema,
} from "../schemas/upgrade.schema.js";
import type {
  frameworkCatalogResponseSchema,
  frameworkPackImportSchema,
  frameworkRequirementReferenceSchema,
  frameworkSelectionResponseSchema,
  frameworkTreeResponseSchema,
  selectFrameworkInputSchema,
} from "../schemas/framework.schema.js";
import type {
  controlCommandResponseSchema,
  controlDetailResponseSchema,
  controlListResponseSchema,
  controlMappingSchema,
  createControlInputSchema,
  createControlMappingInputSchema,
  requirementCoverageResponseSchema,
  requirementApplicabilityInputSchema,
  requirementApplicabilityResponseSchema,
} from "../schemas/control.schema.js";

export type FrameworkPackImport = z.output<typeof frameworkPackImportSchema>;
export type FrameworkRequirementReference = z.output<
  typeof frameworkRequirementReferenceSchema
>;
export type FrameworkCatalogResponse = z.output<
  typeof frameworkCatalogResponseSchema
>;
export type FrameworkTreeResponse = z.output<
  typeof frameworkTreeResponseSchema
>;
export type SelectFrameworkInput = z.output<typeof selectFrameworkInputSchema>;
export type FrameworkSelectionResponse = z.output<
  typeof frameworkSelectionResponseSchema
>;
export type ControlListResponse = z.output<typeof controlListResponseSchema>;
export type ControlDetailResponse = z.output<
  typeof controlDetailResponseSchema
>;
export type ControlMapping = z.output<typeof controlMappingSchema>;
export type ControlCommandResponse = z.output<
  typeof controlCommandResponseSchema
>;
export type CreateControlInput = z.output<typeof createControlInputSchema>;
export type CreateControlMappingInput = z.output<
  typeof createControlMappingInputSchema
>;
export type RequirementCoverageResponse = z.output<
  typeof requirementCoverageResponseSchema
>;
export type RequirementApplicabilityInput = z.output<
  typeof requirementApplicabilityInputSchema
>;
export type RequirementApplicabilityResponse = z.output<
  typeof requirementApplicabilityResponseSchema
>;
export type CuratedFrameworkRelation = z.output<
  typeof curatedFrameworkRelationSchema
>;
export type FrameworkCrosswalkResponse = z.output<
  typeof frameworkCrosswalkResponseSchema
>;
export type FrameworkUpgradePreviewResponse = z.output<
  typeof frameworkUpgradePreviewResponseSchema
>;
export type FrameworkUpgradeReviewResponse = z.output<
  typeof frameworkUpgradeReviewResponseSchema
>;
export type UpsertFrameworkUpgradeDecisionInput = z.output<
  typeof upsertFrameworkUpgradeDecisionInputSchema
>;
export type CommitFrameworkUpgradeResponse = z.output<
  typeof commitFrameworkUpgradeResponseSchema
>;
