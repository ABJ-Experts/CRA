import type { z } from "zod";

import type {
  createSbomDiffInputSchema,
  retrySbomDiffInputSchema,
  sbomSourceDiffQuerySchema,
  sbomSourceDiffResponseSchema,
  sbomDiffComponentChangeSchema,
  sbomFindingDeltaItemSchema,
  sbomComponentChangeKindSchema,
  sbomDiffComponentsQuerySchema,
  sbomDiffComponentsResponseSchema,
  sbomDiffFindingsQuerySchema,
  sbomDiffFindingsResponseSchema,
  sbomDiffReportResponseSchema,
  sbomDiffReportSchema,
  sbomDiffStartResponseSchema,
  sbomDiffParamsSchema,
  sbomSourceDiffParamsSchema,
} from "../schemas/index.js";

export type SbomSourceDiffParams = z.output<typeof sbomSourceDiffParamsSchema>;
export type SbomDiffParams = z.output<typeof sbomDiffParamsSchema>;
export type CreateSbomDiffInput = z.output<typeof createSbomDiffInputSchema>;
export type RetrySbomDiffInput = z.output<typeof retrySbomDiffInputSchema>;
export type SbomSourceDiffQuery = z.output<typeof sbomSourceDiffQuerySchema>;
export type SbomSourceDiffResponse = z.output<
  typeof sbomSourceDiffResponseSchema
>;
export type SbomComponentChangeKind = z.output<
  typeof sbomComponentChangeKindSchema
>;
export type SbomDiffComponentChange = z.output<
  typeof sbomDiffComponentChangeSchema
>;
export type SbomFindingDeltaItem = z.output<typeof sbomFindingDeltaItemSchema>;
export type SbomDiffReport = z.output<typeof sbomDiffReportSchema>;
export type SbomDiffReportResponse = z.output<
  typeof sbomDiffReportResponseSchema
>;
export type SbomDiffStartResponse = z.output<
  typeof sbomDiffStartResponseSchema
>;
export type SbomDiffComponentsQuery = z.output<
  typeof sbomDiffComponentsQuerySchema
>;
export type SbomDiffComponentsResponse = z.output<
  typeof sbomDiffComponentsResponseSchema
>;
export type SbomDiffFindingsQuery = z.output<
  typeof sbomDiffFindingsQuerySchema
>;
export type SbomDiffFindingsResponse = z.output<
  typeof sbomDiffFindingsResponseSchema
>;
