import { Injectable } from "@nestjs/common";
import {
  technicalFileSnapshotDownloadResponseSchema,
  technicalFileSnapshotExportResponseSchema,
  technicalFileSnapshotResponseSchema,
  technicalFileSnapshotsResponseSchema,
  type TechnicalFileSnapshotDownloadResponse,
  type TechnicalFileSnapshotExport,
  type CreateTechnicalFileSnapshotRequest,
  type CreateTechnicalFileSnapshotExportRequest,
  type CancelTechnicalFileSnapshotExportRequest,
} from "@repo/contracts/technical-files";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  TechnicalFileSnapshotConflictError,
  TechnicalFileSnapshotInvalidRequestError,
  type TechnicalFileSnapshotRepository,
} from "../application/technical-file-snapshot.port";

@Injectable()
export class SupabaseTechnicalFileSnapshotRepository implements TechnicalFileSnapshotRepository {
  constructor(private readonly supabase: SupabaseService) {}
  async list(
    org: string,
    input: Readonly<{ actorId: string; productId: string }>,
  ) {
    const r = await this.call(
      "get_technical_file_snapshots",
      scope(org, input),
    );
    this.fail(r);
    return r.outcome === "not_found"
      ? null
      : technicalFileSnapshotsResponseSchema.parse(r.result).snapshots;
  }
  async get(
    org: string,
    input: Readonly<{ actorId: string; productId: string; snapshotId: string }>,
  ) {
    const r = await this.call("get_technical_file_snapshot", {
      ...scope(org, input),
      p_snapshot_id: input.snapshotId,
    });
    this.fail(r);
    return r.outcome === "not_found"
      ? null
      : technicalFileSnapshotResponseSchema.parse(r.result).snapshot;
  }
  async create(
    org: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
      } & CreateTechnicalFileSnapshotRequest
    >,
  ) {
    const r = await this.call("create_technical_file_snapshot_atomic", {
      ...scope(org, input),
      p_expected_technical_file_version: input.expectedTechnicalFileVersion,
      p_purpose: input.purpose,
      p_release_id: input.releaseId ?? null,
      p_audit_rationale: input.auditRationale ?? null,
      p_idempotency_key: input.idempotencyKey,
    });
    this.fail(r);
    return r.outcome === "not_found"
      ? null
      : technicalFileSnapshotResponseSchema.parse({ snapshot: r.result })
          .snapshot;
  }
  async requestExport(
    org: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
      } & CreateTechnicalFileSnapshotExportRequest
    >,
  ) {
    const r = await this.call("create_technical_file_snapshot_export_atomic", {
      ...scope(org, input),
      p_snapshot_id: input.snapshotId,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.export(r);
  }
  async getExport(
    org: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
    }>,
  ) {
    const r = await this.call("get_technical_file_snapshot_export", {
      ...scope(org, input),
      p_snapshot_id: input.snapshotId,
      p_export_id: input.exportId,
    });
    return this.export(r, true);
  }
  async cancelExport(
    org: string,
    input: Readonly<
      {
        actorId: string;
        productId: string;
        snapshotId: string;
        exportId: string;
      } & CancelTechnicalFileSnapshotExportRequest
    >,
  ) {
    const r = await this.call("cancel_technical_file_snapshot_export_atomic", {
      ...scope(org, input),
      p_snapshot_id: input.snapshotId,
      p_export_id: input.exportId,
      p_reason: input.reason,
      p_idempotency_key: input.idempotencyKey,
    });
    return this.export(r);
  }
  async getDownload(
    org: string,
    input: Readonly<{
      actorId: string;
      productId: string;
      snapshotId: string;
      exportId: string;
      artifact: "pdf" | "archive";
    }>,
  ): Promise<TechnicalFileSnapshotDownloadResponse | null> {
    const r = await this.call(
      "get_technical_file_snapshot_export_download_atomic",
      {
        ...scope(org, input),
        p_snapshot_id: input.snapshotId,
        p_export_id: input.exportId,
        p_artifact: input.artifact,
      },
    );
    this.fail(r);
    if (r.outcome === "not_found") return null;
    const path = (r.result as Record<string, unknown>)?.objectPath;
    if (typeof path !== "string" || !path.startsWith(`${org}/`))
      throw new Error("invalid snapshot storage path");
    const signed = await this.supabase
      .admin()
      .storage.from("technical-file-snapshot-exports")
      .createSignedUrl(path, 300);
    if (signed.error || !signed.data)
      throw new Error("snapshot storage unavailable");
    // The first RPC only authorizes the private object path.  Do not create a
    // successful-download audit entry until signing has actually succeeded;
    // the second RPC re-checks membership and ready state before recording it.
    const audited = await this.call(
      "record_technical_file_snapshot_export_download_atomic",
      {
        ...scope(org, input),
        p_snapshot_id: input.snapshotId,
        p_export_id: input.exportId,
        p_artifact: input.artifact,
      },
    );
    this.fail(audited);
    if (audited.outcome === "not_found") return null;
    const artifact = (await this.getExport(org, input))?.artifacts.find(
      (x) => x.kind === input.artifact,
    );
    if (!artifact) throw new Error("snapshot artifact unavailable");
    return technicalFileSnapshotDownloadResponseSchema.parse({
      download: {
        artifact,
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
      ): Promise<{
        data: unknown;
        error: { message: string } | null;
      }>;
    };
    const x = await client.rpc(name, args);
    if (x.error) throw new Error(x.error.message);
    const row = Array.isArray(x.data) ? (x.data[0] as unknown) : x.data;
    if (!row || typeof row !== "object")
      throw new Error("invalid snapshot RPC");
    const v = row as { outcome?: unknown; result?: unknown };
    if (typeof v.outcome !== "string") throw new Error("invalid snapshot RPC");
    return { outcome: v.outcome, result: v.result };
  }
  private fail(r: { outcome: string; result: unknown }) {
    if (["conflict", "idempotency_conflict"].includes(r.outcome))
      throw new TechnicalFileSnapshotConflictError(
        typeof (r.result as Record<string, unknown>)?.currentVersion ===
          "number"
          ? (r.result as Record<string, number>).currentVersion
          : null,
      );
    if (["forbidden", "invalid_request"].includes(r.outcome))
      throw new TechnicalFileSnapshotInvalidRequestError();
  }
  private export(
    r: {
      outcome: string;
      result: unknown;
    },
    enveloped = false,
  ): TechnicalFileSnapshotExport | null {
    this.fail(r);
    return r.outcome === "not_found"
      ? null
      : technicalFileSnapshotExportResponseSchema.parse(
          enveloped ? r.result : { export: r.result },
        ).export;
  }
}
function scope(org: string, input: { actorId: string; productId: string }) {
  return {
    p_organization_id: org,
    p_actor_user_id: input.actorId,
    p_product_id: input.productId,
  };
}
