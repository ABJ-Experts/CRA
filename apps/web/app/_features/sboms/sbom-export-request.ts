import {
  sbomDocumentParamsSchema,
  sbomExportQuerySchema,
  sbomExportResponseSchema,
  type SbomExportQuery,
} from "@repo/contracts/sboms";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

/** Parsed read projection; the owning gateway exposes this without a second store or workflow. */
export function requestSbomExport(
  documentId: string,
  query: SbomExportQuery,
  signal?: AbortSignal,
) {
  const params = apiClient.parseInput(sbomDocumentParamsSchema, { documentId });
  const parsed = apiClient.parseInput(sbomExportQuerySchema, query);
  const search = new URLSearchParams({
    sourceId: parsed.sourceId,
    format: parsed.format,
    includeVex: String(parsed.includeVex),
  });
  return authenticatedRequestJson<typeof sbomExportResponseSchema>({
    path: `/api/v1/sbom-documents/${params.documentId}/export?${search.toString()}`,
    schema: sbomExportResponseSchema,
    signal,
  }).then((response) => {
    const exported = response.export;
    if (
      exported.documentId !== documentId ||
      exported.sourceId !== parsed.sourceId ||
      exported.format !== parsed.format ||
      (exported.vex.status === "included") !== parsed.includeVex
    ) {
      throw new ApiClientError(
        "invalid_response",
        "The export did not match the selected document and options.",
      );
    }
    return response;
  });
}
