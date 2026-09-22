import { Injectable } from "@nestjs/common";
import {
  supplierEvidenceInvitationSchema,
  supplierEvidencePortalRequestSchema,
  supplierEvidencePortalSubmissionSchema,
  supplierEvidencePreviewSchema,
  supplierEvidenceRequestDetailSchema,
  supplierEvidenceRequestsResponseSchema,
} from "@repo/contracts/supplier-evidence";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  SupplierEvidenceConflictError,
  SupplierEvidenceForbiddenError,
  SupplierEvidenceInvalidRequestError,
  SupplierEvidenceUnavailableError,
  type SupplierEvidenceRepository,
} from "../application/supplier-evidence-use-cases";

type Rpc = {
  rpc(
    name: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};
type Row = Readonly<{ outcome?: unknown; result?: unknown }>;

/** The adapter is the only service-role access point. Every internal call is organization-first; public calls use only bearer hashes. */
@Injectable()
export class SupabaseSupplierEvidenceRepository implements SupplierEvidenceRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async preview(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["preview"]>[1],
  ) {
    const row = await this.row("preview_supplier_evidence_request_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_payload: payload(input, ["actorId"]),
    });
    this.raise(row);
    if (row?.outcome !== "previewed") throw unavailable();
    return supplierEvidencePreviewSchema.parse(row.result);
  }
  async create(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["create"]>[1],
  ) {
    return this.request(
      "create_supplier_evidence_request_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_payload: payload(input, ["actorId", "idempotencyKey"]),
        p_idempotency_key: input.idempotencyKey,
      },
      ["created", "replayed"],
    );
  }
  async revise(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["revise"]>[1],
  ) {
    return this.request(
      "revise_supplier_evidence_request_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_request_id: input.requestId,
        p_payload: payload(input, [
          "actorId",
          "requestId",
          "expectedVersion",
          "previewFingerprint",
          "idempotencyKey",
        ]),
        p_expected_version: input.expectedVersion,
        p_preview_fingerprint: input.previewFingerprint,
        p_idempotency_key: input.idempotencyKey,
      },
      ["revised", "replayed"],
    );
  }
  async issue(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["issue"]>[1],
  ) {
    return this.issueLike(
      "issue_supplier_evidence_request_atomic",
      organizationId,
      input,
    );
  }
  async reissue(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["reissue"]>[1],
  ) {
    return this.issueLike(
      "reissue_supplier_evidence_request_atomic",
      organizationId,
      input,
    );
  }
  async revoke(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["revoke"]>[1],
  ) {
    return this.request(
      "revoke_supplier_evidence_invitation_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_request_id: input.requestId,
        p_invitation_id: input.invitationId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      ["revoked", "replayed"],
    );
  }
  async close(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["close"]>[1],
  ) {
    return this.request(
      "close_supplier_evidence_request_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: input.actorId,
        p_request_id: input.requestId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      ["closed", "replayed"],
    );
  }
  async list(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["list"]>[1],
  ) {
    const row = await this.row("list_supplier_evidence_requests_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_supplier_id: input.supplierId ?? null,
      p_limit: input.limit,
      p_cursor: input.cursor ?? null,
    });
    this.raise(row);
    if (row?.outcome !== "found") throw unavailable();
    const value = record(row.result);
    return supplierEvidenceRequestsResponseSchema.parse({
      requests: value.requests ?? value.items,
      nextCursor: value.nextCursor,
    });
  }
  async detail(
    organizationId: string,
    input: Parameters<SupplierEvidenceRepository["detail"]>[1],
  ) {
    const row = await this.row("get_supplier_evidence_request_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: input.requestId,
    });
    this.raise(row);
    if (row?.outcome === "not_found") return null;
    if (row?.outcome !== "found") throw unavailable();
    return supplierEvidenceRequestDetailSchema.parse(row.result);
  }
  async redeem(input: Parameters<SupplierEvidenceRepository["redeem"]>[0]) {
    const row = await this.row("redeem_supplier_evidence_invitation_atomic", {
      p_invitation_token_hash: input.invitationTokenHash,
      p_session_token_hash: input.sessionTokenHash,
      p_session_expires_at: input.sessionExpiresAt,
    });
    this.raise(row);
    if (row?.outcome !== "created" && row?.outcome !== "replayed")
      throw unavailable();
    const value = record(row.result);
    return Object.freeze({
      expiresAt: string(value.expiresAt),
      request: supplierEvidencePortalRequestSchema.parse(value.request),
    });
  }
  async portalRequest(
    input: Parameters<SupplierEvidenceRepository["portalRequest"]>[0],
  ) {
    const row = await this.row("get_supplier_evidence_portal_request_atomic", {
      p_session_token_hash: input.sessionTokenHash,
    });
    this.raise(row);
    if (row?.outcome !== "found") throw unavailable();
    return supplierEvidencePortalRequestSchema.parse(row.result);
  }
  async reserve(input: Parameters<SupplierEvidenceRepository["reserve"]>[0]) {
    const row = await this.row("reserve_supplier_evidence_submission_atomic", {
      p_session_token_hash: input.sessionTokenHash,
      p_request_item_id: input.checklistItemId,
      p_original_filename: input.fileName,
      p_declared_size_bytes: input.byteSize,
      p_declared_media_type: input.mediaType,
      p_declared_sha256: input.sha256,
      p_object_key: input.objectKey,
      p_upload_expires_at: input.uploadExpiresAt,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: input.requestDigest,
    });
    this.raise(row);
    if (row?.outcome !== "reserved" && row?.outcome !== "replayed")
      throw unavailable();
    const result = record(row.result);
    return Object.freeze({
      submission: supplierEvidencePortalSubmissionSchema.parse(
        result.submission,
      ),
      versionId: string(result.versionId),
      objectKey: string(result.objectKey),
    });
  }
  async uploadForFinalization(
    input: Parameters<SupplierEvidenceRepository["uploadForFinalization"]>[0],
  ) {
    const row = await this.row(
      "get_supplier_evidence_submission_upload_atomic",
      {
        p_session_token_hash: input.sessionTokenHash,
        p_version_id: input.versionId,
      },
    );
    this.raise(row);
    if (row?.outcome !== "found") throw unavailable();
    return Object.freeze({ objectKey: string(record(row.result).objectKey) });
  }
  async finalize(input: Parameters<SupplierEvidenceRepository["finalize"]>[0]) {
    const row = await this.row("finalize_supplier_evidence_submission_atomic", {
      p_session_token_hash: input.sessionTokenHash,
      p_version_id: input.versionId,
      p_actual_size: input.actualByteSize,
      p_media_type: input.mediaType,
      p_sha256: input.sha256,
      p_idempotency_key: input.idempotencyKey,
      p_request_digest: input.requestDigest,
    });
    this.raise(row);
    if (
      row?.outcome !== "queued" &&
      row?.outcome !== "replayed" &&
      row?.outcome !== "rejected"
    )
      throw unavailable();
    return supplierEvidencePortalSubmissionSchema.parse(
      record(row.result).submission ?? row.result,
    );
  }

  private async issueLike(
    name: string,
    organizationId: string,
    input: Record<string, unknown>,
  ) {
    const row = await this.row(name, {
      p_organization_id: organizationId,
      p_actor_user_id: input.actorId,
      p_request_id: input.requestId,
      p_expected_version: input.expectedVersion,
      p_preview_fingerprint: input.previewFingerprint,
      p_token_hash: input.tokenHash,
      p_expires_at: input.expiresAt,
      p_idempotency_key: input.idempotencyKey,
    });
    this.raise(row);
    if (
      row?.outcome !== "issued" &&
      row?.outcome !== "reissued" &&
      row?.outcome !== "replayed"
    )
      throw unavailable();
    const value = record(row.result);
    return Object.freeze({
      outcome: string(row.outcome) as "issued" | "reissued" | "replayed",
      request: supplierEvidenceRequestDetailSchema.parse(value.request),
      invitation: supplierEvidenceInvitationSchema.parse(value.invitation),
      recipientEmail: string(value.recipientEmail),
    });
  }
  private async request(
    name: string,
    args: Record<string, unknown>,
    success: readonly string[],
  ) {
    const row = await this.row(name, args);
    this.raise(row);
    if (!row || !success.includes(string(row.outcome))) throw unavailable();
    return supplierEvidenceRequestDetailSchema.parse(row.result);
  }
  private async row(
    name: string,
    args: Record<string, unknown>,
  ): Promise<Row | null> {
    const response = await (this.supabase.admin() as unknown as Rpc).rpc(
      name,
      args,
    );
    if (response.error) throw unavailable();
    const rows = Array.isArray(response.data) ? response.data : [];
    return isRecord(rows[0]) ? rows[0] : null;
  }
  private raise(row: Row | null) {
    if (row?.outcome === "forbidden")
      throw new SupplierEvidenceForbiddenError();
    if (["invalid_request", "invalid_reference"].includes(string(row?.outcome)))
      throw new SupplierEvidenceInvalidRequestError();
    if (
      [
        "conflict",
        "idempotency_conflict",
        "idempotency_mismatch",
        "expired",
        "revoked",
      ].includes(string(row?.outcome))
    )
      throw new SupplierEvidenceConflictError();
  }
}

function payload(value: Record<string, unknown>, omit: readonly string[]) {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !omit.includes(key)),
  );
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function record(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  throw unavailable();
}
function string(value: unknown): string {
  return typeof value === "string" ? value : "";
}
function unavailable(): SupplierEvidenceUnavailableError {
  return new SupplierEvidenceUnavailableError(
    "Supplier evidence operation unavailable.",
  );
}
