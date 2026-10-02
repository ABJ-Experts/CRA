import {
  connectorOverviewSchema,
  connectorSchema,
  syncRunSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  Connector,
  ConnectorOverview,
} from "@repo/contracts/connectors/types";
import type { PageParams } from "@repo/contracts/pagination";
import { z } from "zod";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { ConnectorAuthorization } from "../application/connector-authorization.port";
import { CONNECTOR_SCOPE_POLICY_VERSION } from "../application/connector-catalogue";
import { ConnectorError } from "../application/connector-errors";
import type {
  ConnectorCommand,
  ConnectorCommandRequest,
  ConnectorHubContext,
  ConnectorHubRepository,
  ConnectorSafeTestResult,
} from "../application/connector-hub-repository.port";
import {
  compareConnectorScopes,
  safeConnectorTestDiagnostic,
} from "../application/connector-scope-policy";
import type { ConnectorSecretEnvelope } from "../application/connector-vault.port";
import type { SupabaseConnectorRepository } from "./supabase-connector.repository";

type Result = Readonly<{ data: unknown; error: unknown }>;
interface Query extends PromiseLike<Result> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  maybeSingle(): Promise<Result>;
}
interface Client {
  from(table: string): Query;
  rpc(name: string, args: Readonly<Record<string, unknown>>): Promise<Result>;
}
const commandSchema = z.object({
  id: z.string().uuid(),
  operation: z.string(),
  state: z.enum(["running", "completed", "interrupted"]),
  connectionRevision: z.number().int().nonnegative(),
  credentialRevision: z.number().int().nonnegative(),
  permissionVersion: z.number().int().positive(),
  requestDigestKeyId: z.string(),
  deadlineAt: z.string().nullable(),
  result: z.unknown(),
});
const rowSchema = z.record(z.string(), z.unknown());
const epochSchema = z.object({ version: z.number().int().positive() });
const actorSchema = z.object({
  role: z.enum(["owner", "admin", "member", "viewer"]),
  users: z.object({ is_active: z.literal(true) }),
  organizations: z.object({ is_active: z.literal(true) }),
});

/** Service-role boundary: every tenant operation is org-first and explicitly scoped. */
export class SupabaseConnectorHubRepository implements ConnectorHubRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly legacy: SupabaseConnectorRepository,
  ) {}
  private client(): Client {
    return this.supabase.admin() as unknown as Client;
  }
  private parsedRow(value: unknown): Record<string, unknown> {
    const parsed = rowSchema.safeParse(value);
    if (!parsed.success) throw new ConnectorError("unavailable");
    return parsed.data;
  }

  async permissionVersion(orgId: string): Promise<number> {
    const { data, error } = await this.client()
      .from("organization_permissions_version")
      .select("version")
      .eq("organization_id", orgId)
      .maybeSingle();
    const parsed = epochSchema.safeParse(data);
    if (error || !parsed.success) throw new ConnectorError("unavailable");
    return parsed.data.version;
  }
  async actor(orgId: string, actorId: string) {
    const { data, error } = await this.client()
      .from("organization_members")
      .select("role,users!inner(is_active),organizations!inner(is_active)")
      .eq("organization_id", orgId)
      .eq("user_id", actorId)
      .maybeSingle();
    const parsed = actorSchema.safeParse(data);
    if (error) throw new ConnectorError("unavailable");
    if (!parsed.success) throw new ConnectorError("not_found");
    return Object.freeze({ role: parsed.data.role });
  }

  async context(
    orgId: string,
    connectorId: string,
  ): Promise<ConnectorHubContext> {
    const connector = connectorSchema.parse(
      await this.legacy.getConnector(orgId, connectorId),
    );
    const { data, error } = await this.client()
      .from("connectors")
      .select("connection_revision,credential_revision,secret_ref")
      .eq("organization_id", orgId)
      .eq("id", connectorId)
      .is("archived_at", null)
      .maybeSingle();
    if (error || !data) throw new ConnectorError("not_found");
    const row = this.parsedRow(data);
    const connectionRevision = integer(row.connection_revision);
    const credentialRevision = integer(row.credential_revision);
    if (!row.secret_ref)
      return {
        connector,
        connectionRevision,
        credentialRevision,
        secret: null,
      };
    const secretResult = await this.client()
      .from("connector_secrets")
      .select(
        "id,encryption_scheme,key_id,nonce,auth_tag,ciphertext,credential_revision,revoked_at",
      )
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("id", row.secret_ref)
      .maybeSingle();
    if (secretResult.error) throw new ConnectorError("unavailable");
    if (!secretResult.data)
      return {
        connector,
        connectionRevision,
        credentialRevision,
        secret: null,
      };
    const secret = this.parsedRow(secretResult.data);
    if (secret.revoked_at)
      return {
        connector,
        connectionRevision,
        credentialRevision,
        secret: null,
      };
    const scheme = z
      .enum(["legacy_pgp", "aes_256_gcm_v1"])
      .safeParse(secret.encryption_scheme);
    if (!scheme.success) throw new ConnectorError("unavailable");
    const legacy = scheme.data === "legacy_pgp";
    const envelope: ConnectorSecretEnvelope | null = legacy
      ? null
      : {
          format: "aes-256-gcm-v1",
          keyId: string(secret.key_id),
          nonce: byteaBase64(secret.nonce),
          authTag: byteaBase64(secret.auth_tag),
          ciphertext: byteaBase64(secret.ciphertext),
        };
    return {
      connector,
      connectionRevision,
      credentialRevision,
      secret: {
        secretId: string(secret.id),
        credentialRevision: integer(secret.credential_revision),
        envelope,
        legacy,
        ...(legacy
          ? { legacyCiphertextBase64: byteaBase64(secret.ciphertext) }
          : {}),
      },
    };
  }

  async command(
    orgId: string,
    connectorId: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<ConnectorCommand | null> {
    const { data, error } = await this.client()
      .from("connector_commands")
      .select("*")
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("actor_user_id", actorId)
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();
    if (error) throw new ConnectorError("unavailable");
    if (!data) return null;
    const row = this.parsedRow(data);
    return commandSchema.parse({
      id: row.id,
      operation: row.operation,
      state: row.state,
      connectionRevision: row.connection_revision,
      credentialRevision: row.credential_revision,
      permissionVersion: row.permission_version,
      requestDigestKeyId: row.request_digest_key_id,
      deadlineAt: row.deadline_at,
      result: row.result,
    });
  }

  async execute(
    orgId: string,
    request: ConnectorCommandRequest,
  ): Promise<Connector> {
    const row = await this.rpc(
      orgId,
      "m11_execute_connector_command_atomic",
      args(request),
    );
    assertOutcome(row, ["updated", "replayed"]);
    return connectorSchema.parse(row.connector);
  }
  async beginTest(orgId: string, request: ConnectorCommandRequest) {
    const input = {
      p_connector_id: request.connectorId,
      p_actor_user_id: request.authorization.actorId,
      p_expected_version: request.expectedVersion,
      p_idempotency_key: request.idempotencyKey,
      p_request_digest: request.requestDigest,
      p_request_digest_key_id: request.requestDigestKeyId,
      p_permission_version: request.authorization.permissionVersion,
    };
    const row = await this.rpc(orgId, "m11_begin_connector_test_atomic", input);
    assertOutcome(row, ["started", "replayed"]);
    return {
      outcome: row.outcome as "started" | "replayed",
      connector: connectorSchema.parse(row.connector),
      command: commandSchema.parse(row.command),
    };
  }
  async finalizeTest(
    orgId: string,
    connectorId: string,
    command: ConnectorCommand,
    authorization: ConnectorAuthorization,
    result: ConnectorSafeTestResult,
  ) {
    if (authorization.organizationId !== orgId)
      throw new ConnectorError("not_found");
    // Verify the connector/command pair even though the atomic function scopes its own row.
    const commandResult = await this.client()
      .from("connector_commands")
      .select("id")
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("id", command.id)
      .maybeSingle();
    if (commandResult.error || !commandResult.data)
      throw new ConnectorError("not_found");
    const row = await this.rpc(orgId, "m11_finalize_connector_test_atomic", {
      p_command_id: command.id,
      p_actor_user_id: authorization.actorId,
      p_permission_version: authorization.permissionVersion,
      p_connection_revision: command.connectionRevision,
      p_credential_revision: command.credentialRevision,
      p_result: result,
    });
    assertOutcome(row, ["tested", "replayed"]);
    return connectorSchema.parse(row.connector);
  }
  async create(
    orgId: string,
    authorization: ConnectorAuthorization,
    input: Readonly<Record<string, unknown>>,
  ) {
    const row = await this.rpc(orgId, "m11_create_connector_atomic", {
      p_actor_user_id: authorization.actorId,
      p_permission_version: authorization.permissionVersion,
      p_idempotency_key: input.idempotencyKey,
      p_connector_type: input.connectorType,
      p_display_name: input.displayName,
      p_adapter_version: input.adapterVersion,
      p_mapping_version: input.mappingVersion,
      p_connection_config: input.connectionConfig ?? {},
      p_commit_policy: input.commitPolicy,
    });
    assertOutcome(row, ["created", "replayed"]);
    return connectorSchema.parse(row.connector);
  }
  async beginSync(
    orgId: string,
    authorization: ConnectorAuthorization,
    connectorId: string,
    reconciliationKind: string,
    idempotencyKey: string,
    correlationId: string,
  ) {
    const row = await this.rpc(orgId, "m11_begin_sync_run_atomic", {
      p_actor_user_id: authorization.actorId,
      p_permission_version: authorization.permissionVersion,
      p_connector_id: connectorId,
      p_reconciliation_kind: reconciliationKind,
      p_idempotency_key: idempotencyKey,
      p_correlation_id: correlationId,
    });
    assertOutcome(row, ["queued", "already_running"]);
    return syncRunSchema.parse(row.run);
  }
  async requestCommit(
    orgId: string,
    authorization: ConnectorAuthorization,
    connectorId: string,
    runId: string,
    expectedRowCount: number | null,
  ) {
    await this.legacy.getSyncRun(orgId, connectorId, runId);
    const row = await this.rpc(orgId, "m11_request_sync_run_commit_atomic", {
      p_actor_user_id: authorization.actorId,
      p_permission_version: authorization.permissionVersion,
      p_sync_run_id: runId,
      p_expected_row_count: expectedRowCount,
    });
    assertOutcome(row, ["queued"]);
    return syncRunSchema.parse(row.run);
  }
  async overview(
    orgId: string,
    connectorId: string,
  ): Promise<ConnectorOverview> {
    const connector = connectorSchema.parse(
      await this.legacy.getConnector(orgId, connectorId),
    );
    return (await this.summaries(orgId, [connector]))[0]!;
  }
  async overviews(orgId: string, params: PageParams) {
    const page = await this.legacy.listConnectors(orgId, params);
    const connectors = z.array(connectorSchema).parse(page.rows);
    return { ...page, rows: await this.summaries(orgId, connectors) };
  }
  private async summaries(
    orgId: string,
    connectors: readonly Connector[],
  ): Promise<ConnectorOverview[]> {
    if (connectors.length === 0) return [];
    const { data, error } = await this.client().rpc(
      "m11_connector_connection_summaries",
      {
        p_organization_id: orgId,
        p_connector_ids: connectors.map((connector) => connector.id),
      },
    );
    if (error || !Array.isArray(data)) throw new ConnectorError("unavailable");
    const rows = data.map((row: unknown) => this.parsedRow(row));
    const agentIds = connectors
      .filter((connector) => connector.connectorType === "on_prem_agent")
      .map((connector) => connector.id);
    const agentRows =
      agentIds.length === 0
        ? []
        : await this.client()
            .rpc("m1106_agent_connection_summaries", {
              p_organization_id: orgId,
              p_connector_ids: agentIds,
            })
            .then(({ data: agentData, error: agentError }) => {
              if (agentError || !Array.isArray(agentData))
                throw new ConnectorError("unavailable");
              return agentData.map((row: unknown) => this.parsedRow(row));
            });
    return connectors.map((connector) => {
      const row = rows.find((item) => item.connector_id === connector.id);
      if (!row) throw new ConnectorError("unavailable");
      const agentRow =
        connector.connectorType === "on_prem_agent"
          ? agentRows.find((item) => item.connector_id === connector.id)
          : null;
      if (
        connector.connectorType === "on_prem_agent" &&
        (agentRow == null || typeof agentRow.active_agent !== "boolean")
      )
        throw new ConnectorError("unavailable");
      const assessment = row.scope_assessment
        ? this.parsedRow(row.scope_assessment)
        : {};
      const discovered = compareConnectorScopes(
        {
          version:
            typeof assessment.policyVersion === "string"
              ? assessment.policyVersion
              : CONNECTOR_SCOPE_POLICY_VERSION,
          requiredScopes: [],
          allowedScopes: [],
          notApplicable: assessment.status === "not_applicable",
        },
        assessment.status === "unknown" ||
          !assessment.status ||
          assessment.status === "not_applicable"
          ? null
          : z.array(z.string()).parse(assessment.grantedScopes),
        connector.lastTestedAt,
      );
      const scope =
        assessment.status === "missing" || assessment.status === "excess"
          ? {
              ...discovered,
              status: "known" as const,
              missingScopes: z
                .array(z.string())
                .parse(assessment.missingScopes),
              excessScopes: z.array(z.string()).parse(assessment.excessScopes),
              warnings: [
                assessment.status === "missing"
                  ? ("missing_required_scope" as const)
                  : ("excess_privileges" as const),
              ],
            }
          : discovered;
      const currentTest =
        row.last_test_connection_revision === row.connection_revision;
      const category =
        currentTest && connector.lastTestOutcome
          ? connector.lastTestOutcome === "success"
            ? "success"
            : (connector.lastTestErrorCode ?? "unknown")
          : "not_tested";
      const [status, reason] = connectionStatus(
        connector,
        row,
        currentTest,
        assessment.status === "missing" || scope.missingScopes.length > 0,
        agentRow?.active_agent === true,
      );
      return connectorOverviewSchema.parse({
        connector,
        connection: {
          status,
          reason,
          lastSyncAt: row.last_sync_at
            ? new Date(string(row.last_sync_at)).toISOString()
            : null,
          connectionRevision: integer(row.connection_revision),
          credentialRevision: integer(row.credential_revision),
          scope,
          test: safeConnectorTestDiagnostic(
            category,
            currentTest ? connector.lastTestedAt : null,
          ),
        },
      });
    });
  }
  private async rpc(
    orgId: string,
    name: string,
    input: Readonly<Record<string, unknown>>,
  ) {
    let result: Result;
    try {
      result = await this.client().rpc(name, {
        ...input,
        p_organization_id: orgId,
      });
    } catch {
      throw new ConnectorError("unavailable");
    }
    if (result.error || !Array.isArray(result.data) || result.data.length !== 1)
      throw new ConnectorError("unavailable");
    return this.parsedRow(result.data[0]);
  }
}

function args(request: ConnectorCommandRequest) {
  return {
    p_connector_id: request.connectorId,
    p_actor_user_id: request.authorization.actorId,
    p_operation: request.operation,
    p_expected_version: request.expectedVersion,
    p_idempotency_key: request.idempotencyKey,
    p_request_digest: request.requestDigest,
    p_request_digest_key_id: request.requestDigestKeyId,
    p_permission_version: request.authorization.permissionVersion,
    p_payload: request.payload,
  };
}
function assertOutcome(
  row: Readonly<Record<string, unknown>>,
  success: readonly string[],
) {
  if (typeof row.outcome === "string" && success.includes(row.outcome)) return;
  const mapped = {
    not_found: "not_found",
    forbidden: "forbidden_by_policy",
    forbidden_by_policy: "forbidden_by_policy",
    conflict: "conflict",
    idempotency_conflict: "idempotency_mismatch",
    in_progress: "already_running",
    interrupted: "invalid_state",
    invalid_state: "invalid_state",
    invalid_request: "invalid_request",
    dry_run_expired: "dry_run_expired",
    stale_preview: "stale_preview",
    blocked_by_conflicts: "blocked_by_conflicts",
    blocked_by_dead_letter: "blocked_by_dead_letter",
    connector_disabled: "invalid_state",
    plan_count_changed: "conflict",
  } as const;
  throw new ConnectorError(
    typeof row.outcome === "string" && row.outcome in mapped
      ? mapped[row.outcome as keyof typeof mapped]
      : "unavailable",
  );
}
function integer(value: unknown): number {
  const parsed = z.number().int().nonnegative().safeParse(value);
  if (!parsed.success) throw new ConnectorError("unavailable");
  return parsed.data;
}
function string(value: unknown): string {
  if (typeof value !== "string" || value.length === 0)
    throw new ConnectorError("unavailable");
  return value;
}
function byteaBase64(value: unknown): string {
  const source = string(value);
  if (!/^\\x(?:[a-f0-9]{2})+$/i.test(source))
    throw new ConnectorError("unavailable");
  return Buffer.from(source.slice(2), "hex").toString("base64");
}
function connectionStatus(
  connector: Connector,
  row: Readonly<Record<string, unknown>>,
  currentTest: boolean,
  missingScope: boolean,
  agentActive: boolean,
): readonly [string, string] {
  if (!connector.enabled) return ["not_connected", "disabled"];
  if (row.credential_revoked) return ["not_connected", "credentials_revoked"];
  if (
    connector.connectorType === "on_prem_agent"
      ? !agentActive
      : !connector.hasSecret
  )
    return ["not_connected", "credentials_missing"];
  if (!currentTest) return ["not_connected", "test_required"];
  if (missingScope) return ["degraded", "missing_scope"];
  if (connector.lastTestErrorCode === "auth_failed")
    return ["auth_expired", "authentication_expired"];
  if (connector.lastTestErrorCode === "vault_unavailable")
    return ["degraded", "vault_unavailable"];
  if (connector.lastTestOutcome !== "success")
    return ["degraded", "test_failed"];
  if (row.active_sync_status === "running")
    return ["syncing", "sync_in_progress"];
  return ["healthy", "ready"];
}
