import {
  confirmVulnerabilityOfflineBundleInputSchema,
  replayVulnerabilitySyncInputSchema,
  replayVulnerabilitySyncParamsSchema,
  triggerVulnerabilitySyncInputSchema,
  vulnerabilityCsafReconciliationDetailResponseSchema,
  vulnerabilityCsafReconciliationParamsSchema,
  vulnerabilityFeedHealthResponseSchema,
  vulnerabilityFeedParamsSchema,
  vulnerabilityOfflineBundleImportParamsSchema,
  vulnerabilityOfflineBundleImportStatusResponseSchema,
  vulnerabilityOfflineBundlePreflightFieldsSchema,
  vulnerabilityOfflineBundlePreflightResponseSchema,
  vulnerabilitySyncRunListQuerySchema,
  vulnerabilitySyncRunListResponseSchema,
  vulnerabilitySyncRunResponseSchema,
  type ReplayVulnerabilitySyncInput,
  type ConfirmVulnerabilityOfflineBundleInput,
  type TriggerVulnerabilitySyncInput,
  type VulnerabilityFeedKey,
  type VulnerabilityOfflineBundlePreflightFieldsInput,
  type VulnerabilitySyncRunListQuery,
} from "@repo/contracts/vulnerabilities";

import {
  authenticatedRequestJson,
  authenticatedRequestMultipart,
} from "../../_lib/http/authenticated-request";
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

function offlineBundlePath(importId?: string, suffix = ""): `/${string}` {
  if (importId === undefined) {
    return `/api/v1/vulnerability-feeds/offline-bundles${suffix}`;
  }
  const parsed = vulnerabilityOfflineBundleImportParamsSchema.safeParse({
    importId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The offline bundle import identifier is invalid.",
      400,
    );
  }
  return `/api/v1/vulnerability-feeds/offline-bundles/${parsed.data.importId}${suffix}`;
}

function csafReconciliationPath(canonicalId: string): `/${string}` {
  const parsed = vulnerabilityCsafReconciliationParamsSchema.safeParse({
    canonicalId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The canonical advisory identifier is invalid.",
      400,
    );
  }
  return `/api/v1/vulnerability-feeds/csaf-reconciliations/${encodeURIComponent(parsed.data.canonicalId)}`;
}

export type OfflineBundleUploadFiles = Readonly<{
  manifest: File;
  signature: File;
  /** Browser file names cannot carry directory segments, so the operator maps
   * each selected file to the exact manifest path used for its multipart name. */
  payloads: readonly Readonly<{ file: File; manifestPath: string }>[];
}>;

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

  preflightOfflineBundle(
    files: OfflineBundleUploadFiles,
    input: VulnerabilityOfflineBundlePreflightFieldsInput,
    signal?: AbortSignal,
  ) {
    if (files.payloads.length === 0) {
      throw new ApiClientError(
        "invalid_request",
        "Select every manifest payload before preflight.",
        400,
      );
    }
    return authenticatedRequestMultipart({
      path: offlineBundlePath(undefined, "/preflight"),
      method: "POST",
      fields: input,
      fieldsSchema: vulnerabilityOfflineBundlePreflightFieldsSchema,
      files: [
        { name: "manifest", value: files.manifest },
        { name: "signature", value: files.signature },
        ...files.payloads.map((payload) => ({
          name: "payloads",
          value: payload.file,
          filename: payload.manifestPath,
        })),
      ],
      schema: vulnerabilityOfflineBundlePreflightResponseSchema,
      signal,
    });
  }

  offlineBundleImport(importId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: offlineBundlePath(importId),
      schema: vulnerabilityOfflineBundleImportStatusResponseSchema,
      signal,
    });
  }

  confirmOfflineBundle(
    importId: string,
    input: ConfirmVulnerabilityOfflineBundleInput,
  ) {
    return authenticatedRequestJson({
      path: offlineBundlePath(importId, "/confirm"),
      method: "POST",
      body: input,
      inputSchema: confirmVulnerabilityOfflineBundleInputSchema,
      schema: vulnerabilityOfflineBundleImportStatusResponseSchema,
    });
  }

  csafReconciliation(canonicalId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: csafReconciliationPath(canonicalId),
      schema: vulnerabilityCsafReconciliationDetailResponseSchema,
      signal,
    });
  }
}

export const vulnerabilityFeedsApi = Object.freeze(new VulnerabilityFeedsApi());
