import type { z } from "zod";

import type {
  sbomComponentParamsSchema,
  sbomComponentSchema,
  sbomComponentSearchQuerySchema,
  sbomComponentSearchResponseSchema,
  sbomDependencyTreeQuerySchema,
  sbomDependencyTreeResponseSchema,
  sbomDocumentDetailResponseSchema,
  sbomDocumentListQuerySchema,
  sbomDocumentListResponseSchema,
  sbomDocumentParamsSchema,
  sbomDocumentSchema,
  sbomNormalizationDiagnosticSchema,
  sbomNormalizationStateSchema,
} from "../schemas/index.js";

export type SbomNormalizationState = z.output<
  typeof sbomNormalizationStateSchema
>;
export type SbomNormalizationDiagnostic = z.output<
  typeof sbomNormalizationDiagnosticSchema
>;
export type SbomDocument = z.output<typeof sbomDocumentSchema>;
export type SbomDocumentParams = z.output<typeof sbomDocumentParamsSchema>;
export type SbomComponentParams = z.output<typeof sbomComponentParamsSchema>;
export type SbomDocumentListQuery = z.output<
  typeof sbomDocumentListQuerySchema
>;
export type SbomDocumentListResponse = z.output<
  typeof sbomDocumentListResponseSchema
>;
export type SbomDocumentDetailResponse = z.output<
  typeof sbomDocumentDetailResponseSchema
>;
export type SbomComponent = z.output<typeof sbomComponentSchema>;
export type SbomComponentSearchQuery = z.output<
  typeof sbomComponentSearchQuerySchema
>;
export type SbomComponentSearchResponse = z.output<
  typeof sbomComponentSearchResponseSchema
>;
export type SbomDependencyTreeQuery = z.output<
  typeof sbomDependencyTreeQuerySchema
>;
export type SbomDependencyTreeResponse = z.output<
  typeof sbomDependencyTreeResponseSchema
>;
