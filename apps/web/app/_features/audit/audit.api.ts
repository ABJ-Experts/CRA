"use client";

import {
  auditDetailParamsSchema,
  auditDetailSchema,
  auditDownloadGrantInputSchema,
  auditDownloadGrantSchema,
  auditExportInputSchema,
  auditExportJobSchema,
  auditExportParamsSchema,
  auditOperationQuerySchema,
  auditPageQuerySchema,
  auditPageSchema,
  auditSearchInputSchema,
  auditSnapshotParamsSchema,
  auditSnapshotSchema,
  auditVerificationInputSchema,
  auditVerificationResultSchema,
} from "@repo/contracts/audit/schemas";
import type {
  AuditDownloadGrantInput,
  AuditExportInput,
  AuditPageQuery,
  AuditSearchInput,
  AuditVerificationInput,
} from "@repo/contracts/audit/types";

import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { ApiClientError, apiClient } from "../../_lib/http/api-client";

function encode(value: string): string {
  return encodeURIComponent(value);
}

function snapshotPath(snapshotToken: string): `/api/v1/audit/searches/${string}` {
  const parsed = auditSnapshotParamsSchema.safeParse({ snapshotToken });
  if (!parsed.success) {
    throw new ApiClientError("invalid_request", "The audit snapshot is invalid.");
  }
  return `/api/v1/audit/searches/${encode(parsed.data.snapshotToken)}`;
}

function eventPath(snapshotToken: string, eventId: string): `/${string}` {
  const parsed = auditDetailParamsSchema.safeParse({
    snapshotToken,
    eventId,
  });
  if (!parsed.success) {
    throw new ApiClientError("invalid_request", "The audit event is invalid.");
  }
  return `${snapshotPath(parsed.data.snapshotToken)}/events/${parsed.data.eventId}`;
}

function pageQueryString(query: AuditPageQuery): string {
  const parsed = auditPageQuerySchema.parse(query);
  const params = new URLSearchParams({
    requestId: parsed.requestId,
    limit: String(parsed.limit),
  });
  if (parsed.cursor) params.set("cursor", parsed.cursor);
  return `?${params.toString()}`;
}

function requestQueryString(requestId: string): string {
  const parsed = auditOperationQuerySchema.parse({ requestId });
  return `?${new URLSearchParams({ requestId: parsed.requestId }).toString()}`;
}

function exportPath(jobId: string): `/api/v1/audit/exports/${string}` {
  const parsed = auditExportParamsSchema.safeParse({ jobId });
  if (!parsed.success) {
    throw new ApiClientError("invalid_request", "The audit export job is invalid.");
  }
  return `/api/v1/audit/exports/${parsed.data.jobId}`;
}

export class AuditGateway {
  search(input: AuditSearchInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/audit/searches",
      method: "POST",
      inputSchema: auditSearchInputSchema,
      body: input,
      schema: auditSnapshotSchema,
      signal,
    });
  }

  page(snapshotToken: string, query: AuditPageQuery, signal?: AbortSignal) {
    const parsed = auditPageQuerySchema.parse(query);
    return authenticatedRequestJson({
      path: `${snapshotPath(snapshotToken)}/events${pageQueryString(parsed)}` as `/${string}`,
      schema: auditPageSchema,
      signal,
    });
  }

  detail(snapshotToken: string, eventId: string, requestId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: `${eventPath(snapshotToken, eventId)}${requestQueryString(requestId)}` as `/${string}`,
      schema: auditDetailSchema,
      signal,
    });
  }

  verify(
    snapshotToken: string,
    input: AuditVerificationInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: `${snapshotPath(snapshotToken)}/verify` as `/${string}`,
      method: "POST",
      inputSchema: auditVerificationInputSchema,
      body: input,
      schema: auditVerificationResultSchema,
      signal,
    });
  }

  createExport(input: AuditExportInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/audit/exports",
      method: "POST",
      inputSchema: auditExportInputSchema,
      body: input,
      schema: auditExportJobSchema,
      signal,
    });
  }

  exportJob(jobId: string, requestId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: `${exportPath(jobId)}${requestQueryString(requestId)}` as `/${string}`,
      schema: auditExportJobSchema,
      signal,
    });
  }

  grantDownload(jobId: string, input: AuditDownloadGrantInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: `${exportPath(jobId)}/download-grants` as `/${string}`,
      method: "POST",
      inputSchema: auditDownloadGrantInputSchema,
      body: input,
      schema: auditDownloadGrantSchema,
      signal,
    });
  }

  parseExportInput(input: AuditExportInput): AuditExportInput {
    return apiClient.parseInput(auditExportInputSchema, input);
  }
}

export const auditGateway = Object.freeze(new AuditGateway());
