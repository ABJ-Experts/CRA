import type { Readable } from "node:stream";
import type { z } from "zod";
import type {
  createReportDefinitionSchema,
  updateReportDefinitionSchema,
  reportMutationSchema,
  reportListQuerySchema,
  reportRunsQuerySchema,
  reportDefinitionResponseSchema,
  reportDefinitionListResponseSchema,
  reportRunDetailResponseSchema,
  reportRunListResponseSchema,
  reportRecipientsResponseSchema,
  reportManifestResponseSchema,
  reportDownloadGrantResponseSchema,
  reportEmailPreferenceSchema,
  reportEmailPreferenceInputSchema,
  reportAdministrationListResponseSchema,
  reportAdministrationMutationResponseSchema,
} from "@repo/contracts/reports/schemas";

export type ReportPrincipal = Readonly<{
  organizationId: string;
  actorId: string;
  sessionId: string;
  role: import("@repo/contracts/permissions").BaseRole;
}>;
export type CreateReportInput = z.output<typeof createReportDefinitionSchema>;
export type UpdateReportInput = z.output<typeof updateReportDefinitionSchema>;
export type ReportMutationInput = z.output<typeof reportMutationSchema>;
export type ReportListQuery = z.output<typeof reportListQuerySchema>;
export type ReportRunsQuery = z.output<typeof reportRunsQuerySchema>;
export type ReportDefinitionResponse = z.output<
  typeof reportDefinitionResponseSchema
>;
export type ReportDefinitionListResponse = z.output<
  typeof reportDefinitionListResponseSchema
>;
export type ReportRunDetailResponse = z.output<
  typeof reportRunDetailResponseSchema
>;
export type ReportRunListResponse = z.output<
  typeof reportRunListResponseSchema
>;
export type ReportRecipientsResponse = z.output<
  typeof reportRecipientsResponseSchema
>;
export type ReportManifestResponse = z.output<
  typeof reportManifestResponseSchema
>;
export type ReportGrantResponse = z.output<
  typeof reportDownloadGrantResponseSchema
>;
export type ReportEmailPreference = z.output<
  typeof reportEmailPreferenceSchema
>;
export type ReportEmailPreferenceInput = z.output<
  typeof reportEmailPreferenceInputSchema
>;
export type ReportAdministrationList = z.output<
  typeof reportAdministrationListResponseSchema
>;
export type ReportAdministrationMutation = z.output<
  typeof reportAdministrationMutationResponseSchema
>;
export type ReportDownload = Readonly<{
  body: Readable;
  byteLength: number;
  sha256: string;
  mediaType: string;
  name: string;
  cleanup: () => Promise<void>;
}>;

export interface ReportsPort {
  create(
    orgId: string,
    principal: ReportPrincipal,
    input: CreateReportInput,
  ): Promise<ReportDefinitionResponse>;
  update(
    orgId: string,
    principal: ReportPrincipal,
    id: string,
    input: UpdateReportInput,
  ): Promise<ReportDefinitionResponse>;
  get(
    orgId: string,
    principal: ReportPrincipal,
    id: string,
  ): Promise<ReportDefinitionResponse>;
  list(
    orgId: string,
    principal: ReportPrincipal,
    query: ReportListQuery,
  ): Promise<ReportDefinitionListResponse>;
  mutate(
    orgId: string,
    principal: ReportPrincipal,
    id: string,
    operation: "activate" | "pause" | "resume" | "archive",
    input: ReportMutationInput,
  ): Promise<ReportDefinitionResponse>;
  preview(
    orgId: string,
    principal: ReportPrincipal,
    id: string,
    input: ReportMutationInput,
  ): Promise<ReportRunDetailResponse>;
  getRun(
    orgId: string,
    principal: ReportPrincipal,
    id: string,
  ): Promise<ReportRunDetailResponse>;
  listRuns(
    orgId: string,
    principal: ReportPrincipal,
    query: ReportRunsQuery,
  ): Promise<ReportRunListResponse>;
  replay(
    orgId: string,
    principal: ReportPrincipal,
    id: string,
    input: ReportMutationInput,
  ): Promise<ReportRunDetailResponse>;
  recipients(
    orgId: string,
    principal: ReportPrincipal,
    query: ReportListQuery,
  ): Promise<ReportRecipientsResponse>;
  manifest(
    orgId: string,
    principal: ReportPrincipal,
    runId: string,
    recipientId: string,
  ): Promise<ReportManifestResponse>;
  grant(
    orgId: string,
    principal: ReportPrincipal,
    runId: string,
    recipientId: string,
    artifactId: string,
    digest: string,
  ): Promise<ReportGrantResponse>;
  download(
    orgId: string,
    principal: ReportPrincipal,
    runId: string,
    recipientId: string,
    grantId: string,
    digest: string,
  ): Promise<ReportDownload>;
  getEmailPreference(
    orgId: string,
    principal: ReportPrincipal,
  ): Promise<ReportEmailPreference>;
  setEmailPreference(
    orgId: string,
    principal: ReportPrincipal,
    input: ReportEmailPreferenceInput,
  ): Promise<ReportEmailPreference>;
  listAdministration(
    orgId: string,
    principal: ReportPrincipal,
    query: ReportListQuery,
  ): Promise<ReportAdministrationList>;
  adminPause(
    orgId: string,
    principal: ReportPrincipal,
    id: string,
    input: ReportMutationInput,
  ): Promise<ReportAdministrationMutation>;
}
