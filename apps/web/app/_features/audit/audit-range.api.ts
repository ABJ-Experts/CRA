"use client";
import {
  auditRangeCreateInputSchema,
  auditRangeJobSchema,
  auditRangeOperationInputSchema,
  auditRangeParamsSchema,
  auditRangeStatusQuerySchema,
} from "@repo/contracts/audit/schemas";
import type {
  AuditRangeCreateInput,
  AuditRangeOperationInput,
} from "@repo/contracts/audit/types";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
function jobPath(jobId: string): `/api/v1/audit/chain-verifications/${string}` {
  return `/api/v1/audit/chain-verifications/${auditRangeParamsSchema.parse({ jobId }).jobId}`;
}
export class AuditRangeGateway {
  create(body: AuditRangeCreateInput, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: "/api/v1/audit/chain-verifications",
      method: "POST",
      inputSchema: auditRangeCreateInputSchema,
      body,
      schema: auditRangeJobSchema,
      signal,
    });
  }
  status(jobId: string, requestId: string, signal?: AbortSignal) {
    const query = auditRangeStatusQuerySchema.parse({ requestId });
    return authenticatedRequestJson({
      path: `${jobPath(jobId)}?${new URLSearchParams(query)}` as `/${string}`,
      schema: auditRangeJobSchema,
      signal,
    });
  }
  operation(
    jobId: string,
    operation: "cancel" | "resume",
    body: AuditRangeOperationInput,
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: `${jobPath(jobId)}/${operation}` as `/${string}`,
      method: "POST",
      inputSchema: auditRangeOperationInputSchema,
      body,
      schema: auditRangeJobSchema,
      signal,
    });
  }
}
export const auditRangeGateway = Object.freeze(new AuditRangeGateway());
