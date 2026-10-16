import type {
  createTechnicalFileAuditorGrantRequestSchema,
  redeemTechnicalFileAuditorGrantRequestSchema,
  revokeTechnicalFileAuditorGrantRequestSchema,
  technicalFileAuditorAccessUnavailableResponseSchema,
  technicalFileAuditorArtifactParamsSchema,
  technicalFileAuditorGrantCollectionParamsSchema,
  technicalFileAuditorGrantCreatedResponseSchema,
  technicalFileAuditorGrantParamsSchema,
  technicalFileAuditorGrantPreviewQuerySchema,
  technicalFileAuditorGrantPreviewResponseSchema,
  technicalFileAuditorGrantResponseSchema,
  technicalFileAuditorGrantsResponseSchema,
  technicalFileAuditorManifestResponseSchema,
  technicalFileAuditorSnapshotViewResponseSchema,
} from "../schemas/technical-file-auditor-access.schema.js";
import type { z } from "zod";

export type TechnicalFileAuditorGrantCollectionParams = z.output<typeof technicalFileAuditorGrantCollectionParamsSchema>;
export type TechnicalFileAuditorGrantParams = z.output<typeof technicalFileAuditorGrantParamsSchema>;
export type TechnicalFileAuditorGrantPreviewQuery = z.output<typeof technicalFileAuditorGrantPreviewQuerySchema>;
export type CreateTechnicalFileAuditorGrantRequest = z.output<typeof createTechnicalFileAuditorGrantRequestSchema>;
export type RevokeTechnicalFileAuditorGrantRequest = z.output<typeof revokeTechnicalFileAuditorGrantRequestSchema>;
export type RedeemTechnicalFileAuditorGrantRequest = z.output<typeof redeemTechnicalFileAuditorGrantRequestSchema>;
export type TechnicalFileAuditorGrantResponse = z.output<typeof technicalFileAuditorGrantResponseSchema>;
export type TechnicalFileAuditorGrantsResponse = z.output<typeof technicalFileAuditorGrantsResponseSchema>;
export type TechnicalFileAuditorGrantPreviewResponse = z.output<typeof technicalFileAuditorGrantPreviewResponseSchema>;
export type TechnicalFileAuditorGrantCreatedResponse = z.output<typeof technicalFileAuditorGrantCreatedResponseSchema>;
export type TechnicalFileAuditorSnapshotViewResponse = z.output<typeof technicalFileAuditorSnapshotViewResponseSchema>;
export type TechnicalFileAuditorManifestResponse = z.output<typeof technicalFileAuditorManifestResponseSchema>;
export type TechnicalFileAuditorArtifactParams = z.output<typeof technicalFileAuditorArtifactParamsSchema>;
export type TechnicalFileAuditorAccessUnavailableResponse = z.output<typeof technicalFileAuditorAccessUnavailableResponseSchema>;
