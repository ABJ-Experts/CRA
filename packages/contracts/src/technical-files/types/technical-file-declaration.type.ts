import type {
  createTechnicalFileDeclarationDraftRequestSchema,
  updateTechnicalFileDeclarationDraftRequestSchema,
  issueTechnicalFileDeclarationRequestSchema,
  reissueTechnicalFileDeclarationRequestSchema,
  technicalFileDeclarationDownloadResponseSchema,
  technicalFileDeclarationParamsSchema,
  technicalFileDeclarationPreviewResponseSchema,
  technicalFileDeclarationPreviewSchema,
  technicalFileDeclarationResponseSchema,
  technicalFileDeclarationSchema,
  technicalFileDeclarationsResponseSchema,
} from "../schemas/technical-file-declaration.schema.js";
import type { z } from "zod";

export type TechnicalFileDeclarationAssessmentRoute = z.output<
  typeof import("../schemas/technical-file-declaration.schema.js").technicalFileDeclarationAssessmentRouteSchema
>;

export type TechnicalFileDeclaration = z.output<
  typeof technicalFileDeclarationSchema
>;
export type TechnicalFileDeclarationPreview = z.output<
  typeof technicalFileDeclarationPreviewSchema
>;
export type TechnicalFileDeclarationParams = z.output<
  typeof technicalFileDeclarationParamsSchema
>;
export type TechnicalFileDeclarationResponse = z.output<
  typeof technicalFileDeclarationResponseSchema
>;
export type TechnicalFileDeclarationsResponse = z.output<
  typeof technicalFileDeclarationsResponseSchema
>;
export type TechnicalFileDeclarationPreviewResponse = z.output<
  typeof technicalFileDeclarationPreviewResponseSchema
>;
export type TechnicalFileDeclarationDownloadResponse = z.output<
  typeof technicalFileDeclarationDownloadResponseSchema
>;
export type CreateTechnicalFileDeclarationDraftRequest = z.output<
  typeof createTechnicalFileDeclarationDraftRequestSchema
>;
export type UpdateTechnicalFileDeclarationDraftRequest = z.output<
  typeof updateTechnicalFileDeclarationDraftRequestSchema
>;
export type IssueTechnicalFileDeclarationRequest = z.output<
  typeof issueTechnicalFileDeclarationRequestSchema
>;
export type ReissueTechnicalFileDeclarationRequest = z.output<
  typeof reissueTechnicalFileDeclarationRequestSchema
>;
