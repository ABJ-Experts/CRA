import {
  createExportJobSchema,
  createReadinessExportSchema,
  exportJobParamsSchema,
  exportJobResponseSchema,
  exportJobListResponseSchema,
  exportDownloadGrantInputSchema,
  exportDownloadGrantResponseSchema,
  exportMutationSchema,
  exportManifestResponseSchema,
  type CreateExportJobInput,
  type CreateReadinessExportInput,
} from "@repo/contracts/exports";
import { authenticatedApiClient } from "../../_lib/http/authenticated-request";
import type { AuthenticatedApiClient } from "../../_lib/http/authenticated-request";

/** Owns transport dependencies; views pass their source's existing parsed filters. */
export class ExportsGateway {
  constructor(
    private readonly client: Pick<
      AuthenticatedApiClient,
      "request"
    > = authenticatedApiClient,
    private readonly options: Readonly<{
      basePath?:
        | "/api/v1/exports"
        | "/api/v1/auditor/exports"
        | "/api/v1/supplier-evidence-portal/exports";
      headers?: HeadersInit;
      credentials?: RequestCredentials;
    }> = {},
  ) {}
  private path(jobId: string): `/${string}` {
    return `${this.options.basePath ?? "/api/v1/exports"}/${exportJobParamsSchema.parse({ jobId }).jobId}`;
  }
  create(input: CreateExportJobInput, signal?: AbortSignal) {
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: this.options.basePath ?? "/api/v1/exports",
      method: "POST",
      inputSchema: createExportJobSchema,
      body: input,
      schema: exportJobResponseSchema,
      signal,
    });
  }
  createReadiness(input: CreateReadinessExportInput, signal?: AbortSignal) {
    const parsed = createReadinessExportSchema.parse(input);
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: `/api/v1/products/${parsed.productId}/audit-readiness/exports`,
      method: "POST",
      inputSchema: createReadinessExportSchema,
      body: parsed,
      schema: exportJobResponseSchema,
      signal,
    });
  }
  get(jobId: string, signal?: AbortSignal) {
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: this.path(jobId),
      schema: exportJobResponseSchema,
      signal,
    });
  }
  manifest(jobId: string, signal?: AbortSignal) {
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: `${this.path(jobId)}/manifest`,
      schema: exportManifestResponseSchema,
      signal,
    });
  }
  list(signal?: AbortSignal) {
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: this.options.basePath ?? "/api/v1/exports",
      schema: exportJobListResponseSchema,
      signal,
    });
  }
  cancel(jobId: string, version: number, signal?: AbortSignal) {
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: `${this.path(jobId)}/cancel`,
      method: "POST",
      body: { expectedVersion: version, idempotencyKey: crypto.randomUUID() },
      inputSchema: exportMutationSchema,
      schema: exportJobResponseSchema,
      signal,
    });
  }
  retry(jobId: string, version: number, signal?: AbortSignal) {
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: `${this.path(jobId)}/retry`,
      method: "POST",
      body: { expectedVersion: version, idempotencyKey: crypto.randomUUID() },
      inputSchema: exportMutationSchema,
      schema: exportJobResponseSchema,
      signal,
    });
  }
  grant(jobId: string, artifactId: string, signal?: AbortSignal) {
    return this.client.request({
      headers: this.options.headers,
      credentials: this.options.credentials,
      path: `${this.path(jobId)}/download-grants`,
      method: "POST",
      body: { artifactId },
      inputSchema: exportDownloadGrantInputSchema,
      schema: exportDownloadGrantResponseSchema,
      signal,
    });
  }
}
export const exportsGateway = new ExportsGateway();
