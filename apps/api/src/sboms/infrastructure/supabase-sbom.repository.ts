import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  sbomJobSchema,
  sbomSourceHistoryResponseSchema,
  sbomSourceSchema,
  sbomValidationReportResponseSchema,
} from "@repo/contracts/sboms";
import { z } from "zod";

import { SupabaseService } from "../../supabase/supabase.service";
import type {
  SbomCiCredential,
  SbomCiCredentialPort,
} from "../application/sbom-ci-credential.port";
import type {
  SbomIntakeRepository,
  SbomJob,
  SbomSource,
} from "../application/sbom-intake-use-cases";
import type {
  SbomIngestClaim,
  SbomIngestQueue,
} from "../worker/sbom-ingest-worker";

type ProviderRow = Readonly<Record<string, unknown>>;
type ProviderResult = Readonly<{ data: unknown; error: unknown }>;
type RpcClient = Readonly<{
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderResult>;
}>;
type SelectQuery = Readonly<{
  eq(column: string, value: string): SelectQuery;
  order(
    column: string,
    options?: Readonly<{ ascending?: boolean }>,
  ): SelectQuery;
  maybeSingle(): Promise<ProviderResult>;
  then<TResult1 = ProviderResult, TResult2 = never>(
    onfulfilled?:
      ((value: ProviderResult) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2>;
}>;
type TableClient = RpcClient &
  Readonly<{
    from(table: string): Readonly<{ select(columns: string): SelectQuery }>;
  }>;

const sourceRowSchema = sbomSourceSchema.extend({
  objectKey: z.string().min(1),
});
const workerWorkSchema = z
  .object({
    sourceId: z.uuid(),
    inputSha256: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .passthrough();
const credentialRowSchema = z
  .object({
    id: z.uuid(),
    organization_id: z.uuid(),
    label: z.string().min(1),
    token_prefix: z.string().min(1),
    created_at: z.string(),
    created_by: z.uuid(),
    revoked_at: z.string().nullable(),
    revoked_by: z.uuid().nullable(),
    last_used_at: z.string().nullable(),
    token_salt: z.string().optional(),
    token_hash: z.string().optional(),
    status: z.string().optional(),
  })
  .strict();

/** Service-role adapter: every access starts with organizationId and parses provider JSON. */
@Injectable()
export class SupabaseSbomRepository
  implements SbomIntakeRepository, SbomCiCredentialPort, SbomIngestQueue
{
  constructor(private readonly supabase: SupabaseService) {}

  async reserve(
    organizationId: string,
    input: Parameters<SbomIntakeRepository["reserve"]>[1],
  ): Promise<Awaited<ReturnType<SbomIntakeRepository["reserve"]>>> {
    const sourceId = randomUUID();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1_000).toISOString();
    const objectKey = `${organizationId}/${sourceId}/${input.sha256}`;
    const row = await this.one("reserve_sbom_source_atomic", {
      p_organization_id: organizationId,
      p_product_id: input.productId,
      p_release_id: input.releaseId,
      p_actor_user_id: input.ciCredentialId ? null : input.actorId,
      p_actor_credential_id: input.ciCredentialId ?? null,
      p_source_id: sourceId,
      p_source_kind: input.source,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: sbomRequestDigest(input),
      p_original_filename: input.filename,
      p_declared_media_type: input.mediaType,
      p_declared_byte_size: input.byteSize,
      p_declared_sha256: input.sha256,
      p_staging_storage_key: objectKey,
      p_upload_expires_at: expiresAt,
      p_correlation_id: input.correlationId,
      p_declared_format: input.declaredFormat ?? null,
      p_declared_spec_version: input.declaredSpecVersion ?? null,
      p_supersedes_source_id: input.supersedesSourceId ?? null,
    });
    const outcome = this.outcome(
      row,
      new Set([
        "created",
        "replayed",
        "not_found",
        "conflict",
        "idempotency_mismatch",
        "invalid_request",
      ]),
    );
    if (outcome !== "created" && outcome !== "replayed")
      return {
        outcome: outcome as
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request",
      };
    return { outcome, reservation: this.source(row.source) } as const;
  }

  async getSource(
    organizationId: string,
    sourceId: string,
  ): Promise<SbomSource | null> {
    try {
      const result = await this.tables()
        .from("sbom_sources")
        .select(
          "id, organization_id, product_id, release_id, source_kind, original_filename, declared_media_type, declared_byte_size, declared_sha256, status, staging_storage_key, upload_expires_at, declared_format, declared_spec_version, supersedes_source_id, created_at, verified_at",
        )
        .eq("organization_id", organizationId)
        .eq("id", sourceId)
        .maybeSingle();
      if (result.error || !result.data) return null;
      const row = this.record(result.data);
      return this.source({
        id: row.id,
        organizationId: row.organization_id,
        productId: row.product_id,
        releaseId: row.release_id,
        source: row.source_kind,
        fileName: row.original_filename,
        mediaType: row.declared_media_type,
        byteSize: row.declared_byte_size,
        sha256: row.declared_sha256,
        status: row.status,
        declaredFormat:
          typeof row.declared_format === "string"
            ? row.declared_format
            : undefined,
        declaredSpecVersion:
          typeof row.declared_spec_version === "string"
            ? row.declared_spec_version
            : undefined,
        supersedesSourceId:
          typeof row.supersedes_source_id === "string"
            ? row.supersedes_source_id
            : undefined,
        createdAt: row.created_at,
        completedAt: row.verified_at,
        objectKey: row.staging_storage_key,
      });
    } catch {
      throw new SbomRepositoryError("unavailable");
    }
  }

  async getSourceForCompletion(
    organizationId: string,
    input: Parameters<SbomIntakeRepository["getSourceForCompletion"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomIntakeRepository["getSourceForCompletion"]>>
  > {
    const row = await this.one("get_sbom_source_for_completion", {
      p_organization_id: organizationId,
      p_source_id: input.sourceId,
      p_actor_user_id: input.ciCredentialId ? null : input.actorId,
      p_actor_credential_id: input.ciCredentialId ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
    const outcome = this.outcome(
      row,
      new Set(["ready", "replayed", "not_found", "invalid_request"]),
    );
    if (outcome === "ready") {
      if (
        row.storage_bucket !== "sbom-originals" ||
        typeof row.storage_key !== "string"
      ) {
        throw new SbomRepositoryError("malformed");
      }
      return { outcome, source: this.source(row.source, row.storage_key) };
    }
    return outcome === "replayed"
      ? { outcome, source: this.source(row.source) }
      : { outcome: outcome as "not_found" | "invalid_request" };
  }

  async getDownloadSource(
    organizationId: string,
    actorId: string,
    sourceId: string,
    correlationId: string,
  ): Promise<SbomSource | null> {
    const access = await this.one("get_sbom_source_download", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_source_id: sourceId,
      p_correlation_id: correlationId,
    });
    if (this.outcome(access, new Set(["found", "not_found"])) === "not_found")
      return null;
    const source = await this.getSource(organizationId, sourceId);
    if (
      !source ||
      typeof access.storage_key !== "string" ||
      typeof access.storage_bucket !== "string" ||
      access.storage_bucket !== "sbom-originals"
    ) {
      throw new SbomRepositoryError("malformed");
    }
    return Object.freeze({ ...source, objectKey: access.storage_key });
  }

  async complete(
    organizationId: string,
    input: Parameters<SbomIntakeRepository["complete"]>[1],
  ): Promise<Awaited<ReturnType<SbomIntakeRepository["complete"]>>> {
    const row = await this.one("finalize_sbom_source_atomic", {
      p_organization_id: organizationId,
      p_source_id: input.sourceId,
      p_actor_user_id: input.ciCredentialId ? null : input.actorId,
      p_actor_credential_id: input.ciCredentialId ?? null,
      p_actual_sha256: input.actualHash,
      p_actual_byte_size: input.actualByteSize,
      p_actual_media_type: input.actualMediaType,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: input.correlationId,
    });
    const outcome = this.outcome(
      row,
      new Set([
        "queued",
        "replayed",
        "not_found",
        "conflict",
        "idempotency_mismatch",
        "invalid_state",
        "expired",
        "integrity_mismatch",
      ]),
    );
    if (outcome !== "queued" && outcome !== "replayed")
      return {
        outcome:
          outcome === "not_found"
            ? "not_found"
            : outcome === "idempotency_mismatch"
              ? "idempotency_mismatch"
              : "conflict",
      };
    return { outcome, job: this.job(row.job) } as const;
  }

  async rejectIntegrity(
    organizationId: string,
    input: Parameters<SbomIntakeRepository["rejectIntegrity"]>[1],
  ): Promise<Awaited<ReturnType<SbomIntakeRepository["rejectIntegrity"]>>> {
    const row = await this.one("reject_sbom_source_integrity_atomic", {
      p_organization_id: organizationId,
      p_source_id: input.sourceId,
      p_actor_user_id: input.ciCredentialId ? null : input.actorId,
      p_actor_credential_id: input.ciCredentialId ?? null,
      p_actual_sha256: input.actualHash,
      p_actual_byte_size: input.actualByteSize,
      p_actual_media_type: input.actualMediaType,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: input.correlationId,
    });
    const outcome = this.outcome(
      row,
      new Set([
        "rejected",
        "replayed",
        "not_found",
        "invalid_request",
        "idempotency_mismatch",
        "invalid_state",
      ]),
    );
    if (outcome === "rejected" || outcome === "replayed") return { outcome };
    if (
      outcome === "not_found" ||
      outcome === "invalid_request" ||
      outcome === "idempotency_mismatch" ||
      outcome === "invalid_state"
    ) {
      return { outcome };
    }
    throw new SbomRepositoryError("malformed");
  }

  async getJob(
    organizationId: string,
    actorId: string,
    jobId: string,
  ): Promise<SbomJob | null> {
    const row = await this.one("get_sbom_ingest_job", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_job_id: jobId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) === "not_found")
      return null;
    return this.job(row.job);
  }

  async replay(
    organizationId: string,
    input: Parameters<SbomIntakeRepository["replay"]>[1],
  ): Promise<Awaited<ReturnType<SbomIntakeRepository["replay"]>>> {
    const row = await this.one("replay_sbom_ingest_job_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_job_id: input.jobId,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: randomUUID(),
    });
    const outcome = this.outcome(
      row,
      new Set([
        "queued",
        "replayed",
        "not_found",
        "invalid_state",
        "idempotency_mismatch",
      ]),
    );
    return outcome === "queued" || outcome === "replayed"
      ? { outcome, job: this.job(row.job) }
      : {
          outcome: outcome === "not_found" ? "not_found" : "conflict",
        };
  }

  async listSourcesForRelease(
    organizationId: string,
    input: Parameters<SbomIntakeRepository["listSourcesForRelease"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomIntakeRepository["listSourcesForRelease"]>>
  > {
    const row = await this.one("list_sbom_sources_for_release", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_product_id: input.productId,
      p_release_id: input.releaseId,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    const outcome = this.outcome(
      row,
      new Set<"found" | "not_found" | "invalid_request">([
        "found",
        "not_found",
        "invalid_request",
      ]),
    );
    if (outcome !== "found") return { outcome };
    return {
      outcome,
      response: sbomSourceHistoryResponseSchema.parse({
        sources: row.sources,
        nextCursor: row.next_cursor,
      }),
    };
  }

  async getValidationReport(
    organizationId: string,
    input: Parameters<SbomIntakeRepository["getValidationReport"]>[1],
  ): Promise<Awaited<ReturnType<SbomIntakeRepository["getValidationReport"]>>> {
    const row = await this.one("get_sbom_validation_report", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_source_id: input.sourceId,
    });
    const outcome = this.outcome(
      row,
      new Set<"found" | "not_found">(["found", "not_found"]),
    );
    if (outcome !== "found") return { outcome };
    return {
      outcome,
      response: sbomValidationReportResponseSchema.parse({
        source: row.source,
        report: row.report,
      }),
    };
  }

  async dueOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.rows("list_due_sbom_ingest_organizations", {
      p_limit: 500,
    });
    return Object.freeze(
      rows.flatMap((row) =>
        typeof row.organization_id === "string" ? [row.organization_id] : [],
      ),
    );
  }

  async claim(
    organizationId: string,
    input: Readonly<{ workerId: string; leaseSeconds: number }>,
  ): Promise<SbomIngestClaim> {
    const row = await this.one("claim_sbom_ingest_job", {
      p_organization_id: organizationId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });
    const outcome = this.outcome(
      row,
      new Set(["claimed", "empty", "invalid_request"]),
    );
    if (outcome !== "claimed") return { outcome: "none_available" };
    const work = workerWorkSchema.parse(row.work);
    const source = await this.getSource(organizationId, work.sourceId);
    if (!source) return { outcome: "conflict" };
    return {
      outcome: "claimed",
      organizationId,
      jobId: string(this.record(row.job).id),
      sourceId: work.sourceId,
      objectKey: source.objectKey,
      sha256: work.inputSha256,
      byteSize: source.byteSize,
      mediaType: source.mediaType,
      retryCount: number(this.record(row.job).attempts, 0),
      fileName: source.filename,
      declaredFormat: source.declaredFormat ?? null,
      declaredSpecVersion: source.declaredSpecVersion ?? null,
    };
  }

  async checkpoint(
    organizationId: string,
    input: Parameters<SbomIngestQueue["checkpoint"]>[1],
  ): Promise<void> {
    await this.one("checkpoint_sbom_ingest_job", {
      p_organization_id: organizationId,
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_progress_stage: input.stage,
      p_progress_percent: input.percent,
      p_lease_seconds: 60,
    });
  }
  async completeWithValidation(
    organizationId: string,
    input: Parameters<SbomIngestQueue["completeWithValidation"]>[1],
  ): Promise<void> {
    const row = await this.one("record_sbom_validation_atomic", {
      p_organization_id: organizationId,
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_report: input.report,
    });
    const outcome = this.outcome(
      row,
      new Set(["completed", "not_found", "invalid_request", "invalid_state"]),
    );
    if (outcome !== "completed") throw new SbomRepositoryError("unavailable");
  }
  async fail(
    organizationId: string,
    input: Parameters<SbomIngestQueue["fail"]>[1],
  ): Promise<void> {
    const code =
      input.errorCode === "unavailable"
        ? "provider_unavailable"
        : input.errorCode === "content_hash_mismatch"
          ? "content_hash_mismatch"
          : input.errorCode === "source_missing"
            ? "source_missing"
            : "unknown_failure";
    await this.one("fail_sbom_ingest_job", {
      p_organization_id: organizationId,
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_error_code: code,
    });
  }

  async authenticate(token: string) {
    const [prefix, secret] = token.split(".");
    if (!prefix || !secret || !/^cra_sbom_[a-z0-9]{8}$/.test(prefix))
      return null;
    const result = await this.tables()
      .from("sbom_ci_credentials")
      .select("id, organization_id, token_salt, token_hash, status")
      .eq("token_prefix", prefix)
      .maybeSingle();
    if (result.error || !result.data) return null;
    const row = this.record(result.data);
    if (
      row.status !== "active" ||
      typeof row.token_salt !== "string" ||
      typeof row.token_hash !== "string"
    )
      return null;
    const actual = scryptSync(secret, row.token_salt, 32).toString("base64url");
    if (!equal(actual, row.token_hash)) return null;
    const organizationId = string(row.organization_id);
    const credentialId = string(row.id);
    const used = await this.one("record_sbom_ci_credential_use", {
      p_organization_id: organizationId,
      p_credential_id: credentialId,
    });
    if (this.outcome(used, new Set(["recorded", "not_found"])) !== "recorded")
      return null;
    return { organizationId, credentialId };
  }

  async create(
    organizationId: string,
    input: Readonly<{ actorId: string; label: string; idempotencyKey: string }>,
  ) {
    const credentialId = randomUUID();
    const prefix = `cra_sbom_${randomBytes(4).toString("hex")}`;
    const secretValue = randomBytes(32).toString("base64url");
    const salt = randomBytes(16).toString("base64url");
    const hash = scryptSync(secretValue, salt, 32).toString("base64url");
    const row = await this.one("create_sbom_ci_credential_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_credential_id: credentialId,
      p_label: input.label,
      p_token_prefix: prefix,
      p_token_salt: salt,
      p_token_hash: hash,
    });
    if (
      this.outcome(row, new Set(["created", "conflict", "not_found"])) !==
      "created"
    )
      return "conflict" as const;
    return {
      credential: await this.credential(organizationId, credentialId),
      secret: `${prefix}.${secretValue}`,
    };
  }
  async list(organizationId: string): Promise<readonly SbomCiCredential[]> {
    const result = await this.tables()
      .from("sbom_ci_credentials")
      .select(
        "id, organization_id, label, token_prefix, created_at, created_by, revoked_at, revoked_by, last_used_at",
      )
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false });
    if (result.error || !Array.isArray(result.data))
      throw new SbomRepositoryError("unavailable");
    return Object.freeze(
      result.data.map((value) => this.credentialFromRow(value)),
    );
  }
  async revoke(
    organizationId: string,
    input: Readonly<{
      credentialId: string;
      actorId: string;
      idempotencyKey: string;
    }>,
  ) {
    const row = await this.one("revoke_sbom_ci_credential_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_credential_id: input.credentialId,
    });
    if (this.outcome(row, new Set(["revoked", "not_found"])) !== "revoked")
      return "not_found" as const;
    return this.credential(organizationId, input.credentialId);
  }

  private async credential(
    organizationId: string,
    credentialId: string,
  ): Promise<SbomCiCredential> {
    const result = await this.tables()
      .from("sbom_ci_credentials")
      .select(
        "id, organization_id, label, token_prefix, created_at, created_by, revoked_at, revoked_by, last_used_at",
      )
      .eq("organization_id", organizationId)
      .eq("id", credentialId)
      .maybeSingle();
    if (result.error || !result.data)
      throw new SbomRepositoryError("unavailable");
    return this.credentialFromRow(result.data);
  }
  private credentialFromRow(value: unknown): SbomCiCredential {
    const row = credentialRowSchema.parse(value);
    return {
      id: row.id,
      organizationId: row.organization_id,
      label: row.label,
      tokenPrefix: row.token_prefix,
      createdAt: row.created_at,
      createdBy: row.created_by,
      revokedAt: row.revoked_at,
      revokedBy: row.revoked_by,
      lastUsedAt: row.last_used_at,
    };
  }
  private source(value: unknown, storageKey?: string): SbomSource {
    const raw = this.record(value);
    const organizationId = string(raw.organizationId);
    const sourceId = string(raw.id);
    const hash = string(raw.sha256);
    const row = sourceRowSchema.parse({
      ...raw,
      objectKey: storageKey ?? `${organizationId}/${sourceId}/${hash}`,
    });
    return {
      id: row.id,
      organizationId: row.organizationId,
      productId: row.productId,
      releaseId: row.releaseId,
      source: row.source,
      objectKey: row.objectKey,
      filename: row.fileName,
      byteSize: row.byteSize,
      mediaType: row.mediaType,
      sha256: row.sha256,
      status: row.status,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      createdAt: row.createdAt,
      completedAt: row.completedAt,
      ...(row.declaredFormat ? { declaredFormat: row.declaredFormat } : {}),
      ...(row.declaredSpecVersion
        ? { declaredSpecVersion: row.declaredSpecVersion }
        : {}),
      ...(row.supersedesSourceId
        ? { supersedesSourceId: row.supersedesSourceId }
        : {}),
    };
  }
  private job(value: unknown): SbomJob {
    return sbomJobSchema.parse(value);
  }
  private async one(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<ProviderRow> {
    const rows = await this.rows(name, args);
    const [row] = rows;
    if (rows.length !== 1 || !row) throw new SbomRepositoryError("unavailable");
    return row;
  }
  private async rows(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<readonly ProviderRow[]> {
    try {
      const result = await (this.supabase.admin() as unknown as RpcClient).rpc(
        name,
        args,
      );
      if (result.error || !Array.isArray(result.data))
        throw new SbomRepositoryError("unavailable");
      return result.data.map((value) => this.record(value));
    } catch (error) {
      if (error instanceof SbomRepositoryError) throw error;
      throw new SbomRepositoryError("unavailable");
    }
  }
  private tables(): TableClient {
    return this.supabase.admin() as unknown as TableClient;
  }
  private record(value: unknown): ProviderRow {
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new SbomRepositoryError("malformed");
    return value as ProviderRow;
  }
  private outcome<T extends string>(
    row: ProviderRow,
    allowed: ReadonlySet<T>,
  ): T {
    const outcome = row.outcome;
    if (typeof outcome !== "string" || !allowed.has(outcome as T))
      throw new SbomRepositoryError("malformed");
    return outcome as T;
  }
}

export class SbomRepositoryError extends Error {
  constructor(readonly code: "malformed" | "unavailable") {
    super(code);
  }
}
export function sbomRequestDigest(
  input: Pick<
    Parameters<SbomIntakeRepository["reserve"]>[1],
    | "productId"
    | "releaseId"
    | "filename"
    | "byteSize"
    | "mediaType"
    | "sha256"
    | "source"
    | "idempotencyKey"
    | "declaredFormat"
    | "declaredSpecVersion"
    | "supersedesSourceId"
  >,
): string {
  // The idempotency request fingerprint is client-visible intake metadata only.
  // Server-generated correlation IDs and verified principal/tenant identity are
  // intentionally excluded so a retry is stable across requests.
  return createHash("sha256")
    .update(
      JSON.stringify({
        productId: input.productId,
        releaseId: input.releaseId,
        filename: input.filename,
        byteSize: input.byteSize,
        mediaType: input.mediaType,
        sha256: input.sha256,
        source: input.source,
        idempotencyKey: input.idempotencyKey,
        declaredFormat: input.declaredFormat ?? null,
        declaredSpecVersion: input.declaredSpecVersion ?? null,
        supersedesSourceId: input.supersedesSourceId ?? null,
      }),
    )
    .digest("hex");
}
function string(value: unknown): string {
  if (typeof value !== "string") throw new SbomRepositoryError("malformed");
  return value;
}
function number(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : fallback;
}
function equal(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.byteLength === b.byteLength && timingSafeEqual(a, b);
}
