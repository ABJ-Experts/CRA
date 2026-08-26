import {
  replayVulnerabilitySyncInputSchema,
  replayVulnerabilitySyncParamsSchema,
  triggerVulnerabilitySyncInputSchema,
  vulnerabilityFeedHealthResponseSchema,
  vulnerabilityFeedParamsSchema,
  vulnerabilitySyncRunListQuerySchema,
  vulnerabilitySyncRunListResponseSchema,
  vulnerabilitySyncRunResponseSchema,
  type ReplayVulnerabilitySyncInput,
  type TriggerVulnerabilitySyncInput,
  type VulnerabilityFeedKey,
  type VulnerabilitySyncRunListQuery,
} from "@repo/contracts/vulnerabilities";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function feedPath(feedKey: VulnerabilityFeedKey, suffix = ""): `/${string}` {
  const parsed = vulnerabilityFeedParamsSchema.safeParse({ feedKey });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The vulnerability feed identifier is invalid.",
      400,
    );
  }
  return `/api/v1/vulnerability-feeds/${parsed.data.feedKey}${suffix}`;
}

function replayPath(
  feedKey: VulnerabilityFeedKey,
  runId: string,
): `/${string}` {
  const parsed = replayVulnerabilitySyncParamsSchema.safeParse({
    feedKey,
    runId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The vulnerability sync run identifier is invalid.",
      400,
    );
  }
  return `${feedPath(parsed.data.feedKey)}/sync-runs/${parsed.data.runId}/replay`;
}

function queryPath(input: VulnerabilitySyncRunListQuery): `/${string}` {
  const params = new URLSearchParams();
  params.set("page", String(input.page));
  params.set("pageSize", String(input.pageSize));
  params.set("order", input.order);
  if (input.sort !== undefined) params.set("sort", input.sort);
  if (input.q !== undefined) params.set("q", input.q);
  if (input.feedKey !== undefined) params.set("feedKey", input.feedKey);
  if (input.status !== undefined) params.set("status", input.status);
  return `/api/v1/vulnerability-feeds/sync-runs?${params.toString()}`;
}

/** Typed browser boundary for deployment-local vulnerability intelligence. */
export class VulnerabilityFeedsApi {
  health(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/vulnerability-feeds/health",
      schema: vulnerabilityFeedHealthResponseSchema,
      signal,
    });
  }

  async listRuns(
    input: Partial<VulnerabilitySyncRunListQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(
      vulnerabilitySyncRunListQuerySchema,
      input,
    );
    return authenticatedRequestJson({
      path: queryPath(query),
      schema: vulnerabilitySyncRunListResponseSchema,
      signal,
    });
  }

  sync(
    feedKey: VulnerabilityFeedKey,
    input: TriggerVulnerabilitySyncInput = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: feedPath(feedKey, "/sync"),
      method: "POST",
      body: input,
      inputSchema: triggerVulnerabilitySyncInputSchema,
      schema: vulnerabilitySyncRunResponseSchema,
      signal,
    });
  }

  replay(
    feedKey: VulnerabilityFeedKey,
    runId: string,
    input: ReplayVulnerabilitySyncInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: replayPath(feedKey, runId),
      method: "POST",
      body: input,
      inputSchema: replayVulnerabilitySyncInputSchema,
      schema: vulnerabilitySyncRunResponseSchema,
      signal,
    });
  }
}

export const vulnerabilityFeedsApi = Object.freeze(new VulnerabilityFeedsApi());
