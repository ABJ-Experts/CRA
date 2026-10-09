import {
  customFrameworkCommandInputSchema,
  customFrameworkCommandResponseSchema,
  customFrameworkDetailResponseSchema,
  customFrameworkExportQuerySchema,
  customFrameworkImportSchema,
  customFrameworkListQuerySchema,
  customFrameworkListResponseSchema,
  customFrameworkParamsSchema,
  customFrameworkValidationInputSchema,
  customFrameworkValidationResponseSchema,
  type CustomFrameworkCommandInput,
} from "@repo/contracts/frameworks";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { apiClient } from "../../_lib/http/api-client";

function detailPath(draftId: string): `/${string}` {
  const params = apiClient.parseInput(customFrameworkParamsSchema, { draftId });
  return `/api/v1/frameworks/custom/${encodeURIComponent(params.draftId)}`;
}

export class CustomFrameworksApi {
  list(limit = 20, offset = 0, signal?: AbortSignal) {
    const query = apiClient.parseInput(customFrameworkListQuerySchema, {
      limit,
      offset,
    });
    return authenticatedRequestJson({
      path: `/api/v1/frameworks/custom?limit=${query.limit}&offset=${query.offset}`,
      schema: customFrameworkListResponseSchema,
      signal,
    });
  }

  detail(draftId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: detailPath(draftId),
      schema: customFrameworkDetailResponseSchema,
      signal,
    });
  }

  parseImport(input: unknown) {
    return apiClient.parseInput(customFrameworkImportSchema, input);
  }

  async validate(input: unknown) {
    const body = apiClient.parseInput(customFrameworkValidationInputSchema, input);
    return authenticatedRequestJson({
      path: "/api/v1/frameworks/custom/validate",
      method: "POST",
      body,
      inputSchema: customFrameworkValidationInputSchema,
      schema: customFrameworkValidationResponseSchema,
    });
  }

  command(draftId: string | null, input: CustomFrameworkCommandInput) {
    const body = apiClient.parseInput(customFrameworkCommandInputSchema, input);
    return authenticatedRequestJson({
      path:
        draftId === null ? "/api/v1/frameworks/custom" : detailPath(draftId),
      method: draftId === null ? "POST" : "PUT",
      body,
      inputSchema: customFrameworkCommandInputSchema,
      schema: customFrameworkCommandResponseSchema,
    });
  }

  export(draftId: string, versionKey?: string) {
    const query = apiClient.parseInput(customFrameworkExportQuerySchema, {
      versionKey,
    });
    const search = query.versionKey
      ? `?${new URLSearchParams({ versionKey: query.versionKey })}`
      : "";
    return authenticatedRequestJson({
      path: `${detailPath(draftId)}/export${search}`,
      schema: customFrameworkImportSchema,
    });
  }
}

export const customFrameworksApi = new CustomFrameworksApi();
