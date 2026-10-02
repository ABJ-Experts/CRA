import {
  ciBindingRunsQuerySchema,
  ciBindingRunsResponseSchema,
  ciProviderReleaseBindingParamsSchema,
  ciProviderReleaseBindingResponseSchema,
  ciProviderReleaseBindingsResponseSchema,
  revokeCiProviderReleaseBindingInputSchema,
  upsertCiProviderReleaseBindingInputSchema,
  type RevokeCiProviderReleaseBindingInput,
  type UpsertCiProviderReleaseBindingInput,
} from "@repo/contracts/sboms";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

const collection = "/api/v1/sbom-ci-bindings" as const;

function bindingPath(bindingId: string, suffix = ""): `/${string}` {
  const parsed = ciProviderReleaseBindingParamsSchema.safeParse({ bindingId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The CI binding identifier is invalid.",
      400,
    );
  }
  return `${collection}/${parsed.data.bindingId}${suffix}`;
}

export class CiBindingsApi {
  list(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: collection,
      schema: ciProviderReleaseBindingsResponseSchema,
      signal,
    });
  }

  listRuns(bindingId: string, signal?: AbortSignal) {
    const query = ciBindingRunsQuerySchema.parse({ limit: 20 });
    return authenticatedRequestJson({
      path: bindingPath(bindingId, `/runs?limit=${query.limit}`),
      schema: ciBindingRunsResponseSchema,
      signal,
    });
  }

  create(input: UpsertCiProviderReleaseBindingInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: collection,
      method: "POST",
      body: input,
      inputSchema: upsertCiProviderReleaseBindingInputSchema,
      schema: ciProviderReleaseBindingResponseSchema,
      signal,
    });
  }

  revoke(
    bindingId: string,
    input: RevokeCiProviderReleaseBindingInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: bindingPath(bindingId, "/revoke"),
      method: "POST",
      body: input,
      inputSchema: revokeCiProviderReleaseBindingInputSchema,
      schema: ciProviderReleaseBindingResponseSchema,
      signal,
    });
  }
}

export const ciBindingsApi = new CiBindingsApi();
