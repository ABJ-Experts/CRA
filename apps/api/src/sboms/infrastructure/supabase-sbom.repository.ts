import {
  createHash,
  randomBytes,
  randomUUID,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

import { Injectable } from "@nestjs/common";
import {
  sbomComponentSearchResponseSchema,
  sbomCompositeGenerationResponseSchema,
  sbomCompositeReviewResponseSchema,
  sbomDependencyTreeResponseSchema,
  sbomDiffComponentsResponseSchema,
  sbomDiffFindingsResponseSchema,
  sbomDiffReportSchema,
  sbomDiffReportResponseSchema,
  sbomDiffStartResponseSchema,
  sbomDocumentDetailResponseSchema,
  sbomDocumentListResponseSchema,
  sbomJobSchema,
  sbomQualityDimensionSchema,
  sbomQualityFindingsResponseSchema,
  sbomQualityInputsSchema,
  sbomQualityReportResponseSchema,
  sbomQualitySettingsResponseSchema,
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
  SupplierSbomInvitation,
  SupplierSbomRepository,
  SupplierSbomRequest,
  SupplierSbomSession,
  SupplierSbomSubmission,
} from "../application/supplier-sbom-use-cases";
import type { SbomNormalizationRepository } from "../application/sbom-normalization-use-cases";
import type { SbomQualityRepository } from "../application/sbom-quality-use-cases";
import type { SbomDiffRepository } from "../application/sbom-diff-use-cases";
import type { SbomCompositeRepository } from "../application/sbom-composite-use-cases";
import {
  SBOM_COMPOSITE_MERGE_RULES_VERSION,
  stableCompositeInputDigest,
} from "../application/sbom-composite-policy";
import type {
  SbomIngestClaim,
  SbomIngestQueue,
} from "../worker/sbom-ingest-worker";
import type {
  SbomCompositeClaim,
  SbomCompositeQueue,
} from "../worker/sbom-composite-worker";
import type {
  SbomQualityClaim,
  SbomQualityFactPage,
  SbomQualityFindingDraft,
  SbomQualityQueue,
  SbomQualityReportDraft,
} from "../worker/sbom-quality-worker";
import type {
  SbomDiffClaim,
  SbomDiffComponentFact,
  SbomDiffFactPage,
  SbomDiffQueue,
  SbomDiffChangeDraft,
} from "../worker/sbom-diff-worker";
import type { SbomNormalizationBatch } from "../normalization/sbom-normalizer";

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
const qualityClaimSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    releaseId: z.uuid(),
    documentId: z.uuid(),
    configurationVersion: z.number().int().nonnegative().optional(),
    configVersion: z.number().int().nonnegative().optional(),
    bsiProfile: z
      .object({
        enabled: z.boolean(),
        rulesetVersion: z.string().min(1),
      })
      .partial()
      .optional(),
    profile: z
      .object({
        enabled: z.boolean(),
        rulesetVersion: z.string().min(1),
      })
      .partial()
      .optional(),
    baseline: z.unknown().optional(),
  })
  .passthrough();
const qualityFactPageSchema = z
  .object({
    components: z.array(
      z
        .object({
          canonicalPurl: z.string().nullable(),
          hashes: z.array(
            z.object({ algorithm: z.string(), value: z.string() }).strict(),
          ),
          supplier: z.string().nullable().optional(),
          supplierValues: z.array(z.string()).optional(),
          licenseExpression: z.string().nullable().optional(),
          licenseValues: z.array(z.string()).optional(),
          depth: z.number().int().nonnegative(),
        })
        .strict(),
    ),
    primaryComponent: z
      .object({
        id: z.uuid(),
        directDependencyCount: z.number().int().nonnegative(),
      })
      .strict()
      .nullable(),
    maximumDepth: z.number().int().nonnegative(),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
const qualityResultSchema = z
  .object({
    formulaVersion: z.literal("sbom-quality.v1"),
    inputs: sbomQualityInputsSchema,
    dimensions: z.array(sbomQualityDimensionSchema),
    totalScore: z.number().min(0).max(100),
  })
  .passthrough();
const diffClaimSchema = z
  .object({
    id: z.uuid(),
    sourceId: z.uuid(),
    baselineSourceId: z.uuid(),
    documentId: z.uuid(),
    baselineDocumentId: z.uuid(),
    checkpoint: z.record(z.string(), z.string()).optional(),
  })
  .passthrough();
const diffFactPageSchema = z
  .object({
    items: z.array(
      z
        .object({
          componentId: z.uuid(),
          packageIdentity: z.string().min(1).nullable(),
          canonicalPurl: z.string().min(1).nullable(),
          normalizedVersion: z.string().nullable(),
          ecosystem: z.string().nullable(),
          sourceOffset: z.number().int().nonnegative(),
        })
        .passthrough(),
    ),
    nextCursor: z.string().min(1).nullable(),
  })
  .strict();
const compositeClaimSchema = z
  .object({
    reviewId: z.uuid(),
    actorId: z.uuid(),
    productId: z.uuid(),
    releaseId: z.uuid(),
    mergeRulesVersion: z.string().min(1),
    generatedSourceId: z.uuid().nullable().default(null),
    components: z.array(
      z
        .object({
          componentRef: z.string().min(1),
          name: z.string().min(1),
          version: z.string().nullable(),
          canonicalPurl: z.string().nullable(),
          canonicalCpe: z.string().nullable(),
          hashes: z.array(
            z.object({
              algorithm: z.string().min(1),
              value: z.string().min(1),
            }),
          ),
        })
        .strict(),
    ),
    dependencies: z.array(
      z
        .object({ fromRef: z.string().min(1), toRef: z.string().min(1) })
        .strict(),
    ),
  })
  .strict();

/** Service-role adapter: every access starts with organizationId and parses provider JSON. */
@Injectable()
export class SupabaseSbomRepository
  implements
    SbomIntakeRepository,
    SbomNormalizationRepository,
    SbomQualityRepository,
    SbomDiffRepository,
    SbomCompositeRepository,
    SbomCiCredentialPort,
    SupplierSbomRepository,
    SbomIngestQueue,
    SbomQualityQueue,
    SbomDiffQueue,
    SbomCompositeQueue
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

  async createRequest(
    organizationId: string,
    input: Parameters<SupplierSbomRepository["createRequest"]>[1],
  ): Promise<Awaited<ReturnType<SupplierSbomRepository["createRequest"]>>> {
    const row = await this.one("create_supplier_sbom_request_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: randomUUID(),
      p_product_id: input.productId,
      p_release_id: input.releaseId,
      p_supplier_display_name: input.supplierDisplayName,
      p_allowed_component_ref: input.allowedComponentRef,
      p_expires_at: input.expiresAt,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: supplierRequestDigest(input),
      p_correlation_id: correlationFromIdempotency(input.idempotencyKey),
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
    return { outcome, request: supplierRequest(row.request) };
  }

  async listRequests(
    organizationId: string,
    input: Parameters<SupplierSbomRepository["listRequests"]>[1],
  ): Promise<Awaited<ReturnType<SupplierSbomRepository["listRequests"]>>> {
    const row = await this.one("list_supplier_sbom_requests", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_product_id: input.productId ?? null,
      p_release_id: input.releaseId ?? null,
      p_state: input.state ?? null,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found") {
      return { outcome: "not_found" };
    }
    const requests = supplierArray(row.requests).map((item) => {
      const summary = supplierRecord(item);
      return Object.freeze({
        request: supplierRequest(summary.request),
        invitations: Object.freeze(
          supplierArray(summary.invitations).map(supplierInvitation),
        ),
        submissions: Object.freeze(
          supplierArray(summary.submissions).map(supplierSubmission),
        ),
      });
    });
    return Object.freeze({
      outcome: "found" as const,
      requests: Object.freeze(requests),
      nextCursor: typeof row.next_cursor === "string" ? row.next_cursor : null,
    });
  }

  async createInvitation(
    organizationId: string,
    input: Parameters<SupplierSbomRepository["createInvitation"]>[1],
  ): Promise<Awaited<ReturnType<SupplierSbomRepository["createInvitation"]>>> {
    const token = opaqueToken();
    const row = await this.one("create_supplier_sbom_invitation_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: input.requestId,
      p_invitation_id: randomUUID(),
      p_token_hash: tokenHash(token),
      p_expires_at: input.expiresAt,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: supplierInvitationDigest(input),
      p_correlation_id: correlationFromIdempotency(input.idempotencyKey),
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
    // A replay can never return a newly generated bearer token.  Callers must
    // retain the token from the original response, which prevents token replay
    // over an idempotency route from becoming a credential disclosure channel.
    return {
      outcome,
      invitation: supplierInvitation(row.invitation),
      ...(outcome === "created" ? { invitationToken: token } : {}),
    } as Awaited<ReturnType<SupplierSbomRepository["createInvitation"]>>;
  }

  async exchangeInvitation(
    input: Parameters<SupplierSbomRepository["exchangeInvitation"]>[0],
  ): Promise<
    Awaited<ReturnType<SupplierSbomRepository["exchangeInvitation"]>>
  > {
    // M9 generates this second opaque bearer before exchange. The database
    // stores only its digest, atomically binds it to the consumed invitation,
    // and permits a retry only when the same digest is supplied.
    const sessionToken = input.sessionToken;
    const row = await this.one("consume_supplier_sbom_invitation_atomic", {
      p_token_hash: tokenHash(input.invitationToken),
      p_session_token_hash: tokenHash(sessionToken),
      p_session_expires_at: new Date(
        Date.now() + 15 * 60 * 1_000,
      ).toISOString(),
    });
    const outcome = this.outcome(
      row,
      new Set(["created", "not_found", "conflict", "idempotency_mismatch"]),
    );
    if (outcome !== "created")
      return {
        outcome: outcome as "not_found" | "conflict" | "idempotency_mismatch",
      };
    return {
      outcome: "created",
      session: supplierSession(row.session, sessionToken),
    };
  }

  async reserveUpload(
    input: Parameters<SupplierSbomRepository["reserveUpload"]>[0],
  ): Promise<Awaited<ReturnType<SupplierSbomRepository["reserveUpload"]>>> {
    const sourceId = randomUUID();
    const row = await this.one("reserve_supplier_sbom_submission_atomic", {
      p_session_token_hash: tokenHash(input.sessionToken),
      p_submission_id: randomUUID(),
      p_source_id: sourceId,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: supplierUploadDigest(input),
      p_original_filename: input.filename,
      p_declared_media_type: input.mediaType,
      p_declared_byte_size: input.byteSize,
      p_declared_sha256: input.sha256,
      p_correlation_id: input.correlationId,
      p_declared_format: input.declaredFormat ?? null,
      p_declared_spec_version: input.declaredSpecVersion ?? null,
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
    return {
      outcome,
      reservation: this.source(row.source),
      submission: supplierSubmission(row.submission),
    };
  }

  async getUploadForCompletion(
    input: Parameters<SupplierSbomRepository["getUploadForCompletion"]>[0],
  ): Promise<
    Awaited<ReturnType<SupplierSbomRepository["getUploadForCompletion"]>>
  > {
    const row = await this.one("get_supplier_sbom_submission_upload", {
      p_session_token_hash: tokenHash(input.sessionToken),
      p_source_id: input.sourceId,
      p_idempotency_key: input.idempotencyKey,
    });
    const outcome = this.outcome(
      row,
      new Set(["ready", "replayed", "not_found", "conflict"]),
    );
    if (outcome !== "ready" && outcome !== "replayed")
      return { outcome: outcome as "not_found" | "conflict" };
    return { outcome, reservation: this.source(row.source) };
  }

  async completeUpload(
    input: Parameters<SupplierSbomRepository["completeUpload"]>[0],
  ): Promise<Awaited<ReturnType<SupplierSbomRepository["completeUpload"]>>> {
    const row = await this.one("finalize_supplier_sbom_submission_atomic", {
      p_session_token_hash: tokenHash(input.sessionToken),
      p_source_id: input.sourceId,
      p_idempotency_key: input.idempotencyKey,
      p_actual_sha256: input.actualHash,
      p_actual_byte_size: input.actualByteSize,
      p_actual_media_type: input.actualMediaType,
      p_correlation_id: input.correlationId,
    });
    const outcome = this.outcome(
      row,
      new Set([
        "queued",
        "replayed",
        "deduplicated",
        "not_found",
        "conflict",
        "idempotency_mismatch",
      ]),
    );
    if (
      outcome !== "queued" &&
      outcome !== "replayed" &&
      outcome !== "deduplicated"
    )
      return {
        outcome: outcome as "not_found" | "conflict" | "idempotency_mismatch",
      };
    return {
      outcome,
      job: this.job(row.job),
      submission: supplierSubmission(row.submission),
    };
  }

  async reviewSubmission(
    organizationId: string,
    input: Parameters<SupplierSbomRepository["reviewSubmission"]>[1],
  ): Promise<Awaited<ReturnType<SupplierSbomRepository["reviewSubmission"]>>> {
    const row = await this.one("review_supplier_sbom_submission_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_submission_id: input.submissionId,
      p_decision: input.decision === "accepted" ? "accept" : "reject",
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: correlationFromIdempotency(input.idempotencyKey),
    });
    const outcome = this.outcome(
      row,
      new Set([
        "accepted",
        "rejected",
        "replayed",
        "not_found",
        "conflict",
        "idempotency_mismatch",
        "invalid_request",
      ]),
    );
    if (
      outcome !== "accepted" &&
      outcome !== "rejected" &&
      outcome !== "replayed"
    )
      return {
        outcome: outcome as
          "not_found" | "conflict" | "idempotency_mismatch" | "invalid_request",
      };
    return { outcome, submission: supplierSubmission(row.submission) };
  }

  async getSource(
    organizationId: string,
    sourceId: string,
  ): Promise<SbomSource | null> {
    try {
      const result = await this.tables()
        .from("sbom_sources")
        .select(
          "id, organization_id, product_id, release_id, source_kind, original_filename, declared_media_type, declared_byte_size, declared_sha256, status, staging_storage_key, upload_expires_at, declared_format, declared_spec_version, supersedes_source_id, deduplicated_from_source_id, created_at, verified_at",
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
        deduplicatedFromSourceId:
          typeof row.deduplicated_from_source_id === "string"
            ? row.deduplicated_from_source_id
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
    const row = await this.one("finalize_sbom_source_deduplicated_atomic", {
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
        "deduplicated",
        "replayed",
        "not_found",
        "conflict",
        "idempotency_mismatch",
        "invalid_state",
        "expired",
        "integrity_mismatch",
      ]),
    );
    if (
      outcome !== "queued" &&
      outcome !== "deduplicated" &&
      outcome !== "replayed"
    )
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

  async listDocuments(
    organizationId: string,
    input: Parameters<SbomNormalizationRepository["listDocuments"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomNormalizationRepository["listDocuments"]>>
  > {
    const row = await this.one("list_sbom_documents_for_release", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_product_id: input.productId,
      p_release_id: input.releaseId,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomDocumentListResponseSchema.parse(row.result);
  }

  async getDocument(
    organizationId: string,
    input: Parameters<SbomNormalizationRepository["getDocument"]>[1],
  ): Promise<Awaited<ReturnType<SbomNormalizationRepository["getDocument"]>>> {
    const row = await this.one("get_sbom_document", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_document_id: input.documentId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomDocumentDetailResponseSchema.parse(row.result);
  }

  async searchComponents(
    organizationId: string,
    input: Parameters<SbomNormalizationRepository["searchComponents"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomNormalizationRepository["searchComponents"]>>
  > {
    const row = await this.one("search_sbom_components", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_document_id: input.documentId,
      p_q: input.q ?? null,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomComponentSearchResponseSchema.parse(row.result);
  }

  async listDependencyTree(
    organizationId: string,
    input: Parameters<SbomNormalizationRepository["listDependencyTree"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomNormalizationRepository["listDependencyTree"]>>
  > {
    const row = await this.one("list_sbom_dependency_tree", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_document_id: input.documentId,
      p_parent_component_id: input.parentComponentId ?? null,
      p_q: input.q ?? null,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomDependencyTreeResponseSchema.parse(row.result);
  }

  async getQualityReport(
    organizationId: string,
    input: Parameters<SbomQualityRepository["getQualityReport"]>[1],
  ): Promise<Awaited<ReturnType<SbomQualityRepository["getQualityReport"]>>> {
    const row = await this.one("get_sbom_quality_report", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_source_id: input.sourceId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomQualityReportResponseSchema.parse(row.result);
  }

  async listQualityFindings(
    organizationId: string,
    input: Parameters<SbomQualityRepository["listQualityFindings"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomQualityRepository["listQualityFindings"]>>
  > {
    const row = await this.one("list_sbom_quality_findings", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_source_id: input.sourceId,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
      p_severity: input.severity ?? null,
      p_kind: input.kind ?? null,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomQualityFindingsResponseSchema.parse(row.result);
  }

  async getQualitySettings(
    organizationId: string,
    input: Parameters<SbomQualityRepository["getQualitySettings"]>[1],
  ): Promise<Awaited<ReturnType<SbomQualityRepository["getQualitySettings"]>>> {
    const row = await this.one("get_sbom_quality_settings", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomQualitySettingsResponseSchema.parse(row.result);
  }

  async updateQualitySettings(
    organizationId: string,
    input: Parameters<SbomQualityRepository["updateQualitySettings"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomQualityRepository["updateQualitySettings"]>>
  > {
    const row = await this.one("update_sbom_quality_settings_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_expected_version: input.expectedVersion,
      p_bsi_profile_enabled: input.bsiProfileEnabled,
      p_idempotency_key: input.idempotencyKey ?? null,
    });
    const outcome = this.outcome(
      row,
      new Set<"updated" | "not_found" | "conflict">([
        "updated",
        "not_found",
        "conflict",
      ]),
    );
    if (outcome !== "updated") return { outcome };
    return {
      outcome,
      response: sbomQualitySettingsResponseSchema.parse(row.result),
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

  async dueQualityOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.rows("list_due_sbom_quality_organizations", {
      p_limit: 500,
    });
    return Object.freeze(
      rows.flatMap((row) =>
        typeof row.organization_id === "string" ? [row.organization_id] : [],
      ),
    );
  }

  async claimQualityReport(
    organizationId: string,
    input: Parameters<SbomQualityQueue["claimQualityReport"]>[1],
  ): Promise<SbomQualityClaim> {
    const row = await this.one("claim_sbom_quality_report", {
      p_organization_id: organizationId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });
    const outcome = this.outcome(
      row,
      new Set(["claimed", "empty", "invalid_request"]),
    );
    if (outcome !== "claimed") return { outcome: "none_available" };
    return qualityClaim(organizationId, row.work);
  }

  async readQualityFactPage(
    organizationId: string,
    input: Parameters<SbomQualityQueue["readQualityFactPage"]>[1],
  ): Promise<SbomQualityFactPage> {
    const row = await this.one("list_sbom_quality_component_facts", {
      p_organization_id: organizationId,
      p_report_id: input.reportId,
      p_document_id: input.documentId,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    if (this.outcome(row, new Set(["found"])) !== "found")
      throw new SbomRepositoryError("unavailable");
    return qualityFactPage(row.result);
  }

  async persistQualityReport(
    organizationId: string,
    input: Parameters<SbomQualityQueue["persistQualityReport"]>[1],
  ): Promise<void> {
    const row = await this.one("persist_sbom_quality_report_atomic", {
      p_organization_id: organizationId,
      p_report_id: input.reportId,
      p_worker_id: input.workerId,
      p_report: persistableQualityReport(input.report),
      p_findings: input.findings.map(persistableQualityFinding),
      p_complete: true,
    });
    if (this.outcome(row, new Set(["completed"])) !== "completed")
      throw new SbomRepositoryError("unavailable");
  }

  async failQualityReport(
    organizationId: string,
    input: Parameters<SbomQualityQueue["failQualityReport"]>[1],
  ): Promise<void> {
    const row = await this.one("fail_sbom_quality_report", {
      p_organization_id: organizationId,
      p_report_id: input.reportId,
      p_worker_id: input.workerId,
      p_error_code: input.errorCode,
      p_error_message: input.message,
    });
    if (this.outcome(row, new Set(["failed"])) !== "failed")
      throw new SbomRepositoryError("unavailable");
  }

  async createDiff(
    organizationId: string,
    input: Parameters<SbomDiffRepository["createDiff"]>[1],
  ): Promise<Awaited<ReturnType<SbomDiffRepository["createDiff"]>>> {
    let baselineSourceId = input.baseSourceId;
    if (!baselineSourceId) {
      const baseline = await this.one("resolve_sbom_diff_baseline", {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_source_id: input.sourceId,
      });
      const baselineOutcome = this.outcome(
        baseline,
        new Set(["found", "no_comparable_version", "not_found"]),
      );
      if (baselineOutcome === "no_comparable_version") {
        return { outcome: "no_comparable_version" };
      }
      if (baselineOutcome === "not_found") return { outcome: "not_found" };
      const result = this.record(baseline.result);
      baselineSourceId =
        typeof result.baselineSourceId === "string"
          ? result.baselineSourceId
          : undefined;
      if (!baselineSourceId) return { outcome: "no_comparable_version" };
    }
    const row = await this.one("enqueue_sbom_diff_report_atomic", {
      p_organization_id: organizationId,
      p_source_id: input.sourceId,
      p_baseline_source_id: baselineSourceId,
    });
    const outcome = this.outcome(
      row,
      new Set(["queued", "completed", "no_comparable_version", "not_found"]),
    );
    if (outcome === "no_comparable_version") return { outcome };
    if (outcome === "not_found") return { outcome };
    const response = sbomDiffStartResponseSchema.parse({
      status: "queued",
      report: diffReport(row.report),
      replayed: outcome === "completed",
    });
    return {
      outcome: outcome === "completed" ? "replayed" : "created",
      response,
    };
  }

  async getSourceDiff(
    organizationId: string,
    input: Parameters<SbomDiffRepository["getSourceDiff"]>[1],
  ): Promise<Awaited<ReturnType<SbomDiffRepository["getSourceDiff"]>>> {
    const row = await this.one("get_sbom_source_diff_report", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_source_id: input.sourceId,
      p_baseline_source_id: input.baseSourceId ?? null,
    });
    const outcome = this.outcome(
      row,
      new Set(["found", "not_started", "no_comparable_version", "not_found"]),
    );
    if (outcome === "not_found") return null;
    if (outcome === "no_comparable_version") {
      return {
        status: "no_comparable_version",
        sourceId: input.sourceId,
        reason:
          "No completed, comparable predecessor exists in this release lineage.",
      };
    }
    if (outcome === "not_started") {
      const result = this.record(row.result);
      return {
        status: "not_started",
        sourceId: input.sourceId,
        baselineSourceId: string(result.baselineSourceId),
      };
    }
    const report = row.report ?? this.record(row.result).report;
    return { status: "found", report: diffReport(report) };
  }

  async getDiff(
    organizationId: string,
    input: Parameters<SbomDiffRepository["getDiff"]>[1],
  ): Promise<Awaited<ReturnType<SbomDiffRepository["getDiff"]>>> {
    const row = await this.one("get_sbom_diff_report", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_report_id: input.diffId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomDiffReportResponseSchema.parse({
      report: diffReport(this.record(row.result).report),
    });
  }

  async listComponentChanges(
    organizationId: string,
    input: Parameters<SbomDiffRepository["listComponentChanges"]>[1],
  ): Promise<Awaited<ReturnType<SbomDiffRepository["listComponentChanges"]>>> {
    const row = await this.one("list_sbom_diff_component_changes", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_report_id: input.diffId,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
      p_change_type: input.change ?? null,
      p_ecosystem: input.ecosystem ?? null,
      p_q: input.q ?? null,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    return sbomDiffComponentsResponseSchema.parse(this.record(row.result));
  }

  async getFindingDelta(
    organizationId: string,
    input: Parameters<SbomDiffRepository["getFindingDelta"]>[1],
  ): Promise<Awaited<ReturnType<SbomDiffRepository["getFindingDelta"]>>> {
    const row = await this.one("get_sbom_diff_findings", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_report_id: input.diffId,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found")
      return null;
    const result = this.record(row.result);
    return sbomDiffFindingsResponseSchema.parse({
      status: result.state,
      reason:
        result.state === "partial_integration_unavailable"
          ? "Finding delta requires the M4 advisory integration."
          : null,
      findings: result.items,
      nextCursor:
        typeof result.nextCursor === "string" ? result.nextCursor : null,
    });
  }

  async retryDiff(
    organizationId: string,
    input: Parameters<SbomDiffRepository["retryDiff"]>[1],
  ): Promise<Awaited<ReturnType<SbomDiffRepository["retryDiff"]>>> {
    const row = await this.one("retry_sbom_diff_report_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_report_id: input.diffId,
      p_idempotency_key: input.idempotencyKey,
    });
    const outcome = this.outcome(
      row,
      new Set(["queued", "completed", "not_found"]),
    );
    if (outcome === "not_found") return { outcome };
    const response = sbomDiffStartResponseSchema.parse({
      status: "queued",
      report: diffReport(row.report),
      replayed: outcome === "completed",
    });
    return {
      outcome: outcome === "completed" ? "replayed" : "queued",
      response,
    };
  }

  async createReview(
    organizationId: string,
    input: Parameters<SbomCompositeRepository["createReview"]>[1],
  ): Promise<Awaited<ReturnType<SbomCompositeRepository["createReview"]>>> {
    const inputSetDigest = sha256(
      stableCompositeInputDigest(
        input.sourceIds.map((sourceId) => ({
          sourceId,
          documentId: sourceId,
          sourceDocumentHash: sourceId,
        })),
      ),
    );
    const row = await this.one("create_sbom_composite_review_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_review_id: randomUUID(),
      p_product_id: input.productId,
      p_release_id: input.releaseId,
      p_merge_rules_version: SBOM_COMPOSITE_MERGE_RULES_VERSION,
      p_input_set_digest: inputSetDigest,
      p_inputs: input.sourceIds.map((sourceId) => ({ sourceId })),
      p_correlation_id: randomUUID(),
    });
    const outcome = this.outcome(
      row,
      new Set([
        "created",
        "replayed",
        "not_found",
        "conflict",
        "invalid_request",
      ]),
    );
    if (outcome === "created" || outcome === "replayed") {
      const createdReview = compositeReviewResponse(row.review);
      if (outcome === "replayed") {
        return { outcome, response: createdReview };
      }
      // Creation persists the immutable input set first.  The projection is a
      // separate, idempotent database operation so field-level conflicts and
      // provenance are always materialized from the completed source graph,
      // never from client supplied display values.
      const projection = await this.one(
        "refresh_sbom_composite_review_projection_atomic",
        {
          p_organization_id: organizationId,
          p_review_id: createdReview.review.id,
        },
      );
      if (
        this.outcome(projection, new Set(["refreshed", "not_found"])) !==
        "refreshed"
      ) {
        return { outcome: "not_found" };
      }
      return { outcome, response: compositeReviewResponse(projection.review) };
    }
    return {
      outcome:
        outcome === "not_found"
          ? "not_found"
          : outcome === "invalid_request"
            ? "invalid_request"
            : "conflict",
    };
  }

  async validateScope(
    organizationId: string,
    input: Parameters<SbomCompositeRepository["validateScope"]>[1],
  ): Promise<Awaited<ReturnType<SbomCompositeRepository["validateScope"]>>> {
    const row = await this.one("validate_sbom_composite_scope", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_product_id: input.productId,
      p_release_id: input.releaseId,
      p_source_ids: input.sourceIds,
    });
    return this.outcome(
      row,
      new Set<"compatible" | "not_found" | "conflict">([
        "compatible",
        "not_found",
        "conflict",
      ]),
    );
  }

  async getReview(
    organizationId: string,
    input: Parameters<SbomCompositeRepository["getReview"]>[1],
  ): Promise<Awaited<ReturnType<SbomCompositeRepository["getReview"]>>> {
    const row = await this.one("get_sbom_composite_review", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_review_id: input.reviewId,
    });
    if (this.outcome(row, new Set(["found", "not_found"])) !== "found") {
      return null;
    }
    return compositeReviewResponse(row.review);
  }

  async resolveConflict(
    organizationId: string,
    input: Parameters<SbomCompositeRepository["resolveConflict"]>[1],
  ): Promise<Awaited<ReturnType<SbomCompositeRepository["resolveConflict"]>>> {
    const row = await this.one("resolve_sbom_composite_conflict_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_review_id: input.reviewId,
      p_conflict_id: input.conflictId,
      p_selected_source_component_id:
        input.decision === "select_source_component"
          ? input.selectedComponentId
          : null,
      p_decision: input.decision,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: randomUUID(),
    });
    const outcome = this.outcome(
      row,
      new Set([
        "resolved",
        "replayed",
        "not_found",
        "conflict",
        "invalid_request",
      ]),
    );
    if (outcome === "resolved" || outcome === "replayed") {
      return { outcome, response: compositeReviewResponse(row.review) };
    }
    return {
      outcome:
        outcome === "not_found"
          ? "not_found"
          : outcome === "invalid_request"
            ? "invalid_request"
            : "conflict",
    };
  }

  async resolveRelationship(
    organizationId: string,
    input: Parameters<SbomCompositeRepository["resolveRelationship"]>[1],
  ): Promise<
    Awaited<ReturnType<SbomCompositeRepository["resolveRelationship"]>>
  > {
    const row = await this.one("resolve_sbom_composite_relationship_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_review_id: input.reviewId,
      p_relationship_id: input.relationshipId,
      p_disposition: input.decision,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: randomUUID(),
    });
    const outcome = this.outcome(
      row,
      new Set([
        "resolved",
        "replayed",
        "not_found",
        "conflict",
        "invalid_request",
      ]),
    );
    if (outcome === "resolved" || outcome === "replayed") {
      return { outcome, response: compositeReviewResponse(row.review) };
    }
    return {
      outcome:
        outcome === "not_found"
          ? "not_found"
          : outcome === "invalid_request"
            ? "invalid_request"
            : "conflict",
    };
  }

  async generate(
    organizationId: string,
    input: Parameters<SbomCompositeRepository["generate"]>[1],
  ): Promise<Awaited<ReturnType<SbomCompositeRepository["generate"]>>> {
    const row = await this.one("generate_sbom_composite_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_review_id: input.reviewId,
      p_idempotency_key: input.idempotencyKey,
      p_correlation_id: randomUUID(),
    });
    const outcome = this.outcome(
      row,
      new Set([
        "queued",
        "claimed",
        "replayed",
        "not_found",
        "conflict",
        "invalid_request",
        "invalid_state",
      ]),
    );
    if (
      outcome === "queued" ||
      outcome === "claimed" ||
      outcome === "replayed"
    ) {
      return {
        outcome: outcome === "replayed" ? "replayed" : "queued",
        response: compositeGenerationResponse(
          row.review,
          outcome === "replayed",
        ),
      };
    }
    return {
      outcome:
        outcome === "invalid_state"
          ? "conflict"
          : outcome === "not_found"
            ? "not_found"
            : outcome === "invalid_request"
              ? "invalid_request"
              : "conflict",
    };
  }

  async dueCompositeOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.rows(
      "list_due_sbom_composite_generation_organizations",
      { p_limit: 500 },
    );
    return Object.freeze(
      rows.flatMap((row) =>
        typeof row.organization_id === "string" ? [row.organization_id] : [],
      ),
    );
  }

  async claimCompositeGeneration(
    organizationId: string,
    input: Parameters<SbomCompositeQueue["claimCompositeGeneration"]>[1],
  ): Promise<SbomCompositeClaim> {
    const row = await this.one("claim_sbom_composite_generation", {
      p_organization_id: organizationId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });
    const outcome = this.outcome(
      row,
      new Set(["claimed", "empty", "conflict", "invalid_request"]),
    );
    if (outcome !== "claimed") {
      return {
        outcome: outcome === "conflict" ? "conflict" : "none_available",
      };
    }
    const work = compositeClaimSchema.parse(row.work);
    return Object.freeze({ outcome: "claimed", organizationId, ...work });
  }

  async attachGeneratedSource(
    organizationId: string,
    input: Parameters<SbomCompositeQueue["attachGeneratedSource"]>[1],
  ): Promise<void> {
    const row = await this.one(
      "attach_sbom_composite_generated_source_atomic",
      {
        p_organization_id: organizationId,
        p_review_id: input.reviewId,
        p_worker_id: input.workerId,
        p_source_id: input.sourceId,
      },
    );
    if (
      this.outcome(row, new Set(["attached", "replayed", "not_found"])) ===
      "not_found"
    )
      throw new SbomRepositoryError("unavailable");
  }

  async reconcileCompositeGeneration(
    organizationId: string,
    input: Parameters<SbomCompositeQueue["reconcileCompositeGeneration"]>[1],
  ): Promise<void> {
    const row = await this.one("reconcile_sbom_composite_generation_atomic", {
      p_organization_id: organizationId,
      p_review_id: input.reviewId,
      p_worker_id: input.workerId,
    });
    if (
      this.outcome(
        row,
        new Set(["pending", "completed", "failed", "not_found"]),
      ) === "not_found"
    )
      throw new SbomRepositoryError("unavailable");
  }

  async failCompositeGeneration(
    organizationId: string,
    input: Parameters<SbomCompositeQueue["failCompositeGeneration"]>[1],
  ): Promise<void> {
    const row = await this.one("fail_sbom_composite_generation_atomic", {
      p_organization_id: organizationId,
      p_review_id: input.reviewId,
      p_worker_id: input.workerId,
      p_error_code: input.errorCode,
      p_message: input.message,
    });
    if (
      this.outcome(row, new Set(["failed", "not_found", "invalid_request"])) !==
      "failed"
    )
      throw new SbomRepositoryError("unavailable");
  }

  async dueDiffOrganizationIds(): Promise<readonly string[]> {
    const rows = await this.rows("list_due_sbom_diff_organizations", {
      p_limit: 500,
    });
    return Object.freeze(
      rows.flatMap((row) =>
        typeof row.organization_id === "string" ? [row.organization_id] : [],
      ),
    );
  }

  async claimDiffReport(
    organizationId: string,
    input: Parameters<SbomDiffQueue["claimDiffReport"]>[1],
  ): Promise<SbomDiffClaim> {
    const row = await this.one("claim_sbom_diff_report", {
      p_organization_id: organizationId,
      p_worker_id: input.workerId,
      p_lease_seconds: input.leaseSeconds,
    });
    if (
      this.outcome(row, new Set(["claimed", "empty", "invalid_request"])) !==
      "claimed"
    ) {
      return { outcome: "none_available" };
    }
    const work = diffClaimSchema.parse(row.work);
    return {
      outcome: "claimed",
      organizationId,
      reportId: work.id,
      sourceId: work.sourceId,
      baselineSourceId: work.baselineSourceId,
      documentId: work.documentId,
      baselineDocumentId: work.baselineDocumentId,
      checkpoint: Object.freeze({
        currentCursor: work.checkpoint?.currentCursor,
        baselineCursor: work.checkpoint?.baselineCursor,
      }),
    };
  }

  async readDiffFactPage(
    organizationId: string,
    input: Parameters<SbomDiffQueue["readDiffFactPage"]>[1],
  ): Promise<SbomDiffFactPage> {
    const row = await this.one("list_sbom_diff_component_facts", {
      p_organization_id: organizationId,
      p_report_id: input.reportId,
      p_worker_id: input.workerId,
      p_side: input.side,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    if (this.outcome(row, new Set(["found"])) !== "found") {
      throw new SbomRepositoryError("unavailable");
    }
    const page = diffFactPageSchema.parse(row.result);
    return Object.freeze({
      facts: Object.freeze(page.items.map(diffFact)),
      nextCursor: page.nextCursor,
    });
  }

  async persistDiffBatch(
    organizationId: string,
    input: Parameters<SbomDiffQueue["persistDiffBatch"]>[1],
  ): Promise<void> {
    const row = await this.one("persist_sbom_diff_batch_atomic", {
      p_organization_id: organizationId,
      p_report_id: input.reportId,
      p_worker_id: input.workerId,
      p_changes: input.changes.map(persistableDiffChange),
      p_checkpoint: input.checkpoint,
      p_complete: input.complete,
    });
    if (
      this.outcome(row, new Set(["persisted", "completed"])) === "persisted" ||
      input.complete
    )
      return;
    throw new SbomRepositoryError("unavailable");
  }

  async failDiffReport(
    organizationId: string,
    input: Parameters<SbomDiffQueue["failDiffReport"]>[1],
  ): Promise<void> {
    const row = await this.one("fail_sbom_diff_report", {
      p_organization_id: organizationId,
      p_report_id: input.reportId,
      p_worker_id: input.workerId,
      p_error_code: input.errorCode,
      p_error_message: input.message,
    });
    if (this.outcome(row, new Set(["failed"])) !== "failed") {
      throw new SbomRepositoryError("unavailable");
    }
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
    const row = await this.one("checkpoint_sbom_ingest_job", {
      p_organization_id: organizationId,
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_progress_stage: input.stage,
      p_progress_percent: input.percent,
      p_lease_seconds: 60,
    });
    if (
      this.outcome(
        row,
        new Set(["checkpointed", "invalid_request", "not_found"]),
      ) !== "checkpointed"
    )
      throw new SbomRepositoryError("unavailable");
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
  async beginNormalization(
    organizationId: string,
    input: Parameters<NonNullable<SbomIngestQueue["beginNormalization"]>>[1],
  ): Promise<
    Readonly<{
      outcome: "ready" | "complete" | "deferred" | "failed";
      documentId?: string;
    }>
  > {
    const row = await this.one("begin_sbom_document_normalization_atomic", {
      p_organization_id: organizationId,
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_parser_name: "CRA streaming SBOM parser",
      p_parser_version: input.report.validator?.version ?? "unknown",
      p_normalizer_name: "CRA SBOM normalizer",
      p_normalizer_version: "m3-03.1",
      p_format: input.format,
      p_serialization: input.serialization,
      p_specification_version: input.specificationVersion,
      p_validation_report: input.report,
    });
    const outcome = this.outcome(
      row,
      new Set([
        "created",
        "resumed",
        "replayed",
        "in_progress",
        "failed",
        "invalid_state",
        "not_found",
      ]),
    );
    if (outcome === "failed") return { outcome: "failed" };
    if (outcome === "in_progress") {
      const document = this.record(row.document);
      return { outcome: "deferred", documentId: string(document.id) };
    }
    if (
      outcome !== "created" &&
      outcome !== "resumed" &&
      outcome !== "replayed"
    )
      throw new SbomRepositoryError("unavailable");
    const document = this.record(row.document);
    return {
      outcome:
        outcome === "replayed" && string(document.state) === "completed"
          ? "complete"
          : "ready",
      documentId: string(document.id),
    };
  }
  async persistNormalizationBatch(
    organizationId: string,
    input: Parameters<
      NonNullable<SbomIngestQueue["persistNormalizationBatch"]>
    >[1],
  ): Promise<void> {
    const row = await this.one("persist_sbom_normalization_batch_atomic", {
      p_organization_id: organizationId,
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_document_id: input.documentId,
      p_components: batchComponents(input.batch),
      p_edges: batchEdges(input.batch),
      p_diagnostics: input.diagnostics,
      p_source_offset: input.sourceOffset,
    });
    if (this.outcome(row, new Set(["persisted", "failed"])) !== "persisted")
      throw new SbomRepositoryError("unavailable");
  }
  async finalizeNormalization(
    organizationId: string,
    input: Parameters<NonNullable<SbomIngestQueue["finalizeNormalization"]>>[1],
  ): Promise<void> {
    const row = await this.one("finalize_sbom_document_normalization_atomic", {
      p_organization_id: organizationId,
      p_job_id: input.jobId,
      p_worker_id: input.workerId,
      p_document_id: input.documentId,
    });
    if (this.outcome(row, new Set(["completed"])) !== "completed")
      throw new SbomRepositoryError("unavailable");
  }
  async fail(
    organizationId: string,
    input: Parameters<SbomIngestQueue["fail"]>[1],
  ): Promise<void> {
    const code =
      input.errorCode === "unavailable"
        ? "provider_unavailable"
        : input.errorCode === "normalization_byte_limit_exceeded"
          ? "normalization_byte_limit_exceeded"
          : input.errorCode === "normalization_component_limit_exceeded"
            ? "normalization_component_limit_exceeded"
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
      ...(row.deduplicatedFromSourceId
        ? { deduplicatedFromSourceId: row.deduplicatedFromSourceId }
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
        throw new SbomRepositoryError(
          "unavailable",
          result.error &&
            typeof result.error === "object" &&
            "code" in result.error
            ? String(result.error.code)
            : null,
        );
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

function batchComponents(
  batch: SbomNormalizationBatch,
): readonly Record<string, unknown>[] {
  return batch.components.map((component) => ({
    document_local_ref:
      component.localRef ?? `component-${component.source.offset}`,
    source_offset: component.source.offset,
    source_byte_end: component.source.offset,
    source_path: component.source.path,
    source_line: component.source.line,
    original_name:
      component.rawName ??
      component.localRef ??
      `component-${component.source.offset}`,
    normalized_name:
      component.normalizedName ??
      component.rawName?.trim().toLowerCase() ??
      component.localRef ??
      `component-${component.source.offset}`,
    original_version: component.rawVersion,
    normalized_version: component.normalizedVersion,
    original_purl: component.rawPurl,
    canonical_purl: component.canonicalPurl,
    cpe: component.rawCpe,
    ecosystem: component.ecosystem,
    scope: component.scope,
    supplier: component.supplier,
    supplier_values: component.supplierValues,
    license_expression: component.licenseExpression,
    license_values: component.licenseValues,
    hashes: component.hashes,
  }));
}

function compositeReviewResponse(value: unknown) {
  return sbomCompositeReviewResponseSchema.parse({ review: value });
}

function compositeGenerationResponse(value: unknown, replayed: boolean) {
  return sbomCompositeGenerationResponseSchema.parse({
    review: value,
    replayed,
  });
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function batchEdges(
  batch: SbomNormalizationBatch,
): readonly Record<string, unknown>[] {
  return batch.edges.map((edge) => ({
    parent_reference: edge.fromRef,
    child_reference: edge.toRef,
    source_offset: edge.source.offset,
    source_byte_end: edge.source.offset,
    source_path: edge.source.path,
    source_line: edge.source.line,
  }));
}

function qualityClaim(
  organizationId: string,
  value: unknown,
): Extract<SbomQualityClaim, { outcome: "claimed" }> {
  const row = qualityClaimSchema.parse(value);
  const profile = row.bsiProfile ?? row.profile;
  return {
    outcome: "claimed",
    organizationId,
    reportId: row.id,
    sourceId: row.sourceId,
    releaseId: row.releaseId,
    documentId: row.documentId,
    profileEnabled: profile?.enabled ?? false,
    rulesetVersion: profile?.rulesetVersion ?? "bsi-tr-03183-2.v2.0.0",
    configurationVersion: row.configurationVersion ?? row.configVersion ?? 0,
    baseline: qualityBaseline(row.baseline),
  };
}

function qualityBaseline(
  value: unknown,
): Extract<SbomQualityClaim, { outcome: "claimed" }>["baseline"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { status: "no_baseline" };
  }
  const row = value as Record<string, unknown>;
  if (row.status === "first_document") return { status: "first_document" };
  if (row.status !== "available") return { status: "no_baseline" };
  const quality = qualityResultSchema.parse(row.quality);
  return {
    status: "available",
    reportId: string(row.reportId),
    sourceId: string(row.sourceId),
    totalScore: number(row.totalScore, 0),
    completedAt: string(row.completedAt),
    quality,
  };
}

function qualityFactPage(value: unknown): SbomQualityFactPage {
  return qualityFactPageSchema.parse(value);
}

function persistableQualityReport(
  report: SbomQualityReportDraft,
): Record<string, unknown> {
  return {
    assessmentStatus: report.assessmentStatus,
    inputs: report.quality.inputs,
    dimensions: report.quality.dimensions,
    weights: Object.fromEntries(
      report.quality.dimensions.map((dimension) => [
        dimension.id,
        dimension.weight,
      ]),
    ),
    totalScore: report.quality.totalScore,
    bsiProfile: report.bsiProfile,
    baseline: report.baseline,
    regression: {
      status: report.regression.status,
      totalScoreDelta: report.regression.totalScoreDelta,
      changedDimensions: report.regression.changedDimensions,
    },
  };
}

function persistableQualityFinding(
  finding: SbomQualityFindingDraft,
): Record<string, unknown> {
  return {
    component_id: finding.componentId,
    finding_key: [
      finding.kind,
      finding.code,
      finding.dimension ?? "document",
      finding.componentId ?? "document",
    ].join(":"),
    category:
      finding.kind === "coverage_gap"
        ? "coverage"
        : finding.kind === "bsi_rule"
          ? "profile"
          : "regression",
    code: finding.code,
    rule_id: finding.ruleId,
    severity: finding.severity,
    dimension: finding.dimension,
    source_path: finding.sourcePath,
    source_offset: null,
    expected_condition: finding.expected,
    actual_condition: finding.actual,
    remediation: finding.remediation,
  };
}

function diffReport(value: unknown) {
  const raw = z
    .object({
      id: z.uuid(),
      sourceId: z.uuid(),
      baselineSourceId: z.uuid(),
      releaseId: z.uuid(),
      documentId: z.uuid(),
      baselineDocumentId: z.uuid(),
      state: z.enum(["queued", "processing", "completed", "failed"]),
      comparisonStatus: z.enum([
        "ready",
        "identical",
        "no_comparable_version",
        "partial_integration_unavailable",
        "failed",
      ]),
      comparatorVersion: z.string().min(1).max(120),
      findingDelta: z
        .object({ state: z.enum(["partial_integration_unavailable", "ready"]) })
        .strict(),
      counts: z
        .object({ componentChanges: z.number().int().nonnegative() })
        .strict(),
      progress: z
        .object({
          stage: z.enum([
            "queued",
            "projecting_identities",
            "comparing",
            "recording_changes",
            "completed",
            "failed",
          ]),
          percent: z.number().int().min(0).max(100),
        })
        .strict(),
      error: z
        .object({
          code: z.string().min(1),
          message: z.string().min(1),
          retryable: z.boolean(),
        })
        .strict()
        .nullable(),
      completedAt: z.string().datetime({ offset: true }).nullable(),
      createdAt: z.string().datetime({ offset: true }),
      updatedAt: z.string().datetime({ offset: true }),
    })
    .strict()
    .parse(value);
  return sbomDiffReportSchema.parse({
    ...raw,
    findingDelta: {
      status: raw.findingDelta.state,
      reason:
        raw.findingDelta.state === "partial_integration_unavailable"
          ? "Finding delta requires the M4 advisory integration."
          : null,
      summary:
        raw.findingDelta.state === "ready"
          ? { new: 0, removed: 0, resolved: 0, unchanged: 0 }
          : null,
    },
    progress: {
      ...raw.progress,
      message: diffProgressMessage(raw.progress.stage),
    },
  });
}

function diffFact(
  value: z.output<typeof diffFactPageSchema>["items"][number],
): SbomDiffComponentFact {
  return Object.freeze({
    componentId: value.componentId,
    identity: value.packageIdentity,
    ecosystem: value.ecosystem,
    canonicalPurl: value.canonicalPurl,
    normalizedVersion: value.normalizedVersion,
    sourceOffset: value.sourceOffset,
  });
}

function persistableDiffChange(change: SbomDiffChangeDraft) {
  return {
    change_key: change.changeKey,
    change_type: change.changeType,
    canonical_package_identity: change.identity,
    ecosystem: change.ecosystem,
    current_component_id: change.currentComponentId,
    baseline_component_id: change.baselineComponentId,
    current_version: change.currentVersion,
    baseline_version: change.baselineVersion,
    explanation: change.explanation,
  };
}

function diffProgressMessage(
  stage:
    | "queued"
    | "projecting_identities"
    | "comparing"
    | "recording_changes"
    | "completed"
    | "failed",
): string {
  switch (stage) {
    case "queued":
      return "Waiting to compare the release lineage.";
    case "projecting_identities":
      return "Preparing canonical component identities.";
    case "comparing":
      return "Comparing canonical component identities.";
    case "recording_changes":
      return "Saving deterministic component changes.";
    case "completed":
      return "Component comparison completed.";
    case "failed":
      return "Component comparison failed.";
  }
}

export class SbomRepositoryError extends Error {
  constructor(
    readonly code: "malformed" | "unavailable",
    readonly providerCode: string | null = null,
  ) {
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

function opaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** The database stores only this stable digest, never an invitation/session bearer. */
function tokenHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function correlationFromIdempotency(idempotencyKey: string): string {
  // UUID idempotency keys are already validated at the HTTP boundary.  A
  // separate correlation id is intentionally generated for every write.
  void idempotencyKey;
  return randomUUID();
}

function supplierUploadDigest(
  input: Parameters<SupplierSbomRepository["reserveUpload"]>[0],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        filename: input.filename,
        byteSize: input.byteSize,
        mediaType: input.mediaType,
        sha256: input.sha256,
        idempotencyKey: input.idempotencyKey,
        declaredFormat: input.declaredFormat ?? null,
        declaredSpecVersion: input.declaredSpecVersion ?? null,
      }),
    )
    .digest("hex");
}

function supplierRequestDigest(
  input: Parameters<SupplierSbomRepository["createRequest"]>[1],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        productId: input.productId,
        releaseId: input.releaseId,
        supplierDisplayName: input.supplierDisplayName,
        allowedComponentRef: input.allowedComponentRef,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
      }),
    )
    .digest("hex");
}

function supplierInvitationDigest(
  input: Parameters<SupplierSbomRepository["createInvitation"]>[1],
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        requestId: input.requestId,
        expiresAt: input.expiresAt,
        idempotencyKey: input.idempotencyKey,
      }),
    )
    .digest("hex");
}

function supplierRequest(value: unknown): SupplierSbomRequest {
  const row = supplierRecord(value);
  return Object.freeze({
    id: supplierString(row, "id"),
    organizationId: supplierString(row, "organizationId", "organization_id"),
    productId: supplierString(row, "productId", "product_id"),
    releaseId: supplierString(row, "releaseId", "release_id"),
    allowedComponentRef: supplierString(
      row,
      "allowedComponentRef",
      "allowed_component_ref",
    ),
    supplierDisplayName: supplierString(
      row,
      "supplierDisplayName",
      "supplier_display_name",
    ),
    state: supplierEnum(row, ["open", "closed", "revoked"] as const, "state"),
    createdAt: supplierString(row, "createdAt", "created_at"),
    expiresAt: supplierString(row, "expiresAt", "expires_at"),
    createdBy: supplierString(row, "createdBy", "created_by"),
    closedAt: supplierNullableString(row, "closedAt", "closed_at"),
  });
}

function supplierInvitation(value: unknown): SupplierSbomInvitation {
  const row = supplierRecord(value);
  return Object.freeze({
    id: supplierString(row, "id"),
    requestId: supplierString(row, "requestId", "request_id"),
    tokenPrefix: supplierString(row, "tokenPrefix", "token_prefix"),
    state: supplierEnum(
      row,
      ["active", "used", "expired", "revoked"] as const,
      "state",
    ),
    expiresAt: supplierString(row, "expiresAt", "expires_at"),
    createdAt: supplierString(row, "createdAt", "created_at"),
    usedAt: supplierNullableString(row, "usedAt", "used_at"),
    revokedAt: supplierNullableString(row, "revokedAt", "revoked_at"),
  });
}

function supplierSession(
  value: unknown,
  token: string | null,
): SupplierSbomSession {
  const row = supplierRecord(value);
  return Object.freeze({
    sessionToken:
      token ??
      (() => {
        throw new SbomRepositoryError("malformed");
      })(),
    expiresAt: supplierString(row, "expiresAt", "expires_at"),
    requestReference: supplierString(
      row,
      "requestReference",
      "request_reference",
    ),
    allowedComponentRef: supplierString(
      row,
      "allowedComponentRef",
      "allowed_component_ref",
    ),
  });
}

function supplierSubmission(value: unknown): SupplierSbomSubmission {
  const row = supplierRecord(value);
  return Object.freeze({
    id: supplierString(row, "id"),
    requestId: supplierString(row, "requestId", "request_id"),
    sourceId: supplierNullableString(row, "sourceId", "source_id"),
    state: supplierEnum(
      row,
      [
        "pending",
        "processing",
        "validation_failed",
        "awaiting_review",
        "accepted",
        "rejected",
        "superseded",
      ] as const,
      "state",
    ),
    fileName: supplierString(row, "fileName", "file_name"),
    mediaType: supplierString(row, "mediaType", "media_type"),
    byteSize: supplierNumber(row, "byteSize", "byte_size"),
    sha256: supplierString(row, "sha256"),
    validationMessage: supplierNullableString(
      row,
      "validationMessage",
      "validation_message",
    ),
    reviewReason: supplierNullableString(row, "reviewReason", "review_reason"),
    reviewedAt: supplierNullableString(row, "reviewedAt", "reviewed_at"),
    reviewedBy: supplierNullableString(row, "reviewedBy", "reviewed_by"),
    supersededBySubmissionId: supplierNullableString(
      row,
      "supersededBySubmissionId",
      "superseded_by_submission_id",
    ),
    createdAt: supplierString(row, "createdAt", "created_at"),
    updatedAt: supplierString(row, "updatedAt", "updated_at"),
  });
}

function supplierRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new SbomRepositoryError("malformed");
  return value as Record<string, unknown>;
}

function supplierArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value)) throw new SbomRepositoryError("malformed");
  return value;
}

function supplierString(
  row: Record<string, unknown>,
  ...names: string[]
): string {
  for (const name of names) if (typeof row[name] === "string") return row[name];
  throw new SbomRepositoryError("malformed");
}
function supplierNullableString(
  row: Record<string, unknown>,
  ...names: string[]
): string | null {
  for (const name of names) {
    if (row[name] === null) return null;
    if (typeof row[name] === "string") return row[name];
  }
  throw new SbomRepositoryError("malformed");
}
function supplierNumber(
  row: Record<string, unknown>,
  ...names: string[]
): number {
  for (const name of names)
    if (typeof row[name] === "number" && Number.isInteger(row[name]))
      return row[name];
  throw new SbomRepositoryError("malformed");
}
function supplierEnum<const T extends readonly string[]>(
  row: Record<string, unknown>,
  values: T,
  name: string,
): T[number] {
  const value = row[name];
  if (
    typeof value === "string" &&
    (values as readonly string[]).includes(value)
  )
    return value;
  throw new SbomRepositoryError("malformed");
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
