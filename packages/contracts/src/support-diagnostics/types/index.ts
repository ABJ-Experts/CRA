import type { z } from "zod";
import type {
  diagnosticSelectionSchema,
  diagnosticPreviewInputSchema,
  diagnosticPreviewSchema,
  diagnosticCreateSchema,
  diagnosticMutationSchema,
  diagnosticCleanupInputSchema,
  diagnosticJobParamsSchema,
  diagnosticDownloadParamsSchema,
  diagnosticListQuerySchema,
  diagnosticContentQuerySchema,
  diagnosticJobSchema,
  diagnosticListSchema,
  diagnosticContentSchema,
  diagnosticGrantSchema,
  diagnosticCleanupReviewSchema,
  diagnosticLogSchema,
  diagnosticConfigurationSchema,
  diagnosticMetricSchema,
  diagnosticOmissionSchema,
  diagnosticManifestSchema,
  diagnosticPayloadSchema,
} from "../schemas/index.js";

export type SupportDiagnosticSelection = z.output<
  typeof diagnosticSelectionSchema
>;
export type SupportDiagnosticPreviewInput = z.output<
  typeof diagnosticPreviewInputSchema
>;
export type SupportDiagnosticPreview = z.output<typeof diagnosticPreviewSchema>;
export type SupportDiagnosticCreate = z.output<typeof diagnosticCreateSchema>;
export type SupportDiagnosticMutation = z.output<
  typeof diagnosticMutationSchema
>;
export type SupportDiagnosticCleanupInput = z.output<
  typeof diagnosticCleanupInputSchema
>;
export type SupportDiagnosticJobParams = z.output<
  typeof diagnosticJobParamsSchema
>;
export type SupportDiagnosticDownloadParams = z.output<
  typeof diagnosticDownloadParamsSchema
>;
export type SupportDiagnosticListQuery = z.output<
  typeof diagnosticListQuerySchema
>;
export type SupportDiagnosticContentQuery = z.output<
  typeof diagnosticContentQuerySchema
>;
export type SupportDiagnosticJob = z.output<typeof diagnosticJobSchema>;
export type SupportDiagnosticList = z.output<typeof diagnosticListSchema>;
export type SupportDiagnosticContent = z.output<typeof diagnosticContentSchema>;
export type SupportDiagnosticGrant = z.output<typeof diagnosticGrantSchema>;
export type SupportDiagnosticCleanupReview = z.output<
  typeof diagnosticCleanupReviewSchema
>;
export type SupportDiagnosticLog = z.output<typeof diagnosticLogSchema>;
export type SupportDiagnosticConfiguration = z.output<
  typeof diagnosticConfigurationSchema
>;
export type SupportDiagnosticMetric = z.output<typeof diagnosticMetricSchema>;
export type SupportDiagnosticOmission = z.output<
  typeof diagnosticOmissionSchema
>;
export type SupportDiagnosticManifest = z.output<
  typeof diagnosticManifestSchema
>;
export type SupportDiagnosticPayload = z.output<typeof diagnosticPayloadSchema>;
