import { z } from "zod";
import {
  diagnosticPreviewInputSchema,
  diagnosticPreviewSchema,
  diagnosticCreateSchema,
  diagnosticMutationSchema,
  diagnosticCleanupInputSchema,
  diagnosticJobParamsSchema,
  diagnosticListQuerySchema,
  diagnosticContentQuerySchema,
  diagnosticJobSchema,
  diagnosticListSchema,
  diagnosticContentSchema,
  diagnosticGrantSchema,
  diagnosticCleanupReviewSchema,
} from "@repo/contracts/support-diagnostics/schemas";
import type {
  SupportDiagnosticPreviewInput,
  SupportDiagnosticCreate,
  SupportDiagnosticMutation,
  SupportDiagnosticCleanupInput,
  SupportDiagnosticContentQuery,
} from "@repo/contracts/support-diagnostics/types";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError } from "../../_lib/http/api-client";

const base = "/api/v1/system/diagnostics";
const bundles = `${base}/bundles`;
/** Transport boundary: all request values and all successful responses are parsed. */
export class SupportDiagnosticsGateway {
  constructor(private readonly request = authenticatedRequestJson) {}
  private async scoped<S extends z.ZodType<{ organizationId: string }>>(
    organizationId: string,
    schema: S,
    operation: Promise<unknown>,
  ): Promise<z.output<S>> {
    const value = schema.parse(await operation);
    if (value.organizationId !== organizationId)
      throw new ApiClientError(
        "invalid_response",
        "Organization changed. Reload diagnostics.",
        409,
      );
    return value;
  }
  private path(jobId: string) {
    diagnosticJobParamsSchema.parse({ jobId });
    return `${bundles}/${jobId}` as const;
  }
  async preview(
    organizationId: string,
    input: SupportDiagnosticPreviewInput,
    signal?: AbortSignal,
  ) {
    const body = diagnosticPreviewInputSchema.parse(input);
    return this.scoped(
      organizationId,
      diagnosticPreviewSchema,
      this.request({
        path: `${base}/preview`,
        method: "POST",
        body,
        inputSchema: diagnosticPreviewInputSchema,
        schema: diagnosticPreviewSchema,
        signal,
      }),
    );
  }
  async create(
    organizationId: string,
    input: SupportDiagnosticCreate,
    signal?: AbortSignal,
  ) {
    const body = diagnosticCreateSchema.parse(input);
    return this.scoped(
      organizationId,
      diagnosticJobSchema,
      this.request({
        path: bundles,
        method: "POST",
        body,
        inputSchema: diagnosticCreateSchema,
        schema: diagnosticJobSchema,
        signal,
      }),
    );
  }
  async list(organizationId: string, cursor?: string, signal?: AbortSignal) {
    const query = diagnosticListQuerySchema.parse(cursor ? { cursor } : {});
    const search = new URLSearchParams({
      limit: String(query.limit),
      ...(query.cursor ? { cursor: query.cursor } : {}),
    });
    return this.scoped(
      organizationId,
      diagnosticListSchema,
      this.request({
        path: `${bundles}?${search}`,
        schema: diagnosticListSchema,
        signal,
      }),
    );
  }
  async read(organizationId: string, jobId: string, signal?: AbortSignal) {
    const response = await this.scoped(
      organizationId,
      diagnosticJobSchema,
      this.request({
        path: this.path(jobId),
        schema: diagnosticJobSchema,
        signal,
      }),
    );
    return this.matchJob(response, jobId);
  }
  private matchJob(
    response: z.output<typeof diagnosticJobSchema>,
    jobId: string,
  ) {
    if (response.id !== jobId)
      throw new ApiClientError(
        "invalid_response",
        "Diagnostic job changed. Reload the bundle.",
        409,
      );
    return response;
  }
  async content(
    organizationId: string,
    jobId: string,
    input: SupportDiagnosticContentQuery,
    signal?: AbortSignal,
  ) {
    const query = diagnosticContentQuerySchema.parse(input);
    const search = new URLSearchParams({
      section: query.section,
      offset: String(query.offset),
      limit: String(query.limit),
    });
    const response = await this.scoped(
      organizationId,
      diagnosticContentSchema,
      this.request({
        path: `${this.path(jobId)}/content?${search}`,
        schema: diagnosticContentSchema,
        signal,
      }),
    );
    if (
      response.jobId !== jobId ||
      response.manifest.jobId !== jobId ||
      response.section !== query.section
    )
      throw new ApiClientError(
        "invalid_response",
        "Diagnostic content changed. Reload the bundle.",
        409,
      );
    return response;
  }
  async cancel(
    organizationId: string,
    jobId: string,
    input: SupportDiagnosticMutation,
    signal?: AbortSignal,
  ) {
    const body = diagnosticMutationSchema.parse(input);
    const response = await this.scoped(
      organizationId,
      diagnosticJobSchema,
      this.request({
        path: `${this.path(jobId)}/cancel`,
        method: "POST",
        body,
        inputSchema: diagnosticMutationSchema,
        schema: diagnosticJobSchema,
        signal,
      }),
    );

    return this.matchJob(response, jobId);
  }
  async grant(
    organizationId: string,
    jobId: string,
    input: SupportDiagnosticMutation,
    signal?: AbortSignal,
  ) {
    const body = diagnosticMutationSchema.parse(input);
    const response = await this.scoped(
      organizationId,
      diagnosticGrantSchema,
      this.request({
        path: `${this.path(jobId)}/download-grants`,
        method: "POST",
        body,
        inputSchema: diagnosticMutationSchema,
        schema: diagnosticGrantSchema,
        signal,
      }),
    );
    if (
      response.jobId !== jobId ||
      response.downloadPath !==
        `${this.path(jobId)}/download/${response.grantId}`
    )
      throw new ApiClientError(
        "invalid_response",
        "Invalid diagnostic download path.",
      );
    return response;
  }
  async reviewCleanup(
    organizationId: string,
    jobId: string,
    signal?: AbortSignal,
  ) {
    const response = await this.scoped(
      organizationId,
      diagnosticCleanupReviewSchema,
      this.request({
        path: `${this.path(jobId)}/cleanup-review`,
        method: "POST",
        schema: diagnosticCleanupReviewSchema,
        signal,
      }),
    );
    if (response.jobId !== jobId)
      throw new ApiClientError(
        "invalid_response",
        "Cleanup review changed.",
        409,
      );
    return response;
  }
  async cleanup(
    organizationId: string,
    jobId: string,
    input: SupportDiagnosticCleanupInput,
    signal?: AbortSignal,
  ) {
    const body = diagnosticCleanupInputSchema.parse(input);
    const response = await this.scoped(
      organizationId,
      diagnosticJobSchema,
      this.request({
        path: `${this.path(jobId)}/cleanup`,
        method: "POST",
        body,
        inputSchema: diagnosticCleanupInputSchema,
        schema: diagnosticJobSchema,
        signal,
      }),
    );

    return this.matchJob(response, jobId);
  }
}
export const supportDiagnosticsGateway = new SupportDiagnosticsGateway();
