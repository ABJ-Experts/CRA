import { Injectable } from "@nestjs/common";
import { z } from "zod";
import {
  reportDefinitionResponseSchema,
  reportDefinitionListResponseSchema,
  reportRunDetailResponseSchema,
  reportRunListResponseSchema,
  reportRecipientsResponseSchema,
  reportManifestResponseSchema,
  reportDownloadGrantResponseSchema,
  reportEmailPreferenceSchema,
  reportAdministrationListResponseSchema,
  reportAdministrationMutationResponseSchema,
} from "@repo/contracts/reports/schemas";
import { SupabaseService } from "../../supabase/supabase.service";
import {
  ExportDeliveryAdapter,
  privateExportArtifactSchema,
} from "../../exports/infrastructure/export-delivery.adapter";
import { ExportAccessDeniedError } from "../../exports/domain/export.errors";
import {
  ReportAccessDeniedError,
  ReportConflictError,
  ReportInvalidRequestError,
  ReportUnavailableError,
} from "../domain/report.errors";
import { sourceSchemaDigest } from "../domain/report-source-digest";
import type {
  CreateReportInput,
  ReportEmailPreferenceInput,
  ReportListQuery,
  ReportMutationInput,
  ReportPrincipal,
  ReportRunsQuery,
  ReportsPort,
  UpdateReportInput,
} from "../application/reports.port";

type RpcResult = Readonly<{ data: unknown; error: { code?: string } | null }>;
type RpcClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>;
}>;
const redeemedSchema = z
  .object({
    artifact: privateExportArtifactSchema,
    exportJobId: z.uuid(),
  })
  .strict();

@Injectable()
export class SupabaseReportsRepository implements ReportsPort {
  constructor(private readonly supabase: SupabaseService) {}

  create(orgId: string, p: ReportPrincipal, input: CreateReportInput) {
    return this.call(
      "m14_04_create_definition",
      {
        ...this.actor(orgId, p),
        p_input: input,
        p_schema_digest: sourceSchemaDigest(input.config.report),
      },
      reportDefinitionResponseSchema,
    );
  }
  update(
    orgId: string,
    p: ReportPrincipal,
    id: string,
    input: UpdateReportInput,
  ) {
    return this.call(
      "m14_04_update_definition",
      {
        ...this.actor(orgId, p),
        p_definition_id: id,
        p_input: input,
        p_schema_digest: sourceSchemaDigest(input.config.report),
      },
      reportDefinitionResponseSchema,
    );
  }
  get(orgId: string, p: ReportPrincipal, id: string) {
    return this.call(
      "m14_04_get_definition",
      { ...this.actor(orgId, p), p_definition_id: id },
      reportDefinitionResponseSchema,
    );
  }
  list(orgId: string, p: ReportPrincipal, query: ReportListQuery) {
    return this.call(
      "m14_04_list_definitions",
      { ...this.actor(orgId, p), p_query: query },
      reportDefinitionListResponseSchema,
    );
  }
  mutate(
    orgId: string,
    p: ReportPrincipal,
    id: string,
    operation: "activate" | "pause" | "resume" | "archive",
    input: ReportMutationInput,
  ) {
    return this.call(
      "m14_04_mutate_definition",
      {
        ...this.actor(orgId, p),
        p_definition_id: id,
        p_operation: operation,
        p_input: input,
      },
      reportDefinitionResponseSchema,
    );
  }
  preview(
    orgId: string,
    p: ReportPrincipal,
    id: string,
    input: ReportMutationInput,
  ) {
    return this.call(
      "m14_04_preview",
      { ...this.actor(orgId, p), p_definition_id: id, p_input: input },
      reportRunDetailResponseSchema,
    );
  }
  getRun(orgId: string, p: ReportPrincipal, id: string) {
    return this.call(
      "m14_04_get_run",
      { ...this.actor(orgId, p), p_run_id: id },
      reportRunDetailResponseSchema,
    );
  }
  listRuns(orgId: string, p: ReportPrincipal, query: ReportRunsQuery) {
    return this.call(
      "m14_04_list_runs",
      { ...this.actor(orgId, p), p_query: query },
      reportRunListResponseSchema,
    );
  }
  replay(
    orgId: string,
    p: ReportPrincipal,
    id: string,
    input: ReportMutationInput,
  ) {
    return this.call(
      "m14_04_replay",
      { ...this.actor(orgId, p), p_run_id: id, p_input: input },
      reportRunDetailResponseSchema,
    );
  }
  recipients(orgId: string, p: ReportPrincipal, query: ReportListQuery) {
    return this.call(
      "m14_04_recipients",
      { ...this.actor(orgId, p), p_query: query },
      reportRecipientsResponseSchema,
    );
  }
  manifest(
    orgId: string,
    p: ReportPrincipal,
    runId: string,
    recipientId: string,
  ) {
    return this.callDelivery(
      "m14_04_manifest",
      { ...this.actor(orgId, p), p_run_id: runId, p_recipient_id: recipientId },
      reportManifestResponseSchema,
    );
  }
  grant(
    orgId: string,
    p: ReportPrincipal,
    runId: string,
    recipientId: string,
    artifactId: string,
    digest: string,
  ) {
    return this.callDelivery(
      "m14_04_grant",
      {
        ...this.actor(orgId, p),
        p_session_id: p.sessionId,
        p_run_id: runId,
        p_recipient_id: recipientId,
        p_artifact_id: artifactId,
        p_token_digest: digest,
      },
      reportDownloadGrantResponseSchema,
    );
  }
  async download(
    orgId: string,
    p: ReportPrincipal,
    runId: string,
    recipientId: string,
    grantId: string,
    digest: string,
  ) {
    const redeemed = await this.callDelivery(
      "m14_04_redeem",
      {
        ...this.actor(orgId, p),
        p_session_id: p.sessionId,
        p_run_id: runId,
        p_recipient_id: recipientId,
        p_grant_id: grantId,
        p_token_digest: digest,
      },
      redeemedSchema,
    );
    return new ExportDeliveryAdapter(this.supabase).open(
      orgId,
      redeemed.exportJobId,
      redeemed.artifact,
      async () => {
        const authorized = await this.call(
          "m14_04_authorize_download",
          {
            ...this.actor(orgId, p),
            p_session_id: p.sessionId,
            p_run_id: runId,
            p_recipient_id: recipientId,
          },
          z.boolean(),
        );
        if (!authorized) throw new ExportAccessDeniedError();
      },
    );
  }
  getEmailPreference(orgId: string, p: ReportPrincipal) {
    return this.callDelivery(
      "m14_04_get_email_preference",
      this.actor(orgId, p),
      reportEmailPreferenceSchema,
    );
  }
  setEmailPreference(
    orgId: string,
    p: ReportPrincipal,
    input: ReportEmailPreferenceInput,
  ) {
    return this.callDelivery(
      "m14_04_set_email_preference",
      { ...this.actor(orgId, p), p_input: input },
      reportEmailPreferenceSchema,
    );
  }
  listAdministration(
    orgId: string,
    p: ReportPrincipal,
    query: ReportListQuery,
  ) {
    return this.call(
      "m14_04_list_administration",
      { ...this.actor(orgId, p), p_query: query },
      reportAdministrationListResponseSchema,
    );
  }
  adminPause(
    orgId: string,
    p: ReportPrincipal,
    id: string,
    input: ReportMutationInput,
  ) {
    return this.call(
      "m14_04_admin_pause",
      { ...this.actor(orgId, p), p_definition_id: id, p_input: input },
      reportAdministrationMutationResponseSchema,
    );
  }
  private actor(orgId: string, p: ReportPrincipal) {
    if (orgId !== p.organizationId) throw new ReportAccessDeniedError();
    return { p_organization_id: orgId, p_actor_user_id: p.actorId };
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
      throw new ReportUnavailableError();
    }
    if (result.error) {
      const code = result.error.code ?? "";
      if (["42501", "P0002"].includes(code))
        throw new ReportAccessDeniedError();
      if (["40001", "23505", "P0001"].includes(code))
        throw new ReportConflictError();
      if (code === "22023") throw new ReportInvalidRequestError();
      throw new ReportUnavailableError();
    }
    const parsed = schema.safeParse(result.data);
    if (!parsed.success) throw new ReportUnavailableError();
    return parsed.data;
  }
  private async callDelivery<T>(
    name: string,
    args: Record<string, unknown>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const row = await this.call(
      name,
      args,
      z.array(z.object({ outcome: z.string(), result: z.unknown() })).length(1),
    );
    const result = row[0];
    if (!result) throw new ReportUnavailableError();
    if (["conflict", "idempotency_conflict"].includes(result.outcome))
      throw new ReportConflictError();
    if (result.outcome === "invalid_request")
      throw new ReportInvalidRequestError();
    if (["forbidden", "not_found"].includes(result.outcome))
      throw new ReportAccessDeniedError();
    if (!["found", "updated", "replayed"].includes(result.outcome))
      throw new ReportUnavailableError();
    const parsed = schema.safeParse(result.result);
    if (!parsed.success) throw new ReportUnavailableError();
    return parsed.data;
  }
}
