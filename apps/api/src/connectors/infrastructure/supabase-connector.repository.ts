import { Injectable, Logger } from "@nestjs/common";
import {
  paged,
  resolvePage,
  type PageParams,
} from "@repo/contracts/pagination";

import { SupabaseService } from "../../supabase/supabase.service";
import { ConnectorError } from "../application/connector-errors";

type Row = Readonly<Record<string, unknown>>;
type RpcResult = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<RpcResult>;
}>;

/**
 * Thin wrapper over the connector-sync RPCs (service_role only, org-first).
 * Almost all business logic already lives in the SQL functions themselves
 * (see 20260820100000_m2_v2_connector_sync_foundation.sql) -- this class
 * exists to give the Nest layer a typed, org-scoped call surface, not to
 * re-implement anything the RPCs already guarantee.
 */
@Injectable()
export class SupabaseConnectorRepository {
  private readonly logger = new Logger(SupabaseConnectorRepository.name);

  constructor(private readonly supabase: SupabaseService) {}

  private client(): RpcClient {
    return this.supabase.admin() as unknown as RpcClient;
  }

  /** Runs an RPC expected to return exactly one row; throws ConnectorError("unavailable") otherwise. */
  private async singleRpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<Row> {
    let result: RpcResult;
    try {
      result = await this.client().rpc(name, args);
    } catch {
      throw new ConnectorError("unavailable");
    }
    if (
      result.error ||
      !Array.isArray(result.data) ||
      result.data.length !== 1
    ) {
      this.logger.warn(`connector_rpc_unavailable rpc=${name}`);
      throw new ConnectorError("unavailable");
    }
    return result.data[0] as Row;
  }

  private outcome<T extends string>(row: Row, allowed: ReadonlySet<T>): T {
    const outcome = row.outcome;
    if (typeof outcome !== "string" || !allowed.has(outcome as T)) {
      throw new ConnectorError("unavailable");
    }
    return outcome as T;
  }

  private assertFound<T extends string>(outcome: T): void {
    if (outcome === "not_found") throw new ConnectorError("not_found");
    if (outcome === "invalid_request")
      throw new ConnectorError("invalid_request");
    if (outcome === "conflict") throw new ConnectorError("conflict");
  }

  // --- Connectors -----------------------------------------------------------

  async createConnector(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("create_connector_atomic", args);
    const outcome = this.outcome(
      row,
      new Set(["created", "invalid_request", "not_found"]),
    );
    this.assertFound(outcome);
    return row.connector;
  }

  async updateConnector(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("update_connector_atomic", args);
    const outcome = this.outcome(
      row,
      new Set(["updated", "invalid_request", "not_found", "conflict"]),
    );
    this.assertFound(outcome);
    return row.connector;
  }

  async archiveConnector(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("archive_connector_atomic", args);
    const outcome = this.outcome(
      row,
      new Set(["archived", "not_found", "conflict", "invalid_state"]),
    );
    if (outcome === "invalid_state") throw new ConnectorError("invalid_state");
    this.assertFound(outcome);
    return row.connector;
  }

  async testConnector(
    organizationId: string,
    connectorId: string,
    actorId: string,
    outcome: "success" | "failure",
    errorCode: string | null,
    latencyMs: number,
  ) {
    const row = await this.singleRpc("record_connector_test_atomic", {
      p_organization_id: organizationId,
      p_connector_id: connectorId,
      p_actor_user_id: actorId,
      p_outcome: outcome,
      p_error_code: errorCode,
      p_latency_ms: latencyMs,
    });
    const rowOutcome = this.outcome(row, new Set(["tested", "not_found"]));
    this.assertFound(rowOutcome);
    return row.connector;
  }

  async setConnectorSecret(
    organizationId: string,
    connectorId: string,
    actorId: string,
    secretValue: string,
    encryptionKey: string,
  ) {
    const row = await this.singleRpc("set_connector_secret_atomic", {
      p_organization_id: organizationId,
      p_connector_id: connectorId,
      p_actor_user_id: actorId,
      p_secret_value: secretValue,
      p_encryption_key: encryptionKey,
    });
    const outcome = this.outcome(
      row,
      new Set(["updated", "invalid_request", "not_found"]),
    );
    this.assertFound(outcome);
    return row.connector;
  }

  /** Worker-only. Never call from a controller path. */
  async resolveConnectorSecret(
    organizationId: string,
    connectorId: string,
    encryptionKey: string,
  ): Promise<string | null> {
    let result: RpcResult;
    try {
      result = await this.client().rpc("resolve_connector_secret", {
        p_organization_id: organizationId,
        p_connector_id: connectorId,
        p_encryption_key: encryptionKey,
      });
    } catch {
      throw new ConnectorError("unavailable");
    }
    if (result.error) throw new ConnectorError("unavailable");
    return (result.data as string | null) ?? null;
  }

  async getConnector(orgId: string, connectorId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from("connectors")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", connectorId)
      .is("archived_at", null)
      .maybeSingle();
    if (error) throw new ConnectorError("unavailable");
    if (!data) throw new ConnectorError("not_found");
    return mapConnectorRow(data);
  }

  async listConnectors(orgId: string, params: PageParams) {
    const countQuery = this.supabase
      .admin()
      .from("connectors")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .is("archived_at", null);
    const countResult = await countQuery;
    if (countResult.error) throw new ConnectorError("unavailable");
    const total = countResult.count ?? 0;
    const { from, to } = resolvePage(total, params);
    const { data, error } = await this.supabase
      .admin()
      .from("connectors")
      .select("*")
      .eq("organization_id", orgId)
      .is("archived_at", null)
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new ConnectorError("unavailable");
    return paged((data ?? []).map(mapConnectorRow), total, params);
  }

  // --- Field authority policy -------------------------------------------------

  async upsertFieldAuthorityPolicy(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc(
      "upsert_field_authority_policy_atomic",
      args,
    );
    const outcome = this.outcome(
      row,
      new Set(["updated", "invalid_request", "not_found"]),
    );
    this.assertFound(outcome);
    return row.policy;
  }

  async previewFieldAuthorityPolicy(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("preview_field_authority_policy", args);
    const outcome = this.outcome(
      row,
      new Set(["previewed", "invalid_request", "not_found"]),
    );
    this.assertFound(outcome);
    return row.preview;
  }

  async listFieldAuthorityPolicies(
    organizationId: string,
    actorId: string,
    connectorId: string,
  ) {
    const row = await this.singleRpc("list_field_authority_policies", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_connector_id: connectorId,
    });
    const outcome = this.outcome(row, new Set(["found", "not_found"]));
    this.assertFound(outcome);
    return (row.policies as unknown[]) ?? [];
  }

  // --- Identity mapping ------------------------------------------------------

  async linkExternalIdentity(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("link_external_identity_atomic", args);
    const outcome = this.outcome(
      row,
      new Set(["linked", "invalid_request", "not_found", "conflict"]),
    );
    this.assertFound(outcome);
    return row.mapping;
  }

  async unlinkExternalIdentity(
    organizationId: string,
    connectorId: string,
    mappingId: string,
    actorId: string,
    reason: string,
  ) {
    await this.assertExternalIdentity(organizationId, connectorId, mappingId);
    const row = await this.singleRpc("unlink_external_identity_atomic", {
      p_organization_id: organizationId,
      p_mapping_id: mappingId,
      p_actor_user_id: actorId,
      p_reason: reason,
    });
    const outcome = this.outcome(row, new Set(["unlinked", "not_found"]));
    this.assertFound(outcome);
    return outcome;
  }

  async mergeExternalIdentities(
    organizationId: string,
    connectorId: string,
    keepMappingId: string,
    mergeFromMappingId: string,
    actorId: string,
    reason: string,
  ) {
    await this.assertExternalIdentity(
      organizationId,
      connectorId,
      keepMappingId,
    );
    await this.assertExternalIdentity(
      organizationId,
      connectorId,
      mergeFromMappingId,
    );
    const row = await this.singleRpc("merge_external_identities_atomic", {
      p_organization_id: organizationId,
      p_keep_mapping_id: keepMappingId,
      p_merge_from_mapping_id: mergeFromMappingId,
      p_actor_user_id: actorId,
      p_reason: reason,
    });
    const outcome = this.outcome(row, new Set(["merged", "not_found"]));
    this.assertFound(outcome);
    return outcome;
  }

  async listExternalIdentities(
    orgId: string,
    connectorId: string,
    params: PageParams,
  ) {
    await this.getConnector(orgId, connectorId);
    const countResult = await this.supabase
      .admin()
      .from("product_external_identities")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .is("superseded_at", null);
    if (countResult.error) throw new ConnectorError("unavailable");
    const total = countResult.count ?? 0;
    const { from, to } = resolvePage(total, params);
    const { data, error } = await this.supabase
      .admin()
      .from("product_external_identities")
      .select("*")
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .is("superseded_at", null)
      .order("linked_at", { ascending: false })
      .range(from, to);
    if (error) throw new ConnectorError("unavailable");
    return paged((data ?? []).map(mapExternalIdentityRow), total, params);
  }

  private async assertExternalIdentity(
    organizationId: string,
    connectorId: string,
    mappingId: string,
  ): Promise<void> {
    const { data, error } = await this.supabase
      .admin()
      .from("product_external_identities")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("connector_id", connectorId)
      .eq("id", mappingId)
      .maybeSingle();
    if (error) throw new ConnectorError("unavailable");
    if (!data) throw new ConnectorError("not_found");
  }

  // --- Sync runs ---------------------------------------------------------------

  async beginSyncRun(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("begin_sync_run_atomic", args);
    const outcome = this.outcome(
      row,
      new Set([
        "queued",
        "already_running",
        "invalid_request",
        "not_found",
        "idempotency_mismatch",
      ]),
    );
    if (outcome === "already_running")
      throw new ConnectorError("already_running");
    if (outcome === "idempotency_mismatch")
      throw new ConnectorError("idempotency_mismatch");
    this.assertFound(outcome);
    return row.run;
  }

  async requestSyncRunCommit(
    organizationId: string,
    connectorId: string,
    syncRunId: string,
    actorId: string,
    expectedRowCount: number | null,
  ) {
    await this.getSyncRun(organizationId, connectorId, syncRunId);
    const row = await this.singleRpc("request_sync_run_commit_atomic", {
      p_organization_id: organizationId,
      p_sync_run_id: syncRunId,
      p_actor_user_id: actorId,
      p_expected_row_count: expectedRowCount,
    });
    const outcome = this.outcome(
      row,
      new Set([
        "queued",
        "not_found",
        "dry_run_expired",
        "stale_preview",
        "blocked_by_conflicts",
      ]),
    );
    if (outcome === "dry_run_expired")
      throw new ConnectorError("dry_run_expired");
    if (outcome === "stale_preview") throw new ConnectorError("stale_preview");
    if (outcome === "blocked_by_conflicts")
      throw new ConnectorError("blocked_by_conflicts");
    this.assertFound(outcome);
    return row.run;
  }

  async cancelSyncRun(
    organizationId: string,
    connectorId: string,
    syncRunId: string,
    actorId: string,
    reason: string | null,
  ) {
    await this.getSyncRun(organizationId, connectorId, syncRunId);
    const row = await this.singleRpc("cancel_sync_run_atomic", {
      p_organization_id: organizationId,
      p_sync_run_id: syncRunId,
      p_actor_user_id: actorId,
      p_reason: reason,
    });
    const outcome = this.outcome(row, new Set(["canceled", "not_found"]));
    this.assertFound(outcome);
    return row.run;
  }

  async retrySyncRun(
    organizationId: string,
    connectorId: string,
    syncRunId: string,
    actorId: string,
  ) {
    await this.getSyncRun(organizationId, connectorId, syncRunId);
    const row = await this.singleRpc("retry_sync_run_atomic", {
      p_organization_id: organizationId,
      p_sync_run_id: syncRunId,
      p_actor_user_id: actorId,
    });
    const outcome = this.outcome(
      row,
      new Set(["queued", "not_found", "invalid_state"]),
    );
    if (outcome === "invalid_state") throw new ConnectorError("invalid_state");
    this.assertFound(outcome);
    return row.run;
  }

  async getSyncRun(orgId: string, connectorId: string, syncRunId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from("sync_runs")
      .select("*")
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("id", syncRunId)
      .maybeSingle();
    if (error) throw new ConnectorError("unavailable");
    if (!data) throw new ConnectorError("not_found");
    return mapSyncRunRow(data);
  }

  async listSyncRuns(
    orgId: string,
    connectorId: string,
    params: PageParams,
    status?: string,
  ) {
    await this.getConnector(orgId, connectorId);
    let countQuery = this.supabase
      .admin()
      .from("sync_runs")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId);
    if (status) countQuery = countQuery.eq("status", status);
    const countResult = await countQuery;
    if (countResult.error) throw new ConnectorError("unavailable");
    const total = countResult.count ?? 0;
    const { from, to } = resolvePage(total, params);
    let rowsQuery = this.supabase
      .admin()
      .from("sync_runs")
      .select("*")
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId);
    if (status) rowsQuery = rowsQuery.eq("status", status);
    const { data, error } = await rowsQuery
      .order("created_at", { ascending: false })
      .range(from, to);
    if (error) throw new ConnectorError("unavailable");
    return paged((data ?? []).map(mapSyncRunRow), total, params);
  }

  async listSyncRunPlanItems(
    orgId: string,
    connectorId: string,
    syncRunId: string,
    params: PageParams,
  ) {
    await this.getSyncRun(orgId, connectorId, syncRunId);
    const countResult = await this.supabase
      .admin()
      .from("sync_run_plan_items")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("sync_run_id", syncRunId);
    if (countResult.error) throw new ConnectorError("unavailable");
    const total = countResult.count ?? 0;
    const { from, to } = resolvePage(total, params);
    const { data, error } = await this.supabase
      .admin()
      .from("sync_run_plan_items")
      .select("*")
      .eq("organization_id", orgId)
      .eq("sync_run_id", syncRunId)
      .order("created_at", { ascending: true })
      .range(from, to);
    if (error) throw new ConnectorError("unavailable");
    return paged((data ?? []).map(mapSyncRunPlanItemRow), total, params);
  }

  // --- Conflicts -----------------------------------------------------------

  async listConflictsForRun(
    orgId: string,
    connectorId: string,
    syncRunId: string,
  ) {
    await this.getSyncRun(orgId, connectorId, syncRunId);
    const { data, error } = await this.supabase
      .admin()
      .from("sync_conflicts")
      .select("*")
      .eq("organization_id", orgId)
      .eq("sync_run_id", syncRunId)
      .order("detected_at", { ascending: false })
      .limit(500);
    if (error) throw new ConnectorError("unavailable");
    return (data ?? []).map(mapSyncConflictRow);
  }

  async getConflict(orgId: string, conflictId: string) {
    const { data, error } = await this.supabase
      .admin()
      .from("sync_conflicts")
      .select("*")
      .eq("organization_id", orgId)
      .eq("id", conflictId)
      .maybeSingle();
    if (error) throw new ConnectorError("unavailable");
    if (!data) throw new ConnectorError("not_found");
    return mapSyncConflictRow(data);
  }

  async resolveConflict(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("resolve_sync_conflict_atomic", args);
    const outcome = this.outcome(
      row,
      new Set([
        "resolved",
        "not_found",
        "conflict",
        "invalid_state",
        "forbidden_by_policy",
      ]),
    );
    if (outcome === "invalid_state") throw new ConnectorError("invalid_state");
    if (outcome === "forbidden_by_policy")
      throw new ConnectorError("forbidden_by_policy");
    this.assertFound(outcome);
    return row.conflict;
  }

  async listDeadLetters(
    organizationId: string,
    connectorId: string,
    params: PageParams,
  ) {
    return this.listSyncRuns(organizationId, connectorId, params, "failed");
  }

  // --- Metrics ---------------------------------------------------------------

  async metricsSnapshot(organizationId: string) {
    const row = await this.singleRpc("connector_compliance_metrics_snapshot", {
      p_organization_id: organizationId,
    });
    return mapMetricsRow(row);
  }

  /**
   * Safe diagnostic surface: all values are derived operational metadata.
   * It deliberately omits connection config, secret references, provider
   * payloads, identity labels, and product data.
   */
  async diagnosticsExport(orgId: string, connectorId: string) {
    const connector = await this.getConnector(orgId, connectorId);
    const client = this.supabase.admin();
    const [
      cursorResult,
      latestRunResult,
      policyCountResult,
      conflictCountResult,
      deadLetterCountResult,
      retryCountResult,
    ] = await Promise.all([
      client
        .from("sync_connector_cursors")
        .select("cursor_issued_at, last_committed_at, circuit_state")
        .eq("organization_id", orgId)
        .eq("connector_id", connectorId)
        .maybeSingle(),
      client
        .from("sync_runs")
        .select("id, status, error_code, committed_at")
        .eq("organization_id", orgId)
        .eq("connector_id", connectorId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      client
        .from("field_authority_policies")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("connector_id", connectorId)
        .is("superseded_at", null),
      client
        .from("sync_conflicts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("connector_id", connectorId)
        .eq("resolution_status", "open"),
      client
        .from("sync_runs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("connector_id", connectorId)
        .eq("status", "failed"),
      client
        .from("sync_runs")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("connector_id", connectorId)
        .gt("retry_count", 0),
    ]);
    const results = [
      cursorResult,
      latestRunResult,
      policyCountResult,
      conflictCountResult,
      deadLetterCountResult,
      retryCountResult,
    ];
    if (results.some((result) => result.error))
      throw new ConnectorError("unavailable");

    const cursor = cursorResult.data;
    const latestRun = latestRunResult.data;
    const cursorAgeSeconds = cursor?.cursor_issued_at
      ? Math.max(
          0,
          Math.floor((Date.now() - Date.parse(cursor.cursor_issued_at)) / 1000),
        )
      : null;
    const openConflicts = conflictCountResult.count ?? 0;
    const status = diagnosticStatus({
      hasSecret: connector.hasSecret === true,
      policyCount: policyCountResult.count ?? 0,
      circuitState: cursor?.circuit_state ?? "closed",
      latestRunStatus: latestRun?.status ?? null,
      latestErrorCode: latestRun?.error_code ?? null,
      openConflicts,
      cursorAgeSeconds,
    });
    const slug = String(connector.displayName)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);

    return {
      filename: `connector-diagnostic-${slug || "connector"}.json`,
      report: {
        generatedAt: new Date().toISOString(),
        connectorId,
        connectorStatus: status,
        cursorAgeSeconds,
        latestRun: latestRun
          ? {
              id: latestRun.id,
              status: latestRun.status,
              errorCode: latestRun.error_code,
              completedAt: toUtcZ(latestRun.committed_at),
            }
          : null,
        counts: {
          openConflicts,
          deadLetters: deadLetterCountResult.count ?? 0,
          retries: retryCountResult.count ?? 0,
        },
      },
    };
  }

  // --- Worker-facing (not org-request scoped, called by the worker loop) -----

  async listDueSyncRunOrganizations(limit: number) {
    let result: RpcResult;
    try {
      result = await this.client().rpc("list_due_sync_run_organizations", {
        p_limit: limit,
      });
    } catch {
      throw new ConnectorError("unavailable");
    }
    if (result.error || !Array.isArray(result.data))
      throw new ConnectorError("unavailable");
    return result.data as readonly Row[];
  }

  async claimSyncRun(
    organizationId: string,
    workerId: string,
    leaseSeconds: number,
  ) {
    const row = await this.singleRpc("claim_sync_run", {
      p_organization_id: organizationId,
      p_worker_id: workerId,
      p_lease_seconds: leaseSeconds,
    });
    return this.outcome(
      row,
      new Set([
        "claimed",
        "not_found",
        "connector_disabled",
        "invalid_request",
      ]),
    ) === "claimed"
      ? row.run
      : null;
  }

  async saveSyncRunPlan(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("save_sync_run_plan_atomic", args);
    const outcome = this.outcome(
      row,
      new Set(["saved", "not_found", "invalid_request"]),
    );
    this.assertFound(outcome);
    return row.run;
  }

  async commitSyncRun(args: Readonly<Record<string, unknown>>) {
    const row = await this.singleRpc("commit_sync_run_atomic", args);
    return row; // caller inspects `outcome` directly -- several non-error outcomes are valid states here
  }

  async failSyncRun(
    organizationId: string,
    syncRunId: string,
    workerId: string,
    errorCode: string,
  ) {
    const row = await this.singleRpc("fail_sync_run_atomic", {
      p_organization_id: organizationId,
      p_sync_run_id: syncRunId,
      p_worker_id: workerId,
      p_error_code: errorCode,
    });
    return row;
  }

  async resolveWorkerActor(organizationId: string): Promise<string | null> {
    let result: RpcResult;
    try {
      result = await this.client().rpc("resolve_connector_sync_worker_actor", {
        p_organization_id: organizationId,
      });
    } catch {
      throw new ConnectorError("unavailable");
    }
    if (result.error) throw new ConnectorError("unavailable");
    return (result.data as string | null) ?? null;
  }
}

function diagnosticStatus(
  input: Readonly<{
    hasSecret: boolean;
    policyCount: number;
    circuitState: string;
    latestRunStatus: string | null;
    latestErrorCode: string | null;
    openConflicts: number;
    cursorAgeSeconds: number | null;
  }>,
):
  | "disconnected"
  | "testing"
  | "unauthorized"
  | "mapping_incomplete"
  | "dry_run"
  | "conflicts_present"
  | "waiting_for_review"
  | "syncing"
  | "stale"
  | "rate_limited"
  | "retrying"
  | "partial_provider_outage"
  | "failed"
  | "canceled"
  | "completed" {
  if (!input.hasSecret) return "disconnected";
  if (input.latestErrorCode === "auth_failed") return "unauthorized";
  // Product fields (including parentExternalId) plus release fields must all
  // have explicit authority before diagnostics can call a mapping complete.
  if (input.policyCount < 8) return "mapping_incomplete";
  if (input.circuitState === "open") return "partial_provider_outage";
  if (input.openConflicts > 0) return "conflicts_present";
  switch (input.latestRunStatus) {
    case "queued":
    case "running":
      return "syncing";
    case "waiting_for_review":
      return "waiting_for_review";
    case "retrying":
      return input.latestErrorCode === "rate_limited"
        ? "rate_limited"
        : "retrying";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    case "completed":
      return input.cursorAgeSeconds !== null && input.cursorAgeSeconds > 86_400
        ? "stale"
        : "completed";
    default:
      return "dry_run";
  }
}

/** Postgres always serializes timestamptz as UTC; normalize the `+00:00`
 * offset PostgREST emits into the `Z` suffix every response schema requires. */
function toUtcZ(value: unknown): string | null {
  return value === null || value === undefined
    ? null
    : new Date(value as string).toISOString();
}

/** Hand-mapped snake_case -> camelCase for the 5 direct-select entities.
 * Mirrors the exact shape of the matching m2_v2_*_json() SQL envelope
 * builder (or, for plan items, the deliberately-narrow syncRunPlanItemSchema)
 * so direct reads and RPC-mutation responses never drift apart. */
function mapConnectorRow(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorType: row.connector_type,
    displayName: row.display_name,
    adapterVersion: row.adapter_version,
    mappingVersion: row.mapping_version,
    connectionConfig: row.connection_config,
    hasSecret: row.secret_ref !== null,
    commitPolicy: row.commit_policy,
    enabled: row.enabled,
    lastTestedAt: toUtcZ(row.last_tested_at),
    lastTestOutcome: row.last_test_outcome,
    lastTestErrorCode: row.last_test_error_code,
    archivedAt: toUtcZ(row.archived_at),
    version: row.version,
    createdAt: toUtcZ(row.created_at),
    createdBy: row.created_by,
    updatedAt: toUtcZ(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function mapExternalIdentityRow(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorId: row.connector_id,
    entityType: row.entity_type,
    externalId: row.external_id,
    externalDisplayLabel: row.external_display_label,
    craProductId: row.cra_product_id,
    craReleaseId: row.cra_release_id,
    matchMethod: row.match_method,
    matchConfidence: row.match_confidence,
    linkedAt: toUtcZ(row.linked_at),
    linkedBy: row.linked_by,
    unlinkedAt: toUtcZ(row.unlinked_at),
    unlinkedBy: row.unlinked_by,
    unlinkReason: row.unlink_reason,
    version: row.version,
    createdAt: toUtcZ(row.created_at),
    createdBy: row.created_by,
    updatedAt: toUtcZ(row.updated_at),
    updatedBy: row.updated_by,
  };
}

function mapSyncRunRow(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorId: row.connector_id,
    reconciliationKind: row.reconciliation_kind,
    workKind: row.work_kind,
    status: row.status,
    adapterVersion: row.adapter_version,
    mappingVersion: row.mapping_version,
    cursorFrom: row.cursor_from,
    cursorTo: row.cursor_to,
    fetchContentHash: row.fetch_content_hash,
    planBasisDigest: row.plan_basis_digest,
    rowCount: row.row_count,
    counts: {
      create: row.create_count,
      update: row.update_count,
      unchanged: row.unchanged_count,
      skip: row.skip_count,
      conflict: row.conflict_count,
      tombstone: row.tombstone_count,
      cycleBlocked: row.cycle_blocked_count,
    },
    estimatedGraphImpact: row.estimated_graph_impact,
    retryCount: row.retry_count,
    errorCode: row.error_code,
    correlationId: row.correlation_id,
    expiresAt: toUtcZ(row.expires_at),
    committedAt: toUtcZ(row.committed_at),
    canceledAt: toUtcZ(row.canceled_at),
    createdAt: toUtcZ(row.created_at),
    updatedAt: toUtcZ(row.updated_at),
  };
}

/** Only the 5 fields syncRunPlanItemSchema exposes -- the persisted row also
 * carries id/syncRunId/craProductId/craReleaseId/expectedVersion/appliedAt,
 * which commit replays internally in SQL and callers never need to see. */
function mapSyncRunPlanItemRow(row: Row): Record<string, unknown> {
  return {
    externalId: row.external_id,
    entityType: row.entity_type,
    proposedAction: row.proposed_action,
    fieldDiffs: row.field_diffs,
    issues: row.issues,
  };
}

function mapSyncConflictRow(row: Row): Record<string, unknown> {
  return {
    id: row.id,
    organizationId: row.organization_id,
    connectorId: row.connector_id,
    syncRunId: row.sync_run_id,
    externalIdentityId: row.external_identity_id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    fieldPath: row.field_path,
    conflictKind: row.conflict_kind,
    craValue: row.cra_value,
    craValueSource: row.cra_value_source,
    craValueObservedAt: toUtcZ(row.cra_value_observed_at),
    externalValue: row.external_value,
    externalValueObservedAt: toUtcZ(row.external_value_observed_at),
    detectedAt: toUtcZ(row.detected_at),
    authorityPolicyId: row.authority_policy_id,
    permittedActions: row.permitted_actions,
    resolutionStatus: row.resolution_status,
    resolutionChosenAction: row.resolution_chosen_action,
    resolutionValue: row.resolution_value,
    resolutionReason: row.resolution_reason,
    resolvedBy: row.resolved_by,
    resolvedAt: toUtcZ(row.resolved_at),
    version: row.version,
  };
}

function mapMetricsRow(row: Row): Record<string, unknown> {
  return {
    connectorCount: Number(row.connector_count),
    connectorDeadLetterCount: Number(row.connector_dead_letter_count),
    connectorOpenConflictCount: Number(row.connector_open_conflict_count),
    connectorRetryCount: Number(row.connector_retry_count),
    connectorStaleCount: Number(row.connector_stale_count),
    connectorCircuitOpenCount: Number(row.connector_circuit_open_count),
  };
}
