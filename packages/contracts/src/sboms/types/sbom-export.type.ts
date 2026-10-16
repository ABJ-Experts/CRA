import type { z } from "zod";
import type {
  sbomExportQuerySchema,
  sbomExportResponseSchema,
} from "../schemas/sbom-export.schema.js";
export type SbomExportQuery = z.output<typeof sbomExportQuerySchema>;
export type SbomExportResponse = z.output<typeof sbomExportResponseSchema>;
