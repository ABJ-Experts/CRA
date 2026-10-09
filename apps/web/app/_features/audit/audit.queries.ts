"use client";

import type {
  AuditExportInput,
  AuditExportJob,
  AuditPageQuery,
  AuditSearchInput,
  AuditVerificationInput,
} from "@repo/contracts/audit/types";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";

import { auditGateway } from "./audit.api";

export const auditKeys = Object.freeze({
  all: Object.freeze(["audit"] as const),
  snapshot: (organizationId: string | null, snapshotToken: string | null) =>
    Object.freeze(["audit", organizationId ?? "no-organization", "snapshot", snapshotToken ?? "none"] as const),
  page: (
    organizationId: string | null,
    snapshotToken: string | null,
    cursor: string | null,
    limit: number,
    requestId: string,
  ) =>
    Object.freeze([
      "audit",
      organizationId ?? "no-organization",
      "page",
      snapshotToken ?? "none",
      cursor ?? "first",
      limit,
      requestId,
    ] as const),
  detail: (
    organizationId: string | null,
    snapshotToken: string | null,
    eventId: string | null,
    requestId: string,
  ) =>
    Object.freeze([
      "audit",
      organizationId ?? "no-organization",
      "detail",
      snapshotToken ?? "none",
      eventId ?? "none",
      requestId,
    ] as const),
  exportJob: (organizationId: string | null, jobId: string | null) =>
    Object.freeze(["audit", organizationId ?? "no-organization", "export", jobId ?? "none"] as const),
});

export function useAuditSearchMutation() {
  return useMutation({
    mutationFn: (input: AuditSearchInput) => auditGateway.search(input),
  });
}

export function useAuditPageQuery(
  organizationId: string | null,
  snapshotToken: string | null,
  query: AuditPageQuery,
  enabled: boolean,
) {
  return useQuery({
    queryKey: auditKeys.page(
      organizationId,
      snapshotToken,
      query.cursor ?? null,
      query.limit,
      query.requestId,
    ),
    enabled: enabled && snapshotToken !== null && organizationId !== null,
    retry: false,
    placeholderData: keepPreviousData,
    queryFn: ({ signal }) => {
      if (snapshotToken === null) throw new Error("Audit snapshot required.");
      return auditGateway.page(snapshotToken, query, signal);
    },
  });
}

export function useAuditDetailQuery(
  organizationId: string | null,
  snapshotToken: string | null,
  eventId: string | null,
  requestId: string,
  enabled: boolean,
) {
  return useQuery({
    queryKey: auditKeys.detail(organizationId, snapshotToken, eventId, requestId),
    enabled:
      enabled &&
      organizationId !== null &&
      snapshotToken !== null &&
      eventId !== null,
    retry: false,
    queryFn: ({ signal }) => {
      if (snapshotToken === null || eventId === null)
        throw new Error("Audit event required.");
      return auditGateway.detail(snapshotToken, eventId, requestId, signal);
    },
  });
}

export function useAuditVerifyMutation() {
  return useMutation({
    mutationFn: (
      variables: Readonly<{
        snapshotToken: string;
        input: AuditVerificationInput;
      }>,
    ) => auditGateway.verify(variables.snapshotToken, variables.input),
  });
}

export function useCreateAuditExportMutation() {
  return useMutation({
    mutationFn: (input: AuditExportInput) => auditGateway.createExport(input),
  });
}

export function useAuditExportJobQuery(
  organizationId: string | null,
  jobId: string | null,
  enabled: boolean,
) {
  return useQuery<AuditExportJob>({
    queryKey: auditKeys.exportJob(organizationId, jobId),
    enabled: enabled && organizationId !== null && jobId !== null,
    retry: false,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "queued" || status === "processing" ? 2_000 : false;
    },
    queryFn: ({ signal }) => {
      if (jobId === null) throw new Error("Audit export job required.");
      return auditGateway.exportJob(jobId, crypto.randomUUID(), signal);
    },
  });
}

export function useAuditDownloadGrantMutation(jobId: string | null) {
  return useMutation({
    mutationFn: (requestId: string) => {
      if (jobId === null) throw new Error("Audit export job required.");
      return auditGateway.grantDownload(jobId, { requestId });
    },
  });
}
