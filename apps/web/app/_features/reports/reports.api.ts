import {
  createReportDefinitionSchema,
  updateReportDefinitionSchema,
  reportMutationSchema,
  reportDefinitionParamsSchema,
  reportRunParamsSchema,
  reportRecipientParamsSchema,
  reportListQuerySchema,
  reportRunsQuerySchema,
  reportGrantInputSchema,
  reportEmailPreferenceInputSchema,
  reportDefinitionResponseSchema,
  reportDefinitionListResponseSchema,
  reportRunDetailResponseSchema,
  reportRunListResponseSchema,
  reportRecipientsResponseSchema,
  reportEmailPreferenceSchema,
  reportManifestResponseSchema,
  reportDownloadGrantResponseSchema,
  reportAdministrationListResponseSchema,
  reportAdministrationMutationResponseSchema,
} from "@repo/contracts/reports";
import type { z } from "zod";
import { authenticatedApiClient } from "../../_lib/http/authenticated-request";
import type { AuthenticatedApiClient } from "../../_lib/http/authenticated-request";

const base = "/api/v1/reports" as const;
type CreateReportDefinitionInput = z.input<typeof createReportDefinitionSchema>;
type UpdateReportDefinitionInput = z.input<typeof updateReportDefinitionSchema>;
type ReportMutationInput = z.input<typeof reportMutationSchema>;
type ReportListQuery = z.input<typeof reportListQuerySchema>;
type ReportRunsQuery = z.input<typeof reportRunsQuerySchema>;
type ReportEmailPreferenceInput = z.input<
  typeof reportEmailPreferenceInputSchema
>;

function queryPath(
  path: `/${string}`,
  query: Record<string, unknown>,
): `/${string}` {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) search.set(key, String(value));
  }
  const encoded = search.toString();
  return encoded ? `${path}?${encoded}` : path;
}

/** Browser transport for the parsed, organization-scoped reports API. */
export class ReportsGateway {
  constructor(
    private readonly client: Pick<
      AuthenticatedApiClient,
      "request"
    > = authenticatedApiClient,
  ) {}

  private definitionPath(definitionId: string): `/${string}` {
    const parsed = reportDefinitionParamsSchema.parse({ definitionId });
    return `${base}/definitions/${parsed.definitionId}`;
  }

  private runPath(runId: string): `/${string}` {
    const parsed = reportRunParamsSchema.parse({ runId });
    return `${base}/runs/${parsed.runId}`;
  }

  private recipientPath(runId: string, recipientId: string): `/${string}` {
    const parsed = reportRecipientParamsSchema.parse({ runId, recipientId });
    return `${base}/runs/${parsed.runId}/recipients/${parsed.recipientId}`;
  }

  list(query: Partial<ReportListQuery> = {}, signal?: AbortSignal) {
    const parsed = reportListQuerySchema.parse(query);
    return this.client.request({
      path: queryPath(`${base}/definitions`, parsed),
      schema: reportDefinitionListResponseSchema,
      signal,
    });
  }

  get(definitionId: string, signal?: AbortSignal) {
    return this.client.request({
      path: this.definitionPath(definitionId),
      schema: reportDefinitionResponseSchema,
      signal,
    });
  }

  create(input: CreateReportDefinitionInput, signal?: AbortSignal) {
    return this.client.request({
      path: `${base}/definitions`,
      method: "POST",
      body: input,
      inputSchema: createReportDefinitionSchema,
      schema: reportDefinitionResponseSchema,
      signal,
    });
  }

  update(
    definitionId: string,
    input: UpdateReportDefinitionInput,
    signal?: AbortSignal,
  ) {
    return this.client.request({
      path: this.definitionPath(definitionId),
      method: "PATCH",
      body: input,
      inputSchema: updateReportDefinitionSchema,
      schema: reportDefinitionResponseSchema,
      signal,
    });
  }

  private definitionCommand(
    definitionId: string,
    operation: "activate" | "pause" | "resume" | "archive",
    input: ReportMutationInput,
    signal?: AbortSignal,
  ) {
    return this.client.request({
      path: `${this.definitionPath(definitionId)}/${operation}`,
      method: "POST",
      body: input,
      inputSchema: reportMutationSchema,
      schema: reportDefinitionResponseSchema,
      signal,
    });
  }

  preview(id: string, input: ReportMutationInput, signal?: AbortSignal) {
    return this.client.request({
      path: `${this.definitionPath(id)}/preview`,
      method: "POST",
      body: input,
      inputSchema: reportMutationSchema,
      schema: reportRunDetailResponseSchema,
      signal,
    });
  }
  activate(id: string, input: ReportMutationInput, signal?: AbortSignal) {
    return this.definitionCommand(id, "activate", input, signal);
  }
  pause(id: string, input: ReportMutationInput, signal?: AbortSignal) {
    return this.definitionCommand(id, "pause", input, signal);
  }
  resume(id: string, input: ReportMutationInput, signal?: AbortSignal) {
    return this.definitionCommand(id, "resume", input, signal);
  }
  archive(id: string, input: ReportMutationInput, signal?: AbortSignal) {
    return this.definitionCommand(id, "archive", input, signal);
  }

  runs(query: Partial<ReportRunsQuery> = {}, signal?: AbortSignal) {
    const parsed = reportRunsQuerySchema.parse(query);
    return this.client.request({
      path: queryPath(`${base}/runs`, parsed),
      schema: reportRunListResponseSchema,
      signal,
    });
  }
  run(runId: string, signal?: AbortSignal) {
    return this.client.request({
      path: this.runPath(runId),
      schema: reportRunDetailResponseSchema,
      signal,
    });
  }
  replay(runId: string, input: ReportMutationInput, signal?: AbortSignal) {
    return this.client.request({
      path: `${this.runPath(runId)}/replay`,
      method: "POST",
      body: input,
      inputSchema: reportMutationSchema,
      schema: reportRunDetailResponseSchema,
      signal,
    });
  }
  recipients(query: Partial<ReportListQuery> = {}, signal?: AbortSignal) {
    const parsed = reportListQuerySchema.parse(query);
    return this.client.request({
      path: queryPath(`${base}/recipients`, parsed),
      schema: reportRecipientsResponseSchema,
      signal,
    });
  }
  manifest(runId: string, recipientId: string, signal?: AbortSignal) {
    return this.client.request({
      path: `${this.recipientPath(runId, recipientId)}/manifest`,
      schema: reportManifestResponseSchema,
      signal,
    });
  }
  grant(
    runId: string,
    recipientId: string,
    artifactId: string,
    signal?: AbortSignal,
  ) {
    return this.client.request({
      path: `${this.recipientPath(runId, recipientId)}/download-grants`,
      method: "POST",
      body: { artifactId },
      inputSchema: reportGrantInputSchema,
      schema: reportDownloadGrantResponseSchema,
      signal,
    });
  }
  emailPreference(signal?: AbortSignal) {
    return this.client.request({
      path: `${base}/email-preference`,
      schema: reportEmailPreferenceSchema,
      signal,
    });
  }
  setEmailPreference(input: ReportEmailPreferenceInput, signal?: AbortSignal) {
    return this.client.request({
      path: `${base}/email-preference`,
      method: "PATCH",
      body: input,
      inputSchema: reportEmailPreferenceInputSchema,
      schema: reportEmailPreferenceSchema,
      signal,
    });
  }

  administration(query: Partial<ReportListQuery> = {}, signal?: AbortSignal) {
    const parsed = reportListQuerySchema.parse(query);
    return this.client.request({
      path: queryPath(`${base}/administration`, parsed),
      schema: reportAdministrationListResponseSchema,
      signal,
    });
  }

  administrationPause(
    definitionId: string,
    input: ReportMutationInput,
    signal?: AbortSignal,
  ) {
    return this.client.request({
      path: `${base}/administration/${reportDefinitionParamsSchema.parse({ definitionId }).definitionId}/pause`,
      method: "POST",
      body: input,
      inputSchema: reportMutationSchema,
      schema: reportAdministrationMutationResponseSchema,
      signal,
    });
  }
}

export const reportsGateway = new ReportsGateway();
