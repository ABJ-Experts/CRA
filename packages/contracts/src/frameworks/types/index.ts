import type { z } from "zod";
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
