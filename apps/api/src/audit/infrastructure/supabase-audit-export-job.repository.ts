import { Injectable } from "@nestjs/common";
import { z } from "zod";
import { auditSearchFiltersSchema } from "@repo/contracts/audit/schemas";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  AuditExportEvent,
  AuditExportJob,
  AuditExportJobRepository,
} from "../worker/audit-export-types";

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const uuid = z.uuid();
const jobSchema = z
  .object({
    id: uuid,
    organization_id: uuid,
    requester_id: uuid,
    worker_id: z.string().min(1),
    version: z.number().int().nonnegative(),
    format: z.enum(["csv", "json"]),
    filters: z.record(z.string(), z.unknown()),
    scope_digest: sha256,
    selected_event_ids: z.array(uuid).max(100000),
  })
  .passthrough();
const eventSchema = z
  .object({
    id: uuid,
    sequence: z.string().regex(/^\d+$/).nullable(),
    previous_hash: sha256.nullable(),
    content_hash: sha256.nullable(),
    canonical_content: z.string().nullable(),
    recomputed_canonical_content: z.string().nullable().optional(),
    canonical_disclosable: z.boolean().default(false),
    legacy: z.boolean(),
    created_at: z.string(),
    actor_id: z.string().nullable(),
    actor_type: z.string().min(1),
    actor_label: z.string().nullable(),
    action: z.string().min(1),
    resource_type: z.string().min(1),
    resource_id: z.string().nullable(),
    correlation_id: z.string().nullable(),
    outcome: z.string().nullable(),
    before: z.json().nullable(),
    after: z.json().nullable(),
    reason: z.string().nullable(),
  })
  .passthrough();

type RpcResult = Readonly<{
  data: unknown;
  error: { message?: string } | null;
}>;

@Injectable()
export class SupabaseAuditExportJobRepository implements AuditExportJobRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async claim(workerId: string): Promise<AuditExportJob | null> {
    const row = await this.rpc("m13_03_claim_export", {
      p_worker_id: workerId,
    });
    if (row === null) return null;
    return parseJob(row);
  }

  async events(
    job: AuditExportJob,
    offset: number,
    limit: number,
  ): Promise<readonly AuditExportEvent[]> {
    const rows = await this.rpc("m13_03_read_export_events", {
      p_organization_id: job.organizationId,
      p_export_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_offset: offset,
      p_limit: limit,
    });
    if (!Array.isArray(rows)) throw new Error("malformed_provider");
    return Object.freeze(rows.map(parseEvent));
  }

  async heartbeat(job: AuditExportJob): Promise<AuditExportJob> {
    const row = await this.transition(job, {
      next_state: "processing",
      selected_ids: null,
      artifact: null,
      failure_code: null,
    });
    return parseJob(row);
  }

  async complete(
    command: Parameters<AuditExportJobRepository["complete"]>[0],
  ): Promise<"completed" | "conflict" | "not_found" | "invalid_state"> {
    const row = await this.transition(command.job, {
      next_state: "ready",
      selected_ids: command.selectedIds,
      artifact: {
        sha256: command.artifact.sha256,
        objectPath: command.artifact.objectPath,
        bytes: command.artifact.byteSize,
        contentType: command.artifact.contentType,
        manifest: command.artifact.manifest,
      },
      failure_code: null,
    });
    return transitionOutcome(row);
  }

  async fail(
    command: Parameters<AuditExportJobRepository["fail"]>[0],
  ): Promise<void> {
    await this.transition(command.job, {
      next_state: command.retryable ? "queued" : "failed",
      selected_ids: null,
      artifact: null,
      failure_code: command.code,
    });
  }

  private transition(
    job: AuditExportJob,
    patch: Record<string, unknown>,
  ): Promise<unknown> {
    return this.rpc("m13_03_transition_export", {
      p_organization_id: job.organizationId,
      p_job_id: job.id,
      p_worker_id: job.leaseOwner,
      p_expected_version: job.checkpointVersion,
      ...Object.fromEntries(
        Object.entries(patch).map(([key, value]) => [`p_${key}`, value]),
      ),
    });
  }

  private async rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const response = (await this.supabase
      .admin()
      .rpc(name as never, args as never)) as RpcResult;
    if (response.error) throw new Error("provider_unavailable");
    return response.data;
  }
}

function parseFilters(value: unknown): AuditExportJob["filters"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return auditSearchFiltersSchema.parse(value);
  }
  const raw = value as Record<string, unknown>;
  return auditSearchFiltersSchema.parse({
    from: raw.from,
    to: raw.to,
    ...(typeof raw.actorId === "string" ? { actorId: raw.actorId } : {}),
    ...(typeof raw.action === "string" ? { action: raw.action } : {}),
    ...(typeof raw.resourceType === "string"
      ? { resourceType: raw.resourceType }
      : {}),
    ...(typeof raw.resourceId === "string"
      ? { resourceId: raw.resourceId }
      : {}),
    ...(typeof raw.correlationId === "string"
      ? { correlationId: raw.correlationId }
      : {}),
  });
}

function parseJob(value: unknown): AuditExportJob {
  const row = jobSchema.parse(value);
  return Object.freeze({
    id: row.id,
    organizationId: row.organization_id,
    actorUserId: row.requester_id,
    leaseOwner: row.worker_id,
    checkpointVersion: row.version,
    format: row.format,
    filters: parseFilters(row.filters),
    scopeDigest: row.scope_digest,
    selectedIds: Object.freeze(row.selected_event_ids),
  });
}

function parseEvent(value: unknown): AuditExportEvent {
  const row = eventSchema.parse(value);
  return Object.freeze({
    id: row.id,
    sequence: row.sequence,
    previousHash: row.previous_hash,
    contentHash: row.content_hash,
    canonicalContent: row.canonical_content,
    recomputedCanonicalContent:
      row.recomputed_canonical_content ?? row.canonical_content,
    canonicalDisclosable: row.canonical_disclosable,
    legacy: row.legacy,
    createdAt: row.created_at,
    actorId: row.actor_id,
    actorType: row.actor_type,
    actorLabel: row.actor_label,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    correlationId: row.correlation_id,
    outcome: row.outcome,
    before: row.before,
    after: row.after,
    reason: row.reason,
  });
}

function transitionOutcome(
  value: unknown,
): "completed" | "conflict" | "not_found" | "invalid_state" {
  if (value && typeof value === "object") {
    const row = value as {
      outcome?: unknown;
      state?: unknown;
      status?: unknown;
    };
    const outcome = row.outcome ?? row.state ?? row.status;
    if (outcome === "ready" || outcome === "completed") return "completed";
    if (
      outcome === "conflict" ||
      outcome === "not_found" ||
      outcome === "invalid_state"
    )
      return outcome;
  }
  throw new Error("malformed_provider");
}
