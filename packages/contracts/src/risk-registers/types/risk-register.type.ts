import type {
  acceptResidualRiskRequestSchema,
  archiveRiskRegisterRiskRequestSchema,
  createRiskRegisterRiskRequestSchema,
  riskAffectedAssetSchema,
  riskAssessmentOutputSchema,
  riskRegisterConflictResponseSchema,
  riskRegisterProductParamsSchema,
  riskRegisterRiskParamsSchema,
  riskRegisterRiskResponseSchema,
  riskRegisterRiskSchema,
  riskRegisterWorkspaceResponseSchema,
  riskRequirementMappingSchema,
  updateRiskRegisterRiskRequestSchema,
} from "../schemas/risk-register.schema.js";
import type { z } from "zod";

export type RiskRegisterWorkspace = z.output<
  typeof riskRegisterWorkspaceResponseSchema
>;
export type RiskRegisterRisk = z.output<typeof riskRegisterRiskSchema>;
export type RiskRegisterProductParams = z.output<
  typeof riskRegisterProductParamsSchema
>;
export type RiskRegisterRiskParams = z.output<
  typeof riskRegisterRiskParamsSchema
>;
export type RiskAssessment = z.output<typeof riskAssessmentOutputSchema>;
export type RiskAffectedAsset = z.output<typeof riskAffectedAssetSchema>;
export type RiskRequirementMapping = z.output<
  typeof riskRequirementMappingSchema
>;
export type RiskRegisterRiskResponse = z.output<
  typeof riskRegisterRiskResponseSchema
>;
export type RiskRegisterConflictResponse = z.output<
  typeof riskRegisterConflictResponseSchema
>;
export type CreateRiskRegisterRiskRequest = z.output<
  typeof createRiskRegisterRiskRequestSchema
>;
export type UpdateRiskRegisterRiskRequest = z.output<
  typeof updateRiskRegisterRiskRequestSchema
>;
export type AcceptResidualRiskRequest = z.output<
  typeof acceptResidualRiskRequestSchema
>;
export type ArchiveRiskRegisterRiskRequest = z.output<
  typeof archiveRiskRegisterRiskRequestSchema
>;
