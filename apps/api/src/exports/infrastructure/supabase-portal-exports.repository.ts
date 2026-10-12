import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  exportJobSchema,
  exportJobListResponseSchema,
  exportDownloadGrantSchema,
  exportManifestSchema,
} from "@repo/contracts/exports";
import { SupabaseService } from "../../supabase/supabase.service";
import type { ExportInput, ExportListQuery } from "../application/exports.port";
import type { PortalExportsPort } from "../application/portal-exports.port";
import type { PortalExportPrincipal } from "../application/portal-export-principal";
import {
  ExportAccessDeniedError,
  ExportConflictError,
  ExportInvalidRequestError,
  ExportUnavailableError,
} from "../domain/export.errors";
import {
  ExportDeliveryAdapter,
  privateExportArtifactSchema,
} from "./export-delivery.adapter";
const delivery = z.object({
  organizationId: z.uuid(),
  artifact: privateExportArtifactSchema,
});
type Rpc = (
  name: string,
  args: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: { code?: string } | null }>;
@Injectable()
export class SupabasePortalExportsRepository implements PortalExportsPort {
  constructor(private readonly supabase: SupabaseService) {}
  create(p: PortalExportPrincipal, input: ExportInput) {
    return this.call(
      "create_portal_export",
      { ...args(p), p_input: input },
      exportJobSchema,
    );
  }
  list(p: PortalExportPrincipal, query: ExportListQuery) {
    return this.call(
      "list_portal_exports",
      { ...args(p), p_query: query },
      exportJobListResponseSchema,
    );
  }
  get(p: PortalExportPrincipal, jobId: string) {
    return this.call(
      "get_portal_export",
      { ...args(p), p_job_id: jobId },
      exportJobSchema,
    );
  }
  manifest(p: PortalExportPrincipal, jobId: string) {
    return this.call(
      "get_portal_export_manifest",
      { ...args(p), p_job_id: jobId },
      exportManifestSchema,
    );
  }
  mutate(
    p: PortalExportPrincipal,
    jobId: string,
    expectedVersion: number,
    idempotencyKey: string,
    operation: "cancel" | "retry",
  ) {
    return this.call(
      "mutate_portal_export",
      {
        ...args(p),
        p_job_id: jobId,
        p_expected_version: expectedVersion,
        p_idempotency_key: idempotencyKey,
        p_operation: operation,
      },
      exportJobSchema,
    );
  }
  grant(
    p: PortalExportPrincipal,
    jobId: string,
    artifactId: string,
    digest: string,
  ) {
    return this.call(
      "issue_portal_export_download_grant",
      {
        ...args(p),
        p_job_id: jobId,
        p_artifact_id: artifactId,
        p_token_digest: digest,
      },
      exportDownloadGrantSchema,
    );
  }
  async download(
    p: PortalExportPrincipal,
    jobId: string,
    grantId: string,
    digest: string,
  ) {
    const value = await this.call(
      "redeem_portal_export_download_grant",
      {
        ...args(p),
        p_job_id: jobId,
        p_grant_id: grantId,
        p_token_digest: digest,
      },
      delivery,
    );
    return new ExportDeliveryAdapter(this.supabase).open(
      value.organizationId,
      jobId,
      value.artifact,
      () => this.get(p, jobId),
    );
  }
  private async call<T>(
    name: string,
    parameters: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let result: Awaited<ReturnType<Rpc>>;
    try {
      const client = this.supabase.admin() as unknown as { rpc: Rpc };
      result = await client.rpc(`m14_03_${name}`, parameters);
    } catch {
      throw new ExportUnavailableError();
    }
    if (result.error) {
      const code = result.error.code;
      if (code === "42501" || code === "P0002")
        throw new ExportAccessDeniedError();
      if (code === "40001" || code === "23505" || code === "P0001")
        throw new ExportConflictError();
      if (code === "22023") throw new ExportInvalidRequestError();
      throw new ExportUnavailableError();
    }
    const parsed = schema.safeParse(result.data);
    if (!parsed.success) throw new ExportUnavailableError();
    return parsed.data;
  }
}
function args(p: PortalExportPrincipal) {
  return { p_subject_kind: p.kind, p_session_digest: p.sessionDigest };
}
