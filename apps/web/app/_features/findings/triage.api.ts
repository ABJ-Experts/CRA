import {
  createVulnerabilitySavedViewInputSchema,
  deleteVulnerabilitySavedViewInputSchema,
  setDefaultVulnerabilitySavedViewInputSchema,
  updateVulnerabilitySavedViewInputSchema,
  vulnerabilitySavedViewMutationResponseSchema,
  vulnerabilitySavedViewParamsSchema,
  vulnerabilitySavedViewsResponseSchema,
  vulnerabilityTriageDetailResponseSchema,
  vulnerabilityTriageFindingParamsSchema,
  vulnerabilityTriageQueueQuerySchema,
  vulnerabilityTriageQueueResponseSchema,
  type CreateVulnerabilitySavedViewInput,
  type DeleteVulnerabilitySavedViewInput,
  type SetDefaultVulnerabilitySavedViewInput,
  type UpdateVulnerabilitySavedViewInput,
  type VulnerabilityTriageQueueQuery,
} from "@repo/contracts/vulnerabilities";

import { ApiClientError, apiClient } from "../../_lib/http/api-client";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";

function findingPath(findingId: string): `/${string}` {
  const parsed = vulnerabilityTriageFindingParamsSchema.safeParse({
    findingId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The finding identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/${parsed.data.findingId}`;
}

function savedViewPath(viewId: string): `/${string}` {
  const parsed = vulnerabilitySavedViewParamsSchema.safeParse({ viewId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The saved view identifier is invalid.",
      400,
    );
  }
  return `/api/v1/findings/saved-views/${parsed.data.viewId}`;
}

function appendMany(
  search: URLSearchParams,
  key: string,
  values?: readonly string[],
) {
  values?.forEach((value) => search.append(key, value));
}

function queuePath(query: VulnerabilityTriageQueueQuery): `/${string}` {
  const search = new URLSearchParams({
    limit: String(query.limit),
    sort: query.sort,
    order: query.order,
  });
  if (query.cursor) search.set("cursor", query.cursor);
  appendMany(search, "productIds", query.productIds);
  appendMany(search, "releaseIds", query.releaseIds);
  appendMany(search, "severities", query.severities);
  appendMany(search, "kevStatuses", query.kevStatuses);
  appendMany(search, "findingStates", query.findingStates);
  appendMany(search, "assessmentStates", query.assessmentStates);
  appendMany(search, "reEvaluationStates", query.reEvaluationStates);
  appendMany(search, "assessedByUserIds", query.assessedByUserIds);
  appendMany(search, "reachability", query.reachability);
  if (query.epssState) search.set("epssState", query.epssState);
  if (query.epssMin !== undefined) search.set("epssMin", String(query.epssMin));
  if (query.epssMax !== undefined) search.set("epssMax", String(query.epssMax));
  if (query.ageDaysMin !== undefined)
    search.set("ageDaysMin", String(query.ageDaysMin));
  if (query.ageDaysMax !== undefined)
    search.set("ageDaysMax", String(query.ageDaysMax));
  return `/api/v1/findings?${search.toString()}`;
}

/** Typed browser boundary for the tenant-scoped, server-paginated queue. */
export class VulnerabilityTriageApi {
  list(
    input: Partial<VulnerabilityTriageQueueQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(
      vulnerabilityTriageQueueQuerySchema,
      input,
    );
    return authenticatedRequestJson({
      path: queuePath(query),
      schema: vulnerabilityTriageQueueResponseSchema,
      signal,
    });
  }

  detail(findingId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: findingPath(findingId),
      schema: vulnerabilityTriageDetailResponseSchema,
      signal,
    });
  }

  listSavedViews(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/saved-views",
      schema: vulnerabilitySavedViewsResponseSchema,
      signal,
    });
  }

  createSavedView(input: CreateVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/saved-views",
      method: "POST",
      inputSchema: createVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }

  updateSavedView(viewId: string, input: UpdateVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: savedViewPath(viewId),
      method: "PATCH",
      inputSchema: updateVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }

  deleteSavedView(viewId: string, input: DeleteVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: savedViewPath(viewId),
      method: "DELETE",
      inputSchema: deleteVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }

  setDefaultSavedView(input: SetDefaultVulnerabilitySavedViewInput) {
    return authenticatedRequestJson({
      path: "/api/v1/findings/saved-views/default",
      method: "PUT",
      inputSchema: setDefaultVulnerabilitySavedViewInputSchema,
      body: input,
      schema: vulnerabilitySavedViewMutationResponseSchema,
    });
  }
}

export const vulnerabilityTriageApi = Object.freeze(
  new VulnerabilityTriageApi(),
);
