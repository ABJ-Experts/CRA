import type {
  addTechnicalFileSourceRequestSchema,
  createTechnicalFileRequestSchema,
  technicalFileSchema,
  technicalFileWorkspaceResponseSchema,
  technicalFileSectionSchema,
  technicalFileSourceKindSchema,
  removeTechnicalFileSourceRequestSchema,
  updateTechnicalFileSectionRequestSchema,
} from "../schemas/technical-file.schema.js";
import type { z } from "zod";

export type TechnicalFile = z.output<typeof technicalFileSchema>;
export type TechnicalFileWorkspace = z.output<
  typeof technicalFileWorkspaceResponseSchema
>;
export type TechnicalFileSection = z.output<typeof technicalFileSectionSchema>;
export type TechnicalFileSourceKind = z.output<
  typeof technicalFileSourceKindSchema
>;
export type CreateTechnicalFileRequest = z.output<
  typeof createTechnicalFileRequestSchema
>;
export type UpdateTechnicalFileSectionRequest = z.output<
  typeof updateTechnicalFileSectionRequestSchema
>;
export type AddTechnicalFileSourceRequest = z.output<
  typeof addTechnicalFileSourceRequestSchema
>;
export type RemoveTechnicalFileSourceRequest = z.output<
  typeof removeTechnicalFileSourceRequestSchema
>;
