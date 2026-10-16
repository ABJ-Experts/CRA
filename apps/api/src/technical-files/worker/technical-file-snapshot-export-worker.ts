import { Injectable } from "@nestjs/common";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import {
  technicalFileSnapshotExportResponseSchema,
  technicalFileSnapshotResponseSchema,
} from "@repo/contracts/technical-files";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  renderTechnicalFileSnapshotExport,
  TechnicalFileSnapshotRenderError,
} from "./technical-file-snapshot-export-renderer";

const bucket = "technical-file-snapshot-exports";
const claimSchema = z
  .object({
    export: technicalFileSnapshotExportResponseSchema.shape.export,
    snapshot: technicalFileSnapshotResponseSchema.shape.snapshot,
  })
  .strict();
const durableExportStateSchema = z
  .object({
    status: z.enum([
      "queued",
      "generating",
      "ready",
      "failed",
      "superseded",
      "cancelled",
    ]),
    lease_owner: z.string().uuid().nullable(),
  })
  .strict();

class SnapshotExportStorageError extends Error {}

/** Processes one leased immutable export; it never fetches live documents or sources. */
@Injectable()
export class TechnicalFileSnapshotExportWorker {
  constructor(private readonly supabase: SupabaseService) {}

  /** Starts one global queue pass; the claimed row supplies the verified tenant. */
  async processOne(workerId: string): Promise<"empty" | "ready" | "failed"> {
    return this.claimAndProcessOne(workerId);
  }

  /** Global private-queue claim; tenant scope is obtained only from the leased row. */
  private async claimAndProcessOne(
    workerId: string,
  ): Promise<"empty" | "ready" | "failed"> {
    const claimed = await this.rpc("claim_technical_file_snapshot_export", {
      p_worker_id: workerId,
      p_lease_seconds: 120,
    });
    if (claimed.outcome === "empty") return "empty";
    if (claimed.outcome !== "claimed")
      throw new Error("snapshot export claim unavailable");
    const claim = claimSchema.parse(claimed.result);
    const uploaded: string[] = [];
    try {
      const rendered = await renderTechnicalFileSnapshotExport(claim.snapshot);
      const organizationId = claim.snapshot.organizationId;
      const base = `${organizationId}/${claim.export.id}/${randomUUID()}`;
      const files = [
        ["pdf", `${base}/technical-file.pdf`, rendered.pdf, "application/pdf"],
        [
          "archive",
          `${base}/technical-file.zip`,
          rendered.archive,
          "application/zip",
        ],
        [
          "manifest",
          `${base}/manifest.json`,
          rendered.manifest,
          "application/json",
        ],
      ] as const;
      for (const [, path, bytes, contentType] of files) {
        const upload = await this.supabase
          .admin()
          .storage.from(bucket)
          .upload(path, bytes, { contentType, upsert: false });
        if (upload.error) throw new SnapshotExportStorageError();
        uploaded.push(path);
      }
      const finalized = await this.rpc(
        "finalize_technical_file_snapshot_export_atomic",
        {
          p_organization_id: organizationId,
          p_export_id: claim.export.id,
          p_worker_id: workerId,
          p_pdf_path: files[0][1],
          p_pdf_sha256: digest(rendered.pdf),
          p_pdf_bytes: rendered.pdf.byteLength,
          p_archive_path: files[1][1],
          p_archive_sha256: digest(rendered.archive),
          p_archive_bytes: rendered.archive.byteLength,
          p_manifest_path: files[2][1],
          p_manifest_sha256: rendered.manifestSha256,
          p_manifest_bytes: rendered.manifest.byteLength,
        },
      );
      if (finalized.outcome !== "ready")
        throw new Error("snapshot export finalize unavailable");
      return "ready";
    } catch (error) {
      // A finalization RPC can succeed while its response is lost.  Never
      // delete a possibly-ready artifact based only on the caught error.
      // Cleanup is limited to a subsequent, tenant-scoped read that confirms
      // a terminal non-ready state after the failure command committed.
      const canCleanUp = await this.failAndConfirmNonReady(
        claim.snapshot.organizationId,
        claim.export.id,
        workerId,
        snapshotExportFailureCode(error),
      );
      if (uploaded.length > 0 && canCleanUp) {
        await this.supabase
          .admin()
          .storage.from(bucket)
          .remove(uploaded)
          .catch(() => undefined);
      }
      return "failed";
    }
  }

  /**
   * Returns true only after the durable row confirms this attempt cannot have
   * become ready.  A failed probe deliberately leaves private orphan objects
   * for later retention cleanup instead of risking a ready export.
   */
  private async failAndConfirmNonReady(
    organizationId: string,
    exportId: string,
    workerId: string,
    code: SnapshotExportFailureCode,
  ): Promise<boolean> {
    try {
      const failed = await this.rpc(
        "fail_technical_file_snapshot_export_atomic",
        {
          p_organization_id: organizationId,
          p_export_id: exportId,
          p_worker_id: workerId,
          p_failure_code: code,
        },
      );
      if (failed.outcome !== "failed") return false;
      const state = await this.durableExportState(organizationId, exportId);
      return shouldRemoveUploadedArtifacts(state);
    } catch {
      return false;
    }
  }

  /** Service-role lookup is organization-first and only inspects this lease. */
  private async durableExportState(organizationId: string, exportId: string) {
    const client = this.supabase.admin() as unknown as {
      from(table: "technical_file_snapshot_exports"): {
        select(columns: "status, lease_owner"): {
          eq(
            column: "organization_id",
            value: string,
          ): {
            eq(
              column: "id",
              value: string,
            ): {
              maybeSingle(): Promise<{
                data: unknown;
                error: { message?: string } | null;
              }>;
            };
          };
        };
      };
    };
    const response = await client
      .from("technical_file_snapshot_exports")
      .select("status, lease_owner")
      .eq("organization_id", organizationId)
      .eq("id", exportId)
      .maybeSingle();
    if (response.error || response.data === null) return null;
    const parsed = durableExportStateSchema.safeParse(response.data);
    return parsed.success ? parsed.data : null;
  }

  private async rpc(name: string, args: Record<string, unknown>) {
    const client = this.supabase.admin() as unknown as {
      rpc(
        name: string,
        args: Record<string, unknown>,
      ): Promise<{ data: unknown; error: { message?: string } | null }>;
    };
    const response = await client.rpc(name, args);
    if (response.error)
      throw new Error(
        response.error.message ?? "snapshot export RPC unavailable",
      );
    const row = Array.isArray(response.data)
      ? (response.data[0] as unknown)
      : response.data;
    const parsed = z
      .object({ outcome: z.string(), result: z.unknown().nullable() })
      .safeParse(row);
    if (!parsed.success)
      throw new Error("invalid snapshot export RPC response");
    return parsed.data;
  }
}
function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

type SnapshotExportFailureCode =
  | "snapshot_unavailable"
  | "artifact_too_large"
  | "storage_unavailable"
  | "source_unavailable"
  | "worker_unavailable"
  | "unknown";

export function snapshotExportFailureCode(
  error: unknown,
): SnapshotExportFailureCode {
  if (error instanceof TechnicalFileSnapshotRenderError) return error.code;
  if (error instanceof SnapshotExportStorageError) return "storage_unavailable";
  if (error instanceof z.ZodError) return "snapshot_unavailable";
  return "unknown";
}

/** Never cleanup after an uncertain or ready finalization outcome. */
export function shouldRemoveUploadedArtifacts(
  state: z.output<typeof durableExportStateSchema> | null,
): boolean {
  return state?.status === "failed" && state.lease_owner === null;
}
