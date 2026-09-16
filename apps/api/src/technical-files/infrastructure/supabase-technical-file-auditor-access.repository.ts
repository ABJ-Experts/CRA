import { Injectable } from "@nestjs/common";
import {
  technicalFileAuditorGrantPreviewResponseSchema,
  technicalFileAuditorGrantResponseSchema,
  technicalFileAuditorGrantsResponseSchema,
  technicalFileAuditorManifestResponseSchema,
  technicalFileAuditorSnapshotViewResponseSchema,
  type CreateTechnicalFileAuditorGrantRequest,
  type RevokeTechnicalFileAuditorGrantRequest,
} from "@repo/contracts/technical-files";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  TechnicalFileAuditorAccessConflictError,
  TechnicalFileAuditorAccessUnavailableError,
  type TechnicalFileAuditorAccessRepository,
  type TechnicalFileAuditorArtifact,
} from "../application/technical-file-auditor-access.port";

/**
 * Service-role adapter: tenant calls always include organization first; public
 * auditor calls use only a hashed opaque session token and no tenant input.
 */
@Injectable()
export class SupabaseTechnicalFileAuditorAccessRepository implements TechnicalFileAuditorAccessRepository {
  constructor(private readonly supabase: SupabaseService) {}

  async preview(
    organizationId: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
    }>,
  ) {
    const rpc = await this.call(
      "preview_technical_file_auditor_snapshot_grant",
      {
        ...tenantScope(organizationId, input),
        p_snapshot_id: input.snapshotId,
        p_export_id: input.exportId,
      },
    );
    this.tenantFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    return technicalFileAuditorGrantPreviewResponseSchema.parse({ preview: rpc.result })
      .preview;
  }

  async list(
    organizationId: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ) {
    const rpc = await this.call("list_technical_file_auditor_snapshot_grants", {
      ...tenantScope(organizationId, input),
      p_snapshot_id: input.snapshotId,
    });
    this.tenantFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    return technicalFileAuditorGrantsResponseSchema.parse(rpc.result).grants;
  }

  async create(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        grantId: string;
        tokenHash: string;
        requestDigest: string;
      } & CreateTechnicalFileAuditorGrantRequest
    >,
  ) {
    const rpc = await this.call(
      "create_technical_file_auditor_snapshot_grant_atomic",
      {
        ...tenantScope(organizationId, input),
        p_snapshot_id: input.snapshotId,
        p_export_id: input.exportId,
        p_grant_id: input.grantId,
        p_recipient_email: input.recipientEmail,
        p_recipient_reference: input.recipientReference ?? null,
        p_purpose: input.purpose,
        p_expires_at: input.expiresAt,
        p_token_hash: input.tokenHash,
        p_idempotency_key: input.idempotencyKey,
        p_request_digest: input.requestDigest,
      },
    );
    // A replay cannot safely return a magic link: raw tokens are intentionally
    // never retained. Force an explicit user decision rather than returning a
    // newly generated token that does not match the stored digest.
    if (rpc.outcome === "replayed")
      throw new TechnicalFileAuditorAccessConflictError();
    this.tenantFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    return technicalFileAuditorGrantResponseSchema.parse({ grant: rpc.result })
      .grant;
  }

  async revoke(
    organizationId: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        grantId: string;
      } & RevokeTechnicalFileAuditorGrantRequest
    >,
  ) {
    const rpc = await this.call(
      "revoke_technical_file_auditor_snapshot_grant_atomic",
      {
        ...tenantScope(organizationId, input),
        p_snapshot_id: input.snapshotId,
        p_grant_id: input.grantId,
        p_expected_version: input.expectedVersion,
        p_reason: input.reason ?? null,
        p_idempotency_key: input.idempotencyKey,
      },
    );
    this.tenantFailure(rpc);
    if (rpc.outcome === "not_found") return null;
    return technicalFileAuditorGrantResponseSchema.parse({ grant: rpc.result })
      .grant;
  }

  async redeem(
    input: Readonly<{
      tokenHash: string;
      sessionId: string;
      sessionTokenHash: string;
      sessionExpiresAt: string;
      clientSourceHash: string | null;
    }>,
  ) {
    const rpc = await this.call(
      "redeem_technical_file_auditor_snapshot_grant_atomic",
      {
        p_token_hash: input.tokenHash,
        p_session_id: input.sessionId,
        p_session_token_hash: input.sessionTokenHash,
        p_session_expires_at: input.sessionExpiresAt,
        p_client_source_hash: input.clientSourceHash,
      },
    );
    if (rpc.outcome !== "redeemed") return null;
    const result = rpc.result as Record<string, unknown> | null;
    const expiresAt = result?.sessionExpiresAt;
    if (typeof expiresAt !== "string")
      throw new TechnicalFileAuditorAccessUnavailableError();
    return { expiresAt };
  }

  async view(sessionTokenHash: string) {
    const rpc = await this.scoped(sessionTokenHash, "viewed");
    if (!rpc) return null;
    return technicalFileAuditorSnapshotViewResponseSchema.parse(rpc.result)
      .snapshot;
  }

  async manifest(sessionTokenHash: string) {
    const rpc = await this.scoped(sessionTokenHash, "manifest_viewed");
    if (!rpc) return null;
    return technicalFileAuditorManifestResponseSchema.parse(rpc.result)
      .manifest;
  }

  async artifact(
    sessionTokenHash: string,
    artifact: TechnicalFileAuditorArtifact,
  ) {
    const rpc = await this.call(
      "get_technical_file_auditor_snapshot_artifact_atomic",
      {
        p_session_token_hash: sessionTokenHash,
        p_artifact: artifact,
      },
    );
    if (rpc.outcome !== "available") return null;
    const path = (rpc.result as Record<string, unknown> | null)?.objectPath;
    if (!isSafeStoragePath(path))
      throw new TechnicalFileAuditorAccessUnavailableError();
    const downloaded = await this.supabase
      .admin()
      .storage.from("technical-file-snapshot-exports")
      .download(path);
    if (downloaded.error || !downloaded.data)
      throw new TechnicalFileAuditorAccessUnavailableError();
    return {
      bytes: new Uint8Array(await downloaded.data.arrayBuffer()),
      ...artifactMetadata(artifact),
    };
  }

  private async scoped(
    sessionTokenHash: string,
    action: "viewed" | "manifest_viewed",
  ) {
    const rpc = await this.call(
      "get_technical_file_auditor_snapshot_access_atomic",
      {
        p_session_token_hash: sessionTokenHash,
        p_action: action,
      },
    );
    return rpc.outcome === "available" ? rpc : null;
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
    const row = Array.isArray(response.data) ? response.data[0] : response.data;
    if (!row || typeof row !== "object")
      throw new TechnicalFileAuditorAccessUnavailableError();
    const rpc = row as { outcome?: unknown; result?: unknown };
    if (typeof rpc.outcome !== "string")
      throw new TechnicalFileAuditorAccessUnavailableError();
    return { outcome: rpc.outcome, result: rpc.result };
  }

  private tenantFailure(rpc: { outcome: string; result: unknown }) {
    if (["conflict", "idempotency_conflict"].includes(rpc.outcome)) {
      const version = (rpc.result as Record<string, unknown> | null)
        ?.currentVersion;
      throw new TechnicalFileAuditorAccessConflictError(
        typeof version === "number" ? version : null,
      );
    }
    if (["forbidden", "invalid_request"].includes(rpc.outcome))
      throw new TechnicalFileAuditorAccessUnavailableError();
  }
}

function tenantScope(
  organizationId: string,
  input: { actorId: string; productId: string },
) {
  return {
    p_organization_id: organizationId,
    p_actor_user_id: input.actorId,
    p_product_id: input.productId,
  };
}

function isSafeStoragePath(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 1_024 &&
    !value.includes("..") &&
    !value.includes("\\") &&
    !value.startsWith("/")
  );
}

function artifactMetadata(artifact: TechnicalFileAuditorArtifact) {
  return artifact === "pdf"
    ? {
        mimeType: "application/pdf" as const,
        fileName: "technical-file-snapshot.pdf",
      }
    : {
        mimeType: "application/zip" as const,
        fileName: "technical-file-snapshot.zip",
      };
}
