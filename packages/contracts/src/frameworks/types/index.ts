import type { z } from "zod";
import type {
  frameworkCatalogResponseSchema,
  frameworkPackImportSchema,
  frameworkRequirementReferenceSchema,
  frameworkSelectionResponseSchema,
  frameworkTreeResponseSchema,
  selectFrameworkInputSchema,
} from "../schemas/framework.schema.js";

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
