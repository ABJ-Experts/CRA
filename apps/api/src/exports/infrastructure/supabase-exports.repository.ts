import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  exportJobSchema,
  exportJobListResponseSchema,
  exportDownloadGrantSchema,
  exportManifestSchema,
} from "@repo/contracts/exports";
import {
  ExportDeliveryAdapter,
  privateExportArtifactSchema,
} from "./export-delivery.adapter";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  ExportAccessDeniedError,
  ExportConflictError,
  ExportInvalidRequestError,
  ExportUnavailableError,
} from "../domain/export.errors";
import type { ExportPrincipal } from "../application/export-principal";
import type {
  ExportsPort,
  ExportInput,
  ReadinessExportInput,
  ExportListQuery,
  ExportDownload,
} from "../application/exports.port";

const privateArtifactSchema = z.object({
  artifact: privateExportArtifactSchema,
});
type RpcResult = Readonly<{
  data: unknown;
  error: { code?: string; message?: string } | null;
}>;
type RpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
}>;
@Injectable()
export class SupabaseExportsRepository implements ExportsPort {
  constructor(private readonly supabase: SupabaseService) {}
  create(
    orgId: string,
    p: ExportPrincipal,
    input: ExportInput,
    trustedContext: Readonly<Record<string, unknown>> = {},
  ) {
    return this.call(
      "m14_03_create_export",
      {
        ...this.principalArgs(orgId, p),
        p_input: { ...input, context: { ...input.context, ...trustedContext } },
      },
      exportJobSchema,
    );
  }
  createReadiness(
    orgId: string,
    p: ExportPrincipal,
    input: ReadinessExportInput,
  ) {
    return this.call(
      "m14_03_create_readiness_export",
      { ...this.principalArgs(orgId, p), p_input: input },
      exportJobSchema,
    );
  }
  list(orgId: string, p: ExportPrincipal, query: ExportListQuery) {
    return this.call(
      "m14_03_list_exports",
      { ...this.principalArgs(orgId, p), p_query: query },
      exportJobListResponseSchema,
    );
  }
  get(orgId: string, p: ExportPrincipal, jobId: string) {
    return this.call(
      "m14_03_get_export",
      { ...this.principalArgs(orgId, p), p_job_id: jobId },
      exportJobSchema,
    );
  }
  manifest(orgId: string, p: ExportPrincipal, jobId: string) {
    return this.call(
      "m14_03_get_export_manifest",
      { ...this.principalArgs(orgId, p), p_job_id: jobId },
      exportManifestSchema,
    );
  }
  mutate(
    orgId: string,
    p: ExportPrincipal,
    jobId: string,
    expectedVersion: number,
    idempotencyKey: string,
    operation: "cancel" | "retry",
  ) {
    return this.call(
      `m14_03_${operation}_export`,
      {
        ...this.principalArgs(orgId, p),
        p_job_id: jobId,
        p_expected_version: expectedVersion,
        p_idempotency_key: idempotencyKey,
      },
      exportJobSchema,
    );
  }
  grant(
    orgId: string,
    p: ExportPrincipal,
    jobId: string,
    artifactId: string,
    digest: string,
  ) {
    return this.call(
      "m14_03_issue_export_download_grant",
      {
        ...this.principalArgs(orgId, p),
        p_job_id: jobId,
        p_artifact_id: artifactId,
        p_token_digest: digest,
      },
      exportDownloadGrantSchema,
    );
  }
  async download(
    orgId: string,
    p: ExportPrincipal,
    jobId: string,
    grantId: string,
    digest: string,
  ): Promise<ExportDownload> {
    const { artifact } = await this.call(
      "m14_03_redeem_export_download_grant",
      {
        ...this.principalArgs(orgId, p),
        p_job_id: jobId,
        p_grant_id: grantId,
        p_token_digest: digest,
      },
      privateArtifactSchema,
    );
    return new ExportDeliveryAdapter(this.supabase).open(
      orgId,
      jobId,
      artifact,
      () => this.get(orgId, p, jobId),
    );
  }
  private principalArgs(orgId: string, p: ExportPrincipal) {
    if (orgId !== p.organizationId) throw new ExportAccessDeniedError();
    return {
      p_organization_id: orgId,
      p_actor_user_id: p.actorId,
      p_session_id: p.sessionId,
    };
  }
  private async call<T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    let result: RpcResult;
    try {
      result = await (this.supabase.admin() as unknown as RpcClient).rpc(
        name,
        args,
      );
    } catch {
      throw new ExportUnavailableError();
    }
    if (result.error) {
      if (["42501", "P0002"].includes(result.error.code ?? ""))
        throw new ExportAccessDeniedError();
      if (["40001", "23505", "P0001"].includes(result.error.code ?? ""))
        throw new ExportConflictError();
      if (result.error.code === "22023") throw new ExportInvalidRequestError();
      throw new ExportUnavailableError();
    }
    const parsed = schema.safeParse(result.data);
    if (!parsed.success) throw new ExportUnavailableError();
    return parsed.data;
  }
}
