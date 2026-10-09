import type { z } from "zod";

import type {
  ciBuildGateVerdictResponseSchema,
  ciBuildGateVerdictSchema,
  ciBindingRunsQuerySchema,
  ciBindingRunsResponseSchema,
  ciBuildRunSummarySchema,
  ciProviderWebhookParamsSchema,
  ciBuildMetadataSchema,
  ciBuildReferenceSchema,
  ciBuildParamsSchema,
  ciProviderReleaseBindingParamsSchema,
  ciCompleteSbomWithBuildInputSchema,
  ciInitializeSbomWithBuildInputSchema,
  ciProviderReleaseBindingResponseSchema,
  ciProviderReleaseBindingsResponseSchema,
  ciProviderReleaseBindingSchema,
  ciProviderSchema,
  revokeCiProviderReleaseBindingInputSchema,
  upsertCiProviderReleaseBindingInputSchema,
} from "../schemas/index.js";

export type CiProvider = z.output<typeof ciProviderSchema>;
export type CiProviderReleaseBinding = z.output<
  typeof ciProviderReleaseBindingSchema
>;
export type UpsertCiProviderReleaseBindingInput = z.output<
  typeof upsertCiProviderReleaseBindingInputSchema
>;
export type RevokeCiProviderReleaseBindingInput = z.output<
  typeof revokeCiProviderReleaseBindingInputSchema
>;
export type CiBuildMetadata = z.output<typeof ciBuildMetadataSchema>;
export type CiBuildReference = z.output<typeof ciBuildReferenceSchema>;
export type CiInitializeSbomWithBuildInput = z.output<
  typeof ciInitializeSbomWithBuildInputSchema
>;
export type CiCompleteSbomWithBuildInput = z.output<
  typeof ciCompleteSbomWithBuildInputSchema
>;
export type CiProviderReleaseBindingParams = z.output<
  typeof ciProviderReleaseBindingParamsSchema
>;
export type CiBuildParams = z.output<typeof ciBuildParamsSchema>;
export type CiBuildGateVerdict = z.output<typeof ciBuildGateVerdictSchema>;
export type CiProviderReleaseBindingResponse = z.output<
  typeof ciProviderReleaseBindingResponseSchema
>;
export type CiProviderReleaseBindingsResponse = z.output<
  typeof ciProviderReleaseBindingsResponseSchema
>;
export type CiBuildGateVerdictResponse = z.output<
  typeof ciBuildGateVerdictResponseSchema
>;
export type CiBindingRunsQuery = z.output<typeof ciBindingRunsQuerySchema>;
export type CiBindingRunsResponse = z.output<typeof ciBindingRunsResponseSchema>;
export type CiBuildRunSummary = z.output<typeof ciBuildRunSummarySchema>;
export type CiProviderWebhookParams = z.output<typeof ciProviderWebhookParamsSchema>;
