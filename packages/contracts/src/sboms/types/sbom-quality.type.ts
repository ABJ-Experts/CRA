import type { z } from "zod";

import type {
  sbomQualityAssessmentStatusSchema,
  sbomQualityBaselineSchema,
  sbomQualityDimensionIdSchema,
  sbomQualityDimensionSchema,
  sbomQualityFindingsQuerySchema,
  sbomQualityFindingsResponseSchema,
  sbomQualityFindingSchema,
  sbomQualityInputsSchema,
  sbomQualityJobErrorSchema,
  sbomQualityJobProgressSchema,
  sbomQualityProfileSchema,
  sbomQualityRegressionSchema,
  sbomQualityReportResponseSchema,
  sbomQualityReportSchema,
  sbomQualityReportStateSchema,
  sbomQualitySettingsResponseSchema,
  sbomQualitySettingsSchema,
  sbomSourceQualityParamsSchema,
  updateSbomQualitySettingsInputSchema,
} from "../schemas/index.js";

export type SbomQualityReportState = z.output<
  typeof sbomQualityReportStateSchema
>;
export type SbomQualityAssessmentStatus = z.output<
  typeof sbomQualityAssessmentStatusSchema
>;
export type SbomQualityDimensionId = z.output<
  typeof sbomQualityDimensionIdSchema
>;
export type SbomQualityInputs = z.output<typeof sbomQualityInputsSchema>;
export type SbomQualityDimension = z.output<typeof sbomQualityDimensionSchema>;
export type SbomQualityProfile = z.output<typeof sbomQualityProfileSchema>;
export type SbomQualityBaseline = z.output<typeof sbomQualityBaselineSchema>;
export type SbomQualityRegression = z.output<
  typeof sbomQualityRegressionSchema
>;
export type SbomQualityJobProgress = z.output<
  typeof sbomQualityJobProgressSchema
>;
export type SbomQualityJobError = z.output<typeof sbomQualityJobErrorSchema>;
export type SbomQualityReport = z.output<typeof sbomQualityReportSchema>;
export type SbomQualityReportResponse = z.output<
  typeof sbomQualityReportResponseSchema
>;
export type SbomSourceQualityParams = z.output<
  typeof sbomSourceQualityParamsSchema
>;
export type SbomQualityFinding = z.output<typeof sbomQualityFindingSchema>;
export type SbomQualityFindingsQuery = z.output<
  typeof sbomQualityFindingsQuerySchema
>;
export type SbomQualityFindingsResponse = z.output<
  typeof sbomQualityFindingsResponseSchema
>;
export type UpdateSbomQualitySettingsInput = z.output<
  typeof updateSbomQualitySettingsInputSchema
>;
export type SbomQualitySettings = z.output<typeof sbomQualitySettingsSchema>;
export type SbomQualitySettingsResponse = z.output<
  typeof sbomQualitySettingsResponseSchema
>;
