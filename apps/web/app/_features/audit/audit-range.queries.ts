"use client";
import type { AuditRangeJob } from "@repo/contracts/audit/types";
import { useQuery } from "@tanstack/react-query";
import { useRef } from "react";
import { auditRangeGateway } from "./audit-range.api";
export function useAuditRangeJob(
  organizationId: string | null,
  jobId: string | null,
  enabled: boolean,
) {
  const pending = useRef<{ key: string; requestId: string } | null>(null);
  return useQuery<AuditRangeJob>({
    queryKey: ["audit", organizationId, "range", jobId],
    enabled: enabled && organizationId !== null && jobId !== null,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.status === "queued" ||
      query.state.data?.status === "processing"
        ? 2_000
        : false,
    queryFn: async ({ signal }) => {
      if (jobId === null) throw new Error("Verification job required.");
      const key = JSON.stringify([organizationId, jobId]);
      if (pending.current?.key !== key)
        pending.current = { key, requestId: crypto.randomUUID() };
      const requestId = pending.current.requestId;
      const job = await auditRangeGateway.status(jobId, requestId, signal);
      if (pending.current?.requestId === requestId) pending.current = null;
      return job;
    },
  });
}
