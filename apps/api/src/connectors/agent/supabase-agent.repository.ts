import { createHash, randomBytes, X509Certificate } from "node:crypto";
import { z } from "zod";
import {
  agentStatusResponseSchema,
  connectorCapabilitiesSchema,
  connectorExternalRecordSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  ConnectorCapabilities,
  PullPage,
  SyncCursor,
} from "../application/connector-port";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { AesGcmConnectorVault } from "../infrastructure/connector-vault";
import type { ConnectorSecretEnvelope } from "../application/connector-vault.port";
import type { IssuedAgentCertificate } from "./agent-certificate-authority";

const uuid = z.uuid();
const envelopeSchema = z
  .object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: z.string(),
    ciphertext: z.string(),
    nonce: z.string(),
    authTag: z.string(),
  })
  .strict();
const agentRowSchema = z
  .object({
    id: uuid,
    organization_id: uuid,
    connector_id: uuid,
    status: z.enum(["pending", "active", "revoked"]),
    enrollment_token_envelope: envelopeSchema.nullable().optional(),
    enrollment_expires_at: z.string().nullable().optional(),
    enrollment_csr_hash: z.string().nullable().optional(),
    current_cert_fingerprint: z.string().nullable().optional(),
    current_cert_pem: z.string().nullable().optional(),
    current_signing_key_id: z.string().nullable().optional(),
    current_signing_key_envelope: envelopeSchema.nullable().optional(),
    current_key_issued_at: z.string().nullable().optional(),
    current_expires_at: z.string().nullable().optional(),
    previous_cert_fingerprint: z.string().nullable().optional(),
    previous_signing_key_id: z.string().nullable().optional(),
    previous_signing_key_envelope: envelopeSchema.nullable().optional(),
    previous_key_issued_at: z.string().nullable().optional(),
    previous_valid_until: z.string().nullable().optional(),
    last_contact_at: z.string().nullable().optional(),
    agent_version: z.string().nullable().optional(),
    capabilities: z
      .array(z.enum(["canonical_file", "https_read"]))
      .nullable()
      .optional(),
    backlog_count: z.number().nullable().optional(),
    backlog_bytes: z.number().nullable().optional(),
    last_error_code: z.string().nullable().optional(),
  })
  .passthrough();
export type AgentRow = z.output<typeof agentRowSchema>;
const rpcAgentResultSchema = z.object({
  outcome: z.string(),
  agent: agentRowSchema.nullable(),
});
const rpcTimeResultSchema = z.object({
  outcome: z.string(),
  accepted_at: z.string().nullable().optional(),
});
const rpcOutcomeSchema = z.object({ outcome: z.string() });
const batchRowSchema = z.object({
  id: uuid,
  batch_id: uuid,
  sequence: z.number().int().positive(),
  source_id: z.string(),
  cursor_from: z.string().nullable(),
  cursor_to: z.string(),
  records: z.array(connectorExternalRecordSchema),
  record_count: z.number().int().nonnegative(),
  received_at: z.string(),
  status: z.enum(["staged", "committed"]),
});
const batchStatusSchema = batchRowSchema.pick({
  id: true,
  sequence: true,
  received_at: true,
  status: true,
  record_count: true,
});

type RpcResult = Readonly<{ data: unknown; error: unknown }>;
type Query = PromiseLike<RpcResult> & {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  is(column: string, value: null): Query;
  order(column: string, options: { ascending: boolean }): Query;
  limit(count: number): Query;
  range(from: number, to: number): Query;
  maybeSingle(): Promise<RpcResult>;
};
type Client = Readonly<{
  from(table: string): Query;
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<RpcResult>;
}>;

export class AgentRepositoryError extends Error {
  constructor(readonly code: string) {
    super(`Agent operation failed: ${code}`);
  }
}

const digest = (value: string): string =>
  createHash("sha256").update(value).digest("hex");
const iso = (value: string): string => {
  const time = Date.parse(value);
  if (!Number.isFinite(time)) throw new AgentRepositoryError("unavailable");
  return new Date(time).toISOString();
};
const first = (value: unknown): unknown =>
  Array.isArray(value) ? value[0] : value;
const capabilityField = (field: string, required = false) => ({
  field,
  type: "string" as const,
  nullable: !required,
  required,
  sensitive: false,
  supportsPull: true,
  supportsPush: false,
  vendorFieldPath: field,
});
const CANONICAL_CAPABILITIES = connectorCapabilitiesSchema.parse({
  adapterVersion: "1.0.0",
  mappingVersion: "on-prem-agent-v1",
  entities: [
    {
      entityType: "product",
      supportsPush: false,
      supportsTombstones: true,
      supportsHierarchy: true,
      fields: [
        capabilityField("name", true),
        capabilityField("internalCode"),
        capabilityField("productType"),
        capabilityField("description"),
      ],
    },
    {
      entityType: "release",
      supportsPush: false,
      supportsTombstones: true,
      supportsHierarchy: true,
      fields: [
        capabilityField("label", true),
        capabilityField("releaseVersion"),
        capabilityField("description"),
      ],
    },
  ],
});

/** Every service-role table read and write is scoped to a recorded organization. */
export class SupabaseAgentRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly vault: AesGcmConnectorVault,
  ) {}
  private client(): Client {
    return this.supabase.admin() as unknown as Client;
  }
  private async rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<unknown> {
    const result = await this.client().rpc(name, args);
    if (result.error) throw new AgentRepositoryError("unavailable");
    return first(result.data);
  }
  private agentResult(value: unknown): AgentRow {
    const result = rpcAgentResultSchema.safeParse(value);
    if (!result.success) throw new AgentRepositoryError("unavailable");
    if (
      !["issued", "enrolled", "rotated", "revoked", "replayed"].includes(
        result.data.outcome,
      ) ||
      !result.data.agent
    )
      throw new AgentRepositoryError(result.data.outcome);
    return result.data.agent;
  }
  private envelope(
    orgId: string,
    connectorId: string,
    agentId: string,
    purpose: string,
    value: string,
  ): ConnectorSecretEnvelope {
    return this.vault.encrypt(
      {
        orgId,
        connectorId,
        secretId: `${agentId}:${purpose}`,
        credentialRevision: 1,
      },
      value,
    );
  }
  private reveal(
    orgId: string,
    connectorId: string,
    agentId: string,
    purpose: string,
    value: ConnectorSecretEnvelope,
  ): string {
    return this.vault.decrypt(
      {
        orgId,
        connectorId,
        secretId: `${agentId}:${purpose}`,
        credentialRevision: 1,
      },
      value,
    );
  }
  async issueEnrollment(
    orgId: string,
    connectorId: string,
    actorId: string,
    permissionVersion: number,
    idempotencyKey: string,
  ) {
    if (!this.vault.available()) throw new AgentRepositoryError("unavailable");
    // Obtain the stable row identity before encrypting its token. The RPC owns
    // the idempotency fence; the key is also the pending row id.
    const agentId = idempotencyKey;
    const token = randomBytes(32).toString("base64url");
    const row = this.agentResult(
      await this.rpc("m1106_issue_agent_enrollment", {
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_actor_user_id: actorId,
        p_permission_version: permissionVersion,
        p_idempotency_key: idempotencyKey,
        p_token_hash: digest(token),
        p_token_envelope: this.envelope(
          orgId,
          connectorId,
          agentId,
          "enrollment",
          token,
        ),
      }),
    );
    if (!row.enrollment_token_envelope || !row.enrollment_expires_at)
      throw new AgentRepositoryError("unavailable");
    return {
      token: this.reveal(
        orgId,
        connectorId,
        row.id,
        "enrollment",
        row.enrollment_token_envelope,
      ),
      expiresAt: iso(row.enrollment_expires_at),
    };
  }
  async findEnrollment(token: string): Promise<AgentRow | null> {
    const result = await this.client()
      .from("connector_agents")
      .select("id,organization_id,connector_id,status,enrollment_expires_at")
      .eq("enrollment_token_hash", digest(token))
      .maybeSingle();
    if (result.error) throw new AgentRepositoryError("unavailable");
    if (!result.data) return null;
    return agentRowSchema.parse(result.data);
  }
  async redeemEnrollment(
    token: string,
    csrPem: string,
    issued: IssuedAgentCertificate,
  ) {
    const preflight = await this.findEnrollment(token);
    if (!preflight) throw new AgentRepositoryError("invalid_enrollment");
    const {
      organization_id: orgId,
      connector_id: connectorId,
      id: agentId,
    } = preflight;
    const signingKey = randomBytes(32).toString("base64url");
    const signingKeyId = randomBytes(12).toString("hex");
    const row = this.agentResult(
      await this.rpc("m1106_redeem_agent_enrollment", {
        p_token_hash: digest(token),
        p_csr_hash: digest(csrPem),
        p_cert_serial: issued.serial,
        p_cert_fingerprint: issued.fingerprint,
        p_cert_pem: issued.clientCertificatePem,
        p_signing_key_id: signingKeyId,
        p_signing_key_envelope: this.envelope(
          orgId,
          connectorId,
          agentId,
          `hmac:${signingKeyId}`,
          signingKey,
        ),
      }),
    );
    return this.credentialResponse(row, issued.caCertificatePem);
  }
  async rotate(
    orgId: string,
    connectorId: string,
    agentId: string,
    idempotencyKey: string,
    csrPem: string,
    issued: IssuedAgentCertificate,
  ) {
    const signingKey = randomBytes(32).toString("base64url");
    const signingKeyId = randomBytes(12).toString("hex");
    const row = this.agentResult(
      await this.rpc("m1106_rotate_agent_credential", {
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_idempotency_key: idempotencyKey,
        p_csr_hash: digest(csrPem),
        p_cert_serial: issued.serial,
        p_cert_fingerprint: issued.fingerprint,
        p_cert_pem: issued.clientCertificatePem,
        p_signing_key_id: signingKeyId,
        p_signing_key_envelope: this.envelope(
          orgId,
          connectorId,
          agentId,
          `hmac:${signingKeyId}`,
          signingKey,
        ),
      }),
    );
    return this.credentialResponse(row, issued.caCertificatePem);
  }
  private credentialResponse(row: AgentRow, caCertificatePem: string) {
    if (
      !row.current_cert_pem ||
      !row.current_signing_key_id ||
      !row.current_signing_key_envelope ||
      !row.current_expires_at
    )
      throw new AgentRepositoryError("unavailable");
    const certDeadline = Date.parse(
      new X509Certificate(row.current_cert_pem).validTo,
    );
    const keyDeadline = Date.parse(row.current_expires_at);
    if (!Number.isFinite(certDeadline) || !Number.isFinite(keyDeadline))
      throw new AgentRepositoryError("unavailable");
    return {
      agentId: row.id,
      organizationId: row.organization_id,
      connectorId: row.connector_id,
      clientCertificatePem: row.current_cert_pem,
      caCertificatePem,
      signingKeyId: row.current_signing_key_id,
      signingKey: this.reveal(
        row.organization_id,
        row.connector_id,
        row.id,
        `hmac:${row.current_signing_key_id}`,
        row.current_signing_key_envelope,
      ),
      expiresAt: new Date(Math.min(certDeadline, keyDeadline)).toISOString(),
    };
  }
  async findAgent(
    orgId: string,
    connectorId: string,
    agentId: string,
  ): Promise<AgentRow | null> {
    const result = await this.client()
      .from("connector_agents")
      .select(
        "id,organization_id,connector_id,status,current_cert_fingerprint,current_signing_key_id,current_signing_key_envelope,current_key_issued_at,previous_cert_fingerprint,previous_signing_key_id,previous_signing_key_envelope,previous_key_issued_at,previous_valid_until",
      )
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("id", agentId)
      .maybeSingle();
    if (result.error) throw new AgentRepositoryError("unavailable");
    return result.data ? agentRowSchema.parse(result.data) : null;
  }
  signingKey(
    row: AgentRow,
    keyId: string,
    certFingerprint: string,
  ): { key: string; issuedAt: string } | null {
    const current =
      row.current_signing_key_id === keyId &&
      row.current_cert_fingerprint === certFingerprint;
    const previous =
      row.previous_signing_key_id === keyId &&
      row.previous_cert_fingerprint === certFingerprint &&
      row.previous_valid_until &&
      Date.parse(row.previous_valid_until) > Date.now();
    const envelope = current
      ? row.current_signing_key_envelope
      : previous
        ? row.previous_signing_key_envelope
        : null;
    const issuedAt = current
      ? row.current_key_issued_at
      : previous
        ? row.previous_key_issued_at
        : null;
    if (!envelope || !issuedAt) return null;
    return {
      key: this.reveal(
        row.organization_id,
        row.connector_id,
        row.id,
        `hmac:${keyId}`,
        envelope,
      ),
      issuedAt,
    };
  }
  async consumeNonce(
    orgId: string,
    connectorId: string,
    agentId: string,
    certFingerprint: string,
    signingKeyId: string,
    nonce: string,
  ): Promise<boolean> {
    const value = rpcOutcomeSchema.parse(
      await this.rpc("m1106_consume_agent_nonce", {
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_cert_fingerprint: certFingerprint,
        p_signing_key_id: signingKeyId,
        p_nonce: nonce,
        p_expires_at: new Date(Date.now() + 3 * 60_000).toISOString(),
      }),
    );
    if (value.outcome === "accepted") return true;
    if (value.outcome === "replay") return false;
    throw new AgentRepositoryError(value.outcome);
  }
  /** Bounded maintenance; the UNIQUE replay fence remains valid during pruning. */
  async pruneExpiredNonces(): Promise<void> {
    await this.rpc("m1106_prune_agent_nonces", { p_limit: 10_000 });
  }
  async recordHealth(
    orgId: string,
    connectorId: string,
    agentId: string,
    frame: Readonly<{
      agentVersion: string;
      capabilities: readonly string[];
      backlogCount: number;
      backlogBytes: number;
      safeErrorCode: string | null;
    }>,
  ) {
    const result = rpcTimeResultSchema.parse(
      await this.rpc("m1106_record_agent_health", {
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_agent_version: frame.agentVersion,
        p_capabilities: frame.capabilities,
        p_backlog_count: frame.backlogCount,
        p_backlog_bytes: frame.backlogBytes,
        p_safe_error_code: frame.safeErrorCode,
      }),
    );
    if (result.outcome !== "accepted" || !result.accepted_at)
      throw new AgentRepositoryError(result.outcome);
    return { kind: "heartbeat" as const, acceptedAt: iso(result.accepted_at) };
  }
  async stageBatch(
    orgId: string,
    connectorId: string,
    agentId: string,
    frame: Readonly<{
      batchId: string;
      sequence: number;
      sourceId: string;
      cursorFrom: string | null;
      cursorTo: string;
      records: readonly unknown[];
      backlogCount: number;
      backlogBytes: number;
    }>,
  ) {
    const result = rpcTimeResultSchema.parse(
      await this.rpc("m1106_stage_agent_batch", {
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_batch_id: frame.batchId,
        p_sequence: frame.sequence,
        p_source_id: frame.sourceId,
        p_cursor_from: frame.cursorFrom,
        p_cursor_to: frame.cursorTo,
        p_records: frame.records,
        p_backlog_count: frame.backlogCount,
        p_backlog_bytes: frame.backlogBytes,
      }),
    );
    if (
      !["accepted", "replayed"].includes(result.outcome) ||
      !result.accepted_at
    )
      throw new AgentRepositoryError(result.outcome);
    return {
      kind: "batch" as const,
      batchId: frame.batchId,
      sequence: frame.sequence,
      acceptedAt: iso(result.accepted_at),
    };
  }
  async revoke(
    orgId: string,
    connectorId: string,
    agentId: string,
    actorId: string,
    permissionVersion: number,
    idempotencyKey: string,
  ) {
    const row = this.agentResult(
      await this.rpc("m1106_revoke_agent", {
        p_organization_id: orgId,
        p_connector_id: connectorId,
        p_agent_id: agentId,
        p_actor_user_id: actorId,
        p_permission_version: permissionVersion,
        p_idempotency_key: idempotencyKey,
      }),
    );
    return { agent: this.publicStatus(row) };
  }
  private publicStatus(row: AgentRow) {
    return {
      id: row.id,
      status: row.status,
      lastContactAt: row.last_contact_at ? iso(row.last_contact_at) : null,
      version: row.agent_version ?? null,
      capabilities: row.capabilities ?? [],
      backlogCount: row.backlog_count ?? 0,
      backlogBytes: row.backlog_bytes ?? 0,
      lastErrorCode: row.last_error_code ?? null,
    };
  }
  async status(orgId: string, connectorId: string, cursor?: string) {
    const rowResult = await this.client()
      .from("connector_agents")
      .select(
        "id,organization_id,connector_id,status,last_contact_at,agent_version,capabilities,backlog_count,backlog_bytes,last_error_code,updated_at",
      )
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rowResult.error) throw new AgentRepositoryError("unavailable");
    const row = rowResult.data ? agentRowSchema.parse(rowResult.data) : null;
    if (cursor && !/^(0|[1-9][0-9]{0,5})$/.test(cursor))
      throw new AgentRepositoryError("invalid_request");
    const offset = cursor ? Number(cursor) : 0;
    if (!Number.isSafeInteger(offset) || offset > 100_000)
      throw new AgentRepositoryError("invalid_request");
    const batchResult = await this.client()
      .from("connector_agent_batches")
      .select("id,sequence,record_count,received_at,status")
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .order("received_at", { ascending: false })
      .range(offset, offset + 20);
    if (batchResult.error) throw new AgentRepositoryError("unavailable");
    const batches = z.array(batchStatusSchema).parse(batchResult.data);
    return agentStatusResponseSchema.parse({
      agent: row ? this.publicStatus(row) : null,
      batches: {
        rows: batches.slice(0, 20).map((batch) => ({
          id: batch.id,
          sequence: batch.sequence,
          status: batch.status,
          receivedAt: iso(batch.received_at),
          recordCount: batch.record_count,
        })),
        nextCursor: batches.length > 20 ? String(offset + 20) : null,
      },
    });
  }
  async agentCapabilities(
    orgId: string,
    connectorId: string,
  ): Promise<ConnectorCapabilities | null> {
    const result = await this.client()
      .from("connector_agents")
      .select("id,status")
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("status", "active")
      .maybeSingle();
    if (result.error) throw new AgentRepositoryError("unavailable");
    const row = z
      .object({ id: uuid, status: z.string() })
      .safeParse(result.data);
    return row.success && row.data.status === "active"
      ? CANONICAL_CAPABILITIES
      : null;
  }
  async pullStagedPage(
    orgId: string,
    connectorId: string,
    cursor: SyncCursor | null,
    pageSize: number,
  ): Promise<PullPage> {
    if (!(await this.agentCapabilities(orgId, connectorId)))
      return { records: [], nextCursor: cursor, adapterSignal: "unavailable" };
    const token = cursor?.token ?? "agent:0";
    const match = /^agent:(0|[1-9][0-9]*)$/.exec(token);
    if (
      !match ||
      !Number.isSafeInteger(Number(match[1])) ||
      pageSize < 1 ||
      pageSize > 200
    )
      return {
        records: [],
        nextCursor: cursor,
        adapterSignal: "cursor_invalid",
      };
    const nextSequence = Number(match[1]) + 1;
    const result = await this.client()
      .from("connector_agent_batches")
      .select(
        "id,batch_id,sequence,source_id,cursor_from,cursor_to,records,record_count,received_at,status",
      )
      .eq("organization_id", orgId)
      .eq("connector_id", connectorId)
      .eq("sequence", nextSequence)
      .maybeSingle();
    if (result.error) throw new AgentRepositoryError("unavailable");
    if (!result.data)
      return { records: [], nextCursor: cursor, adapterSignal: "ok" };
    const batch = batchRowSchema.parse(result.data);
    if (batch.records.length > pageSize)
      return {
        records: [],
        nextCursor: cursor,
        adapterSignal: "cursor_invalid",
      };
    return {
      records: batch.records,
      nextCursor: {
        token: `agent:${batch.sequence}`,
        watermark: iso(batch.received_at),
      },
      adapterSignal: "ok",
    };
  }
}
