import {
  frameworkCatalogResponseSchema,
  frameworkSelectionParamsSchema,
  frameworkSelectionResponseSchema,
  frameworkTreeParamsSchema,
  frameworkTreeQuerySchema,
  frameworkTreeResponseSchema,
  selectFrameworkInputSchema,
  type SelectFrameworkInput,
} from "@repo/contracts/frameworks";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function packPath(packKey: string): `/${string}` {
  const parsed = frameworkSelectionParamsSchema.safeParse({ packKey });
  if (!parsed.success)
    throw new ApiClientError("invalid_request", "Invalid framework key.", 400);
  return `/api/v1/frameworks/${encodeURIComponent(parsed.data.packKey)}`;
}

export class FrameworksApi {
  catalog(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/frameworks",
      schema: frameworkCatalogResponseSchema,
      signal,
    });
  }

  tree(
    packKey: string,
    versionKey: string,
    cursor?: string,
    signal?: AbortSignal,
  ) {
    const parsed = frameworkTreeParamsSchema.safeParse({ packKey, versionKey });
    if (!parsed.success)
      throw new ApiClientError(
        "invalid_request",
        "Invalid framework version.",
        400,
      );
    const query = apiClient.parseInput(frameworkTreeQuerySchema, {
      limit: 100,
      cursor,
    });
    const search = new URLSearchParams({ limit: String(query.limit) });
    if (query.cursor) search.set("cursor", query.cursor);
    return authenticatedRequestJson({
      path: `${packPath(parsed.data.packKey)}/versions/${encodeURIComponent(parsed.data.versionKey)}/tree?${search}`,
      schema: frameworkTreeResponseSchema,
      signal,
    });
  }

  select(packKey: string, input: SelectFrameworkInput) {
    return authenticatedRequestJson({
      path: `${packPath(packKey)}/selection`,
      method: "PUT",
      body: input,
      inputSchema: selectFrameworkInputSchema,
      schema: frameworkSelectionResponseSchema,
    });
  }
}

export const frameworksApi = new FrameworksApi();
