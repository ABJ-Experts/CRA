"use client";
import type { AuditRangeJob } from "@repo/contracts/audit/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { useRef, useState } from "react";
import { useSession } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import { AuditFilterField } from "./audit-filter-field";
import {
  clearDurableAuditRequestId,
  durableAuditRequestId,
  type PendingAuditRequest,
} from "./audit-request-identity";
import { auditRangeGateway } from "./audit-range.api";
import { parseAuditRangeDraft } from "./audit-range-input";
import { useAuditRangeJob } from "./audit-range.queries";
import { AuditRangeResultView } from "./audit-range-result";
function errorText(error: unknown) {
  if (error instanceof ApiClientError && error.status === 403)
    return "Audit or source access was denied. Your draft is preserved.";
  if (error instanceof ApiClientError && error.status === 409)
    return "The verification changed. Refresh status before retrying.";
  return "Verification unavailable. Check your range and checkpoint, then retry. Your draft is preserved.";
}
export function AuditRangePanel() {
  const { session, permissions, isLoading, isError } = useSession();
  const organizationId = session?.organization?.id ?? null;
  // Remount tenant-bound state synchronously; drafts in the explorer are separate.
  return (
    <section
      aria-label="Audit-chain range verification"
      className="mx-4 mb-6 rounded-xl border border-border bg-surface p-4 sm:mx-6"
    >
      <h2 className="text-h3 text-fg">Audit-chain range verification</h2>
      {isLoading ? (
        <p role="status">Loading audit permissions…</p>
      ) : isError ? (
        <p role="alert">
          Session permissions unavailable. Retry after refreshing your session.
        </p>
      ) : permissions.can_view_audit !== true || organizationId === null ? (
        <p role="status">Audit permission required.</p>
      ) : (
        <RangeControls key={organizationId} organizationId={organizationId} />
      )}
    </section>
  );
}
function RangeControls({
  organizationId,
}: Readonly<{ organizationId: string }>) {
  const [from, setFrom] = useState("1");
  const [to, setTo] = useState("");
  const [checkpoint, setCheckpoint] = useState("");
  const [localJob, setJob] = useState<AuditRangeJob | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const identity = useRef<PendingAuditRequest | null>(null);
  const activeOrg = useRef(organizationId);
  activeOrg.current = organizationId;
  const status = useAuditRangeJob(organizationId, localJob?.id ?? null, true);
  const job =
    status.data && localJob && status.data.version >= localJob.version
      ? status.data
      : localJob;
  async function create() {
    const key = JSON.stringify([organizationId, from, to, checkpoint]);
    setPending(true);
    setError(null);
    try {
      const requestId = durableAuditRequestId(identity, key, () =>
        crypto.randomUUID(),
      );
      const input = parseAuditRangeDraft(requestId, from, to, checkpoint);
      const next = await auditRangeGateway.create(input);
      if (activeOrg.current === organizationId) setJob(next);
      clearDurableAuditRequestId(identity, key);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  async function operation(action: "cancel" | "resume") {
    if (job === null) return;
    const key = JSON.stringify([organizationId, job.id, job.version, action]);
    setPending(true);
    setError(null);
    try {
      const requestId = durableAuditRequestId(identity, key, () =>
        crypto.randomUUID(),
      );
      setJob(
        await auditRangeGateway.operation(job.id, action, {
          requestId,
          expectedVersion: job.version,
        }),
      );
      clearDurableAuditRequestId(identity, key);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setPending(false);
    }
  }
  const running = job?.status === "queued" || job?.status === "processing";
  return (
    <div className="mt-3 grid gap-4">
      <p className="text-caption-1-regular text-fg-muted">
        Checks a contiguous sequence interval, independent of explorer filters.
        Blank upper boundary freezes the current chain head.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        <AuditFilterField
          label="From sequence"
          value={from}
          onChange={setFrom}
        />
        <AuditFilterField
          label="To sequence (optional)"
          value={to}
          onChange={setTo}
        />
      </div>
      <label className="grid gap-1 text-caption-1-regular">
        Prior checkpoint JSON (optional, maximum 16 KiB)
        <textarea
          value={checkpoint}
          onChange={(event) => setCheckpoint(event.target.value)}
          rows={3}
          className={cn(
            "w-full rounded-lg border border-border bg-canvas p-3 text-fg",
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current",
          )}
        />
      </label>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => void create()} disabled={pending || running}>
          Verify range
        </Button>
        {running ? (
          <Button
            variant="outline"
            tone="grey"
            disabled={pending}
            onClick={() => void operation("cancel")}
          >
            Cancel verification
          </Button>
        ) : null}
        {job?.status === "cancelled" ||
        job?.status === "failed" ||
        (job?.status === "stale" && job.failureCode === "access_changed") ? (
          <Button
            variant="outline"
            tone="grey"
            disabled={pending}
            onClick={() => void operation("resume")}
          >
            Resume verification
          </Button>
        ) : null}
        {job ? (
          <Button
            variant="outline"
            tone="grey"
            disabled={pending}
            onClick={() => void status.refetch()}
          >
            Refresh status
          </Button>
        ) : null}
      </div>
      {pending ? <p role="status">Saving verification request…</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {status.isError ? (
        <p role="alert">
          Status unavailable. Previously displayed results may be stale; refresh
          to recheck access.
        </p>
      ) : null}
      {job ? (
        <div aria-live="polite" aria-atomic="true">
          <p role="status">Verification {job.status}</p>
          {job.failureCode ? (
            <p>Reason: {job.failureCode.replaceAll("_", " ")}</p>
          ) : null}
          {job.failureCode === "dataset_changed" ? (
            <p>
              The dataset changed. Start a new check against the current
              dataset.
            </p>
          ) : null}
          {job.result &&
          !status.isError &&
          (job.result.outcome !== "consistent" ||
            job.status === "completed") ? (
            <AuditRangeResultView result={job.result} />
          ) : (
            <p>No completed result is available.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
