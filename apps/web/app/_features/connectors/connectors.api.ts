import {
  archiveConnectorInputSchema,
  beginSyncRunInputSchema,
  cancelSyncRunInputSchema,
  conflictParamsSchema,
  connectorMetricsSnapshotResponseSchema,
  connectorOutcomeResponseSchema,
  connectorParamsSchema,
  connectorResponseSchema,
  connectorsResponseSchema,
  createConnectorInputSchema,
  diagnosticsExportInputSchema,
  diagnosticsExportResponseSchema,
  externalIdentityParamsSchema,
  fieldAuthorityImpactPreviewResponseSchema,
  fieldAuthorityPoliciesResponseSchema,
  fieldAuthorityPolicyResponseSchema,
  linkExternalIdentityInputSchema,
  mergeExternalIdentitiesInputSchema,
  previewFieldAuthorityPolicyInputSchema,
  productExternalIdentitiesResponseSchema,
  productExternalIdentityResponseSchema,
  requestSyncRunCommitInputSchema,
  resolveSyncConflictInputSchema,
  retrySyncRunInputSchema,
  setConnectorSecretInputSchema,
  syncConflictResponseSchema,
  syncConflictsResponseSchema,
  syncRunPlanItemsResponseSchema,
  syncRunResponseSchema,
  syncRunsResponseSchema,
  testConnectorInputSchema,
  unlinkExternalIdentityInputSchema,
  updateConnectorInputSchema,
  upsertFieldAuthorityPolicyInputSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  ArchiveConnectorInput,
  BeginSyncRunInput,
  CancelSyncRunInput,
  CreateConnectorInput,
  LinkExternalIdentityInput,
  MergeExternalIdentitiesInput,
  PreviewFieldAuthorityPolicyInput,
  RequestSyncRunCommitInput,
  ResolveSyncConflictInput,
  SetConnectorSecretInput,
  UnlinkExternalIdentityInput,
  UpdateConnectorInput,
  UpsertFieldAuthorityPolicyInput,
} from "@repo/contracts/connectors/types";

import type {
  ConnectorListQuery,
  IdentitiesQuery,
  PlanItemsQuery,
  SyncRunsQuery,
} from "./connectors.schemas";
import {
  connectorListQuerySchema,
  identitiesQuerySchema,
  planItemsQuerySchema,
  syncRunParamsSchema as localSyncRunParamsSchema,
  syncRunsQuerySchema,
} from "./connectors.schemas";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";
import { apiClient } from "../../_lib/http/api-client";

function connectorPath(connectorId: string, suffix = ""): `/${string}` {
  const parsed = connectorParamsSchema.safeParse({ connectorId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The connector identifier is invalid.",
      400,
    );
  }
  return `/api/v1/connectors/${parsed.data.connectorId}${suffix}`;
}

function syncRunPath(
  connectorId: string,
  runId: string,
  suffix = "",
): `/${string}` {
  const parsed = localSyncRunParamsSchema.safeParse({ connectorId, runId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The sync run identifier is invalid.",
      400,
    );
  }
  return `/api/v1/connectors/${parsed.data.connectorId}/sync-runs/${parsed.data.runId}${suffix}`;
}

function externalIdentityPath(
  connectorId: string,
  mappingId: string,
  suffix = "",
): `/${string}` {
  const parsed = externalIdentityParamsSchema.safeParse({
    connectorId,
    mappingId,
  });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The external identity identifier is invalid.",
      400,
    );
  }
  return `/api/v1/connectors/${parsed.data.connectorId}/identities/${parsed.data.mappingId}${suffix}`;
}

function conflictPath(conflictId: string, suffix = ""): `/${string}` {
  const parsed = conflictParamsSchema.safeParse({ conflictId });
  if (!parsed.success) {
    throw new ApiClientError(
      "invalid_request",
      "The conflict identifier is invalid.",
      400,
    );
  }
  return `/api/v1/connectors/conflicts/${parsed.data.conflictId}${suffix}`;
}

function queryPath(
  path: `/${string}`,
  query: Record<string, unknown>,
): `/${string}` {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search === "" ? path : `${path}?${search}`;
}

/** Typed browser boundary for the connectors PLM/ALM sync API. */
export class ConnectorsApi {
  async list(input: Partial<ConnectorListQuery> = {}, signal?: AbortSignal) {
    const query = apiClient.parseInput(connectorListQuerySchema, input);
    return authenticatedRequestJson({
      path: queryPath("/api/v1/connectors", query),
      schema: connectorsResponseSchema,
      signal,
    });
  }

  async get(connectorId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId),
      schema: connectorResponseSchema,
      signal,
    });
  }

  async create(input: CreateConnectorInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/connectors",
      method: "POST",
      body: input,
      inputSchema: createConnectorInputSchema,
      schema: connectorResponseSchema,
      signal,
    });
  }

  async update(
    connectorId: string,
    input: UpdateConnectorInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId),
      method: "PATCH",
      body: input,
      inputSchema: updateConnectorInputSchema,
      schema: connectorResponseSchema,
      signal,
    });
  }

  async setSecret(
    connectorId: string,
    input: SetConnectorSecretInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/secret"),
      method: "POST",
      body: input,
      inputSchema: setConnectorSecretInputSchema,
      schema: connectorResponseSchema,
      signal,
    });
  }

  async test(connectorId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/test"),
      method: "POST",
      body: {},
      inputSchema: testConnectorInputSchema,
      schema: connectorResponseSchema,
      signal,
    });
  }

  async archive(
    connectorId: string,
    input: ArchiveConnectorInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/archive"),
      method: "POST",
      body: input,
      inputSchema: archiveConnectorInputSchema,
      schema: connectorResponseSchema,
      signal,
    });
  }

  async getMapping(connectorId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/mapping"),
      schema: fieldAuthorityPoliciesResponseSchema,
      signal,
    });
  }

  async previewMapping(
    connectorId: string,
    input: PreviewFieldAuthorityPolicyInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/mapping/preview"),
      method: "POST",
      body: input,
      inputSchema: previewFieldAuthorityPolicyInputSchema,
      schema: fieldAuthorityImpactPreviewResponseSchema,
      signal,
    });
  }

  async saveMapping(
    connectorId: string,
    input: UpsertFieldAuthorityPolicyInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/mapping"),
      method: "POST",
      body: input,
      inputSchema: upsertFieldAuthorityPolicyInputSchema,
      schema: fieldAuthorityPolicyResponseSchema,
      signal,
    });
  }

  async listIdentities(
    connectorId: string,
    input: Partial<IdentitiesQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(identitiesQuerySchema, input);
    return authenticatedRequestJson({
      path: queryPath(connectorPath(connectorId, "/identities"), query),
      schema: productExternalIdentitiesResponseSchema,
      signal,
    });
  }

  async linkIdentity(
    connectorId: string,
    input: LinkExternalIdentityInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/identities/link"),
      method: "POST",
      body: input,
      inputSchema: linkExternalIdentityInputSchema,
      schema: productExternalIdentityResponseSchema,
      signal,
    });
  }

  async unlinkIdentity(
    connectorId: string,
    mappingId: string,
    input: UnlinkExternalIdentityInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: externalIdentityPath(connectorId, mappingId, "/unlink"),
      method: "POST",
      body: input,
      inputSchema: unlinkExternalIdentityInputSchema,
      schema: connectorOutcomeResponseSchema,
      signal,
    });
  }

  async mergeIdentities(
    connectorId: string,
    input: MergeExternalIdentitiesInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/identities/merge"),
      method: "POST",
      body: input,
      inputSchema: mergeExternalIdentitiesInputSchema,
      schema: connectorOutcomeResponseSchema,
      signal,
    });
  }

  async startSyncRun(
    connectorId: string,
    input: BeginSyncRunInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/sync-runs"),
      method: "POST",
      body: input,
      inputSchema: beginSyncRunInputSchema,
      schema: syncRunResponseSchema,
      signal,
    });
  }

  async listSyncRuns(
    connectorId: string,
    input: Partial<SyncRunsQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(syncRunsQuerySchema, input);
    return authenticatedRequestJson({
      path: queryPath(connectorPath(connectorId, "/sync-runs"), query),
      schema: syncRunsResponseSchema,
      signal,
    });
  }

  async getSyncRun(connectorId: string, runId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: syncRunPath(connectorId, runId),
      schema: syncRunResponseSchema,
      signal,
    });
  }

  async listPlanItems(
    connectorId: string,
    runId: string,
    input: Partial<PlanItemsQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(planItemsQuerySchema, input);
    return authenticatedRequestJson({
      path: queryPath(syncRunPath(connectorId, runId, "/plan-items"), query),
      schema: syncRunPlanItemsResponseSchema,
      signal,
    });
  }

  async requestCommit(
    connectorId: string,
    runId: string,
    input: RequestSyncRunCommitInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: syncRunPath(connectorId, runId, "/request-commit"),
      method: "POST",
      body: input,
      inputSchema: requestSyncRunCommitInputSchema,
      schema: syncRunResponseSchema,
      signal,
    });
  }

  async cancelSyncRun(
    connectorId: string,
    runId: string,
    input: CancelSyncRunInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: syncRunPath(connectorId, runId, "/cancel"),
      method: "POST",
      body: input,
      inputSchema: cancelSyncRunInputSchema,
      schema: syncRunResponseSchema,
      signal,
    });
  }

  async retrySyncRun(connectorId: string, runId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: syncRunPath(connectorId, runId, "/retry"),
      method: "POST",
      body: {},
      inputSchema: retrySyncRunInputSchema,
      schema: syncRunResponseSchema,
      signal,
    });
  }

  async listRunConflicts(
    connectorId: string,
    runId: string,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: syncRunPath(connectorId, runId, "/conflicts"),
      schema: syncConflictsResponseSchema,
      signal,
    });
  }

  async getConflict(conflictId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: conflictPath(conflictId),
      schema: syncConflictResponseSchema,
      signal,
    });
  }

  async resolveConflict(
    conflictId: string,
    input: ResolveSyncConflictInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: conflictPath(conflictId, "/resolve"),
      method: "POST",
      body: input,
      inputSchema: resolveSyncConflictInputSchema,
      schema: syncConflictResponseSchema,
      signal,
    });
  }

  async listDeadLetters(
    connectorId: string,
    input: Partial<SyncRunsQuery> = {},
    signal?: AbortSignal,
  ) {
    const query = apiClient.parseInput(syncRunsQuerySchema, input);
    return authenticatedRequestJson({
      path: queryPath(connectorPath(connectorId, "/dead-letters"), query),
      schema: syncRunsResponseSchema,
      signal,
    });
  }

  async getMetricsSnapshot(connectorId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/metrics-snapshot"),
      schema: connectorMetricsSnapshotResponseSchema,
      signal,
    });
  }

  async exportDiagnostics(connectorId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: connectorPath(connectorId, "/diagnostics/export"),
      method: "POST",
      body: {},
      inputSchema: diagnosticsExportInputSchema,
      schema: diagnosticsExportResponseSchema,
      signal,
    });
  }
}

export const connectorsApi = Object.freeze(new ConnectorsApi());
