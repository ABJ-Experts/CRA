import type { z } from "zod";

import type {
  ciCompleteSbomUploadInputSchema,
  ciInitializeSbomUploadInputSchema,
  completeSbomUploadInputSchema,
  createSbomCiCredentialInputSchema,
  createSbomCiCredentialResponseSchema,
  createSbomSourceInputSchema,
  initializeSbomUploadInputSchema,
  replaySbomJobInputSchema,
  revokeSbomCiCredentialInputSchema,
  sbomCiCredentialListResponseSchema,
  sbomCiCredentialParamsSchema,
  sbomCiCredentialResponseSchema,
  sbomCiCredentialSchema,
  sbomJobProgressUrlSchema,
  sbomJobParamsSchema,
  sbomJobResponseSchema,
  sbomJobSchema,
  sbomOriginalDownloadResponseSchema,
  sbomSourceParamsSchema,
  sbomReleaseParamsSchema,
  sbomSourceSchema,
  sbomUploadInitializationResponseSchema,
  sbomUploadCompletionResponseSchema,
  sbomUploadCompletionSchema,
  sbomUploadParamsSchema,
} from "../schemas/index.js";

export type InitializeSbomUploadInput = z.output<
  typeof initializeSbomUploadInputSchema
>;
export type CiInitializeSbomUploadInput = z.output<
  typeof ciInitializeSbomUploadInputSchema
>;
export type CreateSbomSourceInput = z.output<
  typeof createSbomSourceInputSchema
>;
export type CompleteSbomUploadInput = z.output<
  typeof completeSbomUploadInputSchema
>;
export type CiCompleteSbomUploadInput = z.output<
  typeof ciCompleteSbomUploadInputSchema
>;
export type SbomUploadParams = z.output<typeof sbomUploadParamsSchema>;
export type SbomReleaseParams = z.output<typeof sbomReleaseParamsSchema>;
export type SbomSourceParams = z.output<typeof sbomSourceParamsSchema>;
export type SbomJobParams = z.output<typeof sbomJobParamsSchema>;
export type SbomSource = z.output<typeof sbomSourceSchema>;
export type SbomJob = z.output<typeof sbomJobSchema>;
export type SbomJobProgressUrl = z.output<typeof sbomJobProgressUrlSchema>;
export type SbomUploadInitializationResponse = z.output<
  typeof sbomUploadInitializationResponseSchema
>;
export type SbomJobResponse = z.output<typeof sbomJobResponseSchema>;
export type SbomUploadCompletion = z.output<typeof sbomUploadCompletionSchema>;
export type SbomUploadCompletionResponse = z.output<
  typeof sbomUploadCompletionResponseSchema
>;
export type SbomOriginalDownloadResponse = z.output<
  typeof sbomOriginalDownloadResponseSchema
>;
export type CreateSbomCiCredentialInput = z.output<
  typeof createSbomCiCredentialInputSchema
>;
export type CreateSbomCiCredentialResponse = z.output<
  typeof createSbomCiCredentialResponseSchema
>;
export type RevokeSbomCiCredentialInput = z.output<
  typeof revokeSbomCiCredentialInputSchema
>;
export type ReplaySbomJobInput = z.output<typeof replaySbomJobInputSchema>;
export type SbomCiCredential = z.output<typeof sbomCiCredentialSchema>;
export type SbomCiCredentialParams = z.output<
  typeof sbomCiCredentialParamsSchema
>;
export type SbomCiCredentialListResponse = z.output<
  typeof sbomCiCredentialListResponseSchema
>;
export type SbomCiCredentialResponse = z.output<
  typeof sbomCiCredentialResponseSchema
>;
