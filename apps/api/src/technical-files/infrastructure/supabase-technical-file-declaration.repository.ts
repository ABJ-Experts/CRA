import { Injectable } from "@nestjs/common";
import {
  technicalFileDeclarationDownloadResponseSchema,
  technicalFileDeclarationPreviewResponseSchema,
  technicalFileDeclarationResponseSchema,
  technicalFileDeclarationsResponseSchema,
  type CreateTechnicalFileDeclarationDraftRequest,
  type IssueTechnicalFileDeclarationRequest,
  type ReissueTechnicalFileDeclarationRequest,
} from "@repo/contracts/technical-files";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  TechnicalFileDeclarationConflictError,
  TechnicalFileDeclarationInvalidRequestError,
  type TechnicalFileDeclarationRepository,
} from "../application/technical-file-declaration.port";

@Injectable()
export class SupabaseTechnicalFileDeclarationRepository implements TechnicalFileDeclarationRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async preview(
    org: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ) {
    // A snapshot-only preview deliberately supplies no signatory facts. The
    // database therefore reports signatory as a blocker instead of inventing
    // a capacity or place before the authorized human provides them in draft.
    const rpc = await this.call(
      "get_technical_file_declaration_preview_contract",
      {
        ...scope(org, input),
        p_snapshot_id: input.snapshotId,
        p_signatory_capacity: "",
        p_issue_place: "",
        p_assessment_route: null,
        p_notified_body_identifier: null,
        p_certificate_references: [],
      },
    );
    this.fail(rpc);
    return rpc.outcome === "not_found"
      ? null
      : technicalFileDeclarationPreviewResponseSchema.parse({
          preview: publicPreview(rpc.result),
        }).preview;
  }
  async list(
    org: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const rpc = await this.call(
      "get_technical_file_declarations",
      scope(org, input),
    );
    this.fail(rpc);
    return rpc.outcome === "not_found"
      ? null
      : technicalFileDeclarationsResponseSchema.parse(rpc.result).declarations;
  }
  async saveDraft(
    org: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId?: string;
      } & CreateTechnicalFileDeclarationDraftRequest
    >,
  ) {
    const rpc = await this.call(
      "upsert_technical_file_declaration_draft_contract_atomic",
      {
        ...scope(org, input),
        p_snapshot_id: input.snapshotId,
        p_declaration_id: input.declarationId ?? null,
        p_expected_draft_version: input.expectedVersion,
        p_signatory_capacity: input.signatoryCapacity,
        p_issue_place: input.signatoryPlace,
        p_assessment_route: input.assessmentRoute,
        p_notified_body_identifier: input.notifiedBody?.identifier ?? null,
        p_certificate_references: input.certificateReferences ?? [],
        p_idempotency_key: input.idempotencyKey,
      },
    );
    return this.declaration(rpc);
  }
  async issue(
    org: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId: string;
      } & IssueTechnicalFileDeclarationRequest
    >,
  ) {
    const rpc = await this.call("issue_technical_file_declaration_atomic", {
      ...scope(org, input),
      p_declaration_id: input.declarationId,
      p_expected_draft_version: input.expectedVersion,
      p_preview_digest: input.previewDigest,
      p_snapshot_sha256: input.snapshotSha256,
      p_confirmed: input.confirmIssue,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.declaration(rpc);
  }
  async reissue(
    org: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        declarationId: string;
      } & ReissueTechnicalFileDeclarationRequest
    >,
  ) {
    const rpc = await this.call(
      "reissue_technical_file_declaration_contract_atomic",
      {
        ...scope(org, input),
        p_current_declaration_id: input.declarationId,
        p_snapshot_id: input.snapshotId,
        p_expected_declaration_version: input.expectedCurrentVersion,
        p_signatory_capacity: input.signatoryCapacity,
        p_issue_place: input.signatoryPlace,
        p_assessment_route: input.assessmentRoute,
        p_notified_body_identifier: input.notifiedBody?.identifier ?? null,
        p_certificate_references: input.certificateReferences ?? [],
        p_reason: input.reason,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    return this.declaration(rpc);
  }
  async download(
    org: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      declarationId: string;
    }>,
  ) {
    const rpc = await this.call(
      "get_technical_file_declaration_download_atomic",
      { ...scope(org, input), p_declaration_id: input.declarationId },
    );
    this.fail(rpc);
    if (rpc.outcome === "not_found") return null;
    const result = rpc.result as Record<string, unknown>;
    const path = result.objectPath;
    if (typeof path !== "string" || !path.startsWith(`${org}/`))
      throw new Error("invalid declaration storage path");
    const signed = await this.supabase
      .admin()
      .storage.from("technical-file-declarations")
      .createSignedUrl(path, 300);
    if (signed.error || !signed.data)
      throw new Error("declaration storage unavailable");
    return technicalFileDeclarationDownloadResponseSchema.parse({
      download: {
        artifact: result.artifact,
        downloadUrl: signed.data.signedUrl,
        expiresAt: new Date(Date.now() + 300000).toISOString(),
      },
    });
  }
  private async call(name: string, args: Record<string, unknown>) {
    const client = this.supabase.admin() as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): Promise<{ data: unknown; error: { message: string } | null }>;
    };
    const response = await client.rpc(name, args);
    if (response.error) throw new Error(response.error.message);
    const row: unknown = Array.isArray(response.data)
      ? (response.data as unknown[])[0]
      : response.data;
    if (!row || typeof row !== "object")
      throw new Error("invalid declaration RPC");
    const rpc = row as { outcome?: unknown; result?: unknown };
    if (typeof rpc.outcome !== "string")
      throw new Error("invalid declaration RPC");
    return { outcome: rpc.outcome, result: rpc.result };
  }
  private declaration(rpc: { outcome: string; result: unknown }) {
    this.fail(rpc);
    return rpc.outcome === "not_found"
      ? null
      : technicalFileDeclarationResponseSchema.parse({
          declaration: rpc.result,
        }).declaration;
  }
  private fail(rpc: { outcome: string; result: unknown }) {
    if (["conflict", "idempotency_conflict"].includes(rpc.outcome)) {
      const current = (rpc.result as Record<string, unknown>)?.currentVersion;
      throw new TechnicalFileDeclarationConflictError(
        typeof current === "number" ? current : null,
      );
    }
    if (["forbidden", "invalid_request", "blocked"].includes(rpc.outcome))
      throw new TechnicalFileDeclarationInvalidRequestError();
  }
}
function scope(org: string, input: { actorId: string; productId: string }) {
  return {
    p_organization_id: org,
    p_actor_user_id: input.actorId,
    p_product_id: input.productId,
  };
}

function publicPreview(value: unknown) {
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter(
      ([key]) => key !== "payload",
    ),
  );
}
