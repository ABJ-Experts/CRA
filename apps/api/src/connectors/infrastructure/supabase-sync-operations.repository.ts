import { z } from "zod";
import {
  connectorFieldMapSchema,
  syncRunSchema,
  syncRunHistorySchema,
  syncRunAttemptSchema,
  syncRecordOutcomeSchema,
  replaySyncRunPreviewSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  SaveConnectorFieldMappingInput,
  SyncHistoryQuery,
  ReplaySyncRunPreviewInput,
  ReplaySyncRunInput,
  SyncRunHistory,
  SyncRunAttempt,
  SyncRecordOutcome,
} from "@repo/contracts/connectors/types";
import type { Paged } from "@repo/contracts/pagination";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { ConnectorAuthorization } from "../application/connector-authorization.port";
import type { ConnectorRequestFingerprint } from "../application/connector-vault.port";
import type { ConnectorSyncOperationsRepository } from "../application/connector-sync-operations.port";
import {
  ConnectorError,
  type ConnectorErrorCode,
} from "../application/connector-errors";
type Result = { data: unknown; error: unknown; count?: number | null };
interface Query extends PromiseLike<Result> {
  select(columns: string, options?: { count: "exact" }): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  not(column: string, operator: string, value: unknown): Query;
  order(column: string, options?: { ascending: boolean }): Query;
  range(from: number, to: number): Query;
  maybeSingle(): Promise<Result>;
}
interface Client {
  from(table: string): Query;
  rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<Result>;
}
type Row = Record<string, unknown>;
const rowSchema = z.record(z.string(), z.unknown());
const rowsSchema = z.array(rowSchema);
const runColumns =
  "id,organization_id,connector_id,reconciliation_kind,work_kind,status,adapter_version,mapping_version,cursor_from,cursor_to,fetch_content_hash,plan_basis_digest,row_count,create_count,update_count,unchanged_count,skip_count,conflict_count,tombstone_count,cycle_blocked_count,estimated_graph_impact,retry_count,error_code,correlation_id,expires_at,committed_at,canceled_at,created_at,updated_at,started_at,finished_at,version,field_mapping_revision,replay_parent_run_id,succeeded_count,skipped_count,failed_count,pending_count,next_attempt_at";
const recordColumns =
  "id,sync_run_id,external_id,entity_type,proposed_action,record_outcome,error_category,error_code,dead_lettered_at,applied_at";
const commandCodes: Record<string, ConnectorErrorCode> = {
  forbidden: "forbidden_by_policy",
  not_found: "not_found",
  conflict: "conflict",
  stale_preview: "stale_preview",
  invalid_request: "invalid_request",
  invalid_state: "invalid_state",
  already_running: "already_running",
  idempotency_conflict: "idempotency_mismatch",
};

const safeCodes = new Set([
  "timeout",
  "rate_limited",
  "provider_unavailable",
  "unreachable",
  "auth_failed",
  "missing_scope",
  "malformed_response",
  "unsupported_capability",
  "unsupported_version",
  "payload_too_large",
  "vault_unavailable",
  "unknown",
  "interrupted",
  "invalid_data",
  "invalid_value",
  "missing_required",
  "unknown_source",
  "protected_target",
  "incompatible_type",
  "duplicate_target",
  "sensitive_source",
  "cursor_expired",
  "cursor_invalid",
  "stale_preview",
  "permission_changed",
  "authorization_changed",
  "connection_changed",
  "record_invalid",
  "retry_deadline_exceeded",
  "database_unavailable",
  "transient_database",
  "blocked_by_conflicts",
  "constraint_violation",
  "commit_failed",
  "plan_invalid",
  "commit_apply_failed",
  "invalid_record",
  "configuration_changed",
  "legacy_plan_requires_review",
  "lease_expired",
  "mapping_changed",
  "cursor_changed",
]);
const safeCode = (value: unknown) =>
  typeof value === "string" ? (safeCodes.has(value) ? value : "unknown") : null;
const date = (value: unknown) =>
  typeof value === "string" ? new Date(value).toISOString() : null;
function page<T>(rows: T[], total: number, query: SyncHistoryQuery): Paged<T> {
  return {
    rows,
    total,
    page: query.page,
    pageSize: query.pageSize,
    pageCount: Math.max(1, Math.ceil(total / query.pageSize)),
  };
}
function run(row: Row) {
  return syncRunSchema.parse({
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
    errorCode: safeCode(row.error_code),
    correlationId: row.correlation_id,
    expiresAt: date(row.expires_at),
    committedAt: date(row.committed_at),
    canceledAt: date(row.canceled_at),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  });
}
function history(row: Row): SyncRunHistory {
  return syncRunHistorySchema.parse({
    run: run(row),
    startedAt: date(row.started_at),
    finishedAt: date(row.finished_at),
    version: row.version,
    fieldMappingRevision: row.field_mapping_revision,
    replayOfRunId: row.replay_parent_run_id,
    counts: {
      succeeded: row.succeeded_count,
      skipped: row.skipped_count,
      failed: row.failed_count,
      pending: row.pending_count,
    },
    retryAt: date(row.next_attempt_at),
  });
}
function record(row: Row): SyncRecordOutcome {
  return syncRecordOutcomeSchema.parse({
    id: row.id,
    runId: row.sync_run_id,
    externalId: row.external_id,
    entityType: row.entity_type,
    proposedAction: row.proposed_action,
    outcome: row.record_outcome,
    errorCategory: row.error_category,
    errorCode: safeCode(row.error_code),
    deadLetteredAt: date(row.dead_lettered_at),
    appliedAt: date(row.applied_at),
  });
}
function attempt(row: Row): SyncRunAttempt {
  return syncRunAttemptSchema.parse({
    id: row.id,
    runId: row.sync_run_id,
    generation: row.lease_generation,
    phase: row.phase,
    startedAt: date(row.started_at),
    finishedAt: date(row.finished_at),
    outcome: row.outcome ?? "running",
    errorCategory: row.error_category,
    errorCode: safeCode(row.error_code),
    nextAttemptAt: date(row.next_attempt_at),
    recordIds: row.affected_record_ids ?? [],
  });
}
/** Every read is explicitly organization scoped; SQL owns mutation/audit transactions. */
export class SupabaseSyncOperationsRepository implements ConnectorSyncOperationsRepository {
  constructor(private readonly supabase: SupabaseService) {}
  private client(): Client {
    return this.supabase.admin() as unknown as Client;
  }
  async currentMapping(orgId: string, connectorId: string) {
    const result = await this.client()
      .from("connectors")
      .select("field_mapping_revision,field_map")
      .eq("organization_id", orgId)
      .eq("id", connectorId)
      .is("archived_at", null)
      .maybeSingle();
    if (result.error) throw new ConnectorError("unavailable");
    if (!result.data) throw new ConnectorError("not_found");
    const row = this.row(result.data);
    return connectorFieldMapSchema.parse({
      revision: row.field_mapping_revision,
      fields: row.field_map,
    });
  }
  async saveMapping(
    orgId: string,
    connectorId: string,
    authorization: ConnectorAuthorization,
    input: SaveConnectorFieldMappingInput,
    fingerprint: ConnectorRequestFingerprint,
  ) {
    const result = await this.rpc(orgId, "m1102_save_field_mapping", {
      ...this.auth(orgId, connectorId, authorization),
      p_expected_version: input.expectedVersion,
      p_expected_mapping_revision: input.expectedMappingRevision,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: fingerprint.digest,
      p_request_digest_key_id: fingerprint.keyId,
      p_schema_digest: input.schemaDigest,
      p_fields: input.fields,
    });
    return connectorFieldMapSchema.parse(result);
  }
  async history(orgId: string, connectorId: string, query: SyncHistoryQuery) {
    await this.currentMapping(orgId, connectorId);
    const result = await this.client()
      .from("sync_runs")
      .select(runColumns, { count: "exact" })
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .range(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize - 1,
      );
    return page(this.rows(result).map(history), result.count ?? 0, query);
  }
  async detail(
    orgId: string,
    connectorId: string,
    runId: string,
    query: SyncHistoryQuery,
  ) {
    const runResult = await this.client()
      .from("sync_runs")
      .select(runColumns)
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("id", runId)
      .maybeSingle();
    if (runResult.error) throw new ConnectorError("unavailable");
    if (!runResult.data) throw new ConnectorError("not_found");
    const [attemptResult, recordResult] = await Promise.all([
      this.client()
        .from("sync_run_attempts")
        .select(
          "id,sync_run_id,lease_generation,phase,started_at,finished_at,outcome,error_category,error_code,next_attempt_at,affected_record_ids",
          { count: "exact" },
        )
        .eq("organization_id", orgId)
        .eq("sync_run_id", runId)
        .order("lease_generation", { ascending: false })
        .range(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize - 1,
        ),
      this.client()
        .from("sync_run_plan_items")
        .select(recordColumns, { count: "exact" })
        .eq("organization_id", orgId)
        .eq("sync_run_id", runId)
        .order("id", { ascending: true })
        .range(
          (query.page - 1) * query.pageSize,
          query.page * query.pageSize - 1,
        ),
    ]);
    return {
      run: history(this.row(runResult.data)),
      attempts: page(
        this.rows(attemptResult).map(attempt),
        attemptResult.count ?? 0,
        query,
      ),
      records: page(
        this.rows(recordResult).map(record),
        recordResult.count ?? 0,
        query,
      ),
    };
  }
  async deadLetters(
    orgId: string,
    connectorId: string,
    query: SyncHistoryQuery,
  ) {
    await this.currentMapping(orgId, connectorId);
    const result = await this.client()
      .from("sync_run_plan_items")
      .select(`${recordColumns},sync_runs!inner(connector_id)`, {
        count: "exact",
      })
      .eq("organization_id", orgId)
      .eq("sync_runs.organization_id", orgId)
      .eq("sync_runs.connector_id", connectorId)
      .not("dead_lettered_at", "is", null)
      .is("dead_letter_resolved_at", null)
      .order("dead_lettered_at", { ascending: false })
      .order("id", { ascending: false })
      .range(
        (query.page - 1) * query.pageSize,
        query.page * query.pageSize - 1,
      );
    return page(this.rows(result).map(record), result.count ?? 0, query);
  }
  async replayPreview(
    orgId: string,
    connectorId: string,
    runId: string,
    authorization: ConnectorAuthorization,
    input: ReplaySyncRunPreviewInput,
  ) {
    const result = await this.rpc(orgId, "m1102_replay_preview", {
      ...this.auth(orgId, connectorId, authorization),
      p_run_id: runId,
      p_expected_version: input.expectedVersion,
      p_mapping_mode: input.mappingMode,
      p_source_mode: input.sourceMode,
    });
    return replaySyncRunPreviewSchema.parse(result);
  }
  async replay(
    orgId: string,
    connectorId: string,
    runId: string,
    authorization: ConnectorAuthorization,
    input: ReplaySyncRunInput,
    fingerprint: ConnectorRequestFingerprint,
  ) {
    const result = await this.rpc(orgId, "m1102_replay_sync_run", {
      ...this.auth(orgId, connectorId, authorization),
      p_run_id: runId,
      p_expected_version: input.expectedVersion,
      p_mapping_mode: input.mappingMode,
      p_source_mode: input.sourceMode,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: fingerprint.digest,
      p_request_digest_key_id: fingerprint.keyId,
      p_preview_digest: input.previewDigest,
      p_reason: input.reason,
    });
    return syncRunSchema.parse(result.run);
  }
  private auth(
    orgId: string,
    connectorId: string,
    authorization: ConnectorAuthorization,
  ) {
    if (authorization.organizationId !== orgId)
      throw new ConnectorError("not_found");
    return {
      p_org_id: orgId,
      p_connector_id: connectorId,
      p_actor_id: authorization.actorId,
      p_permission_version: authorization.permissionVersion,
    };
  }
  private rows(result: Result): Row[] {
    if (result.error) throw new ConnectorError("unavailable");
    const parsed = rowsSchema.safeParse(result.data);
    if (!parsed.success) throw new ConnectorError("unavailable");
    return parsed.data;
  }
  private row(value: unknown): Row {
    const parsed = rowSchema.safeParse(value);
    if (!parsed.success) throw new ConnectorError("unavailable");
    return parsed.data;
  }
  private async rpc(
    orgId: string,
    name: string,
    input: Readonly<Record<string, unknown>>,
  ) {
    let response: Result;
    try {
      response = await this.client().rpc(name, { ...input, p_org_id: orgId });
    } catch {
      throw new ConnectorError("unavailable");
    }
    if (response.error) {
      const signal = z
        .object({ code: z.literal("P0001"), message: z.string() })
        .safeParse(response.error);
      throw new ConnectorError(
        signal.success
          ? (commandCodes[signal.data.message] ?? "unavailable")
          : "unavailable",
      );
    }
    const value: unknown = Array.isArray(response.data)
      ? response.data[0]
      : response.data;
    const row = this.row(value);
    if (
      typeof row.outcome === "string" &&
      !["created", "updated", "replayed", "queued"].includes(row.outcome)
    ) {
      throw new ConnectorError(commandCodes[row.outcome] ?? "unavailable");
    }
    return row;
  }
}
