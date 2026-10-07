"use client";

import type {
  AuditEventView,
  AuditExportFormat,
  AuditExportJob,
  AuditSearchFilters,
  AuditSnapshot,
} from "@repo/contracts/audit/types";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { Tag } from "@repo/ui/tag";
import {
  CheckCircle2,
  Download,
  Eye,
  FileJson,
  FileText,
  RefreshCw,
  Search,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError } from "../../_lib/http/api-client";
import { startAuditExportDownload } from "./audit-download";
import { AuditFilterField } from "./audit-filter-field";
import {
  clearDurableAuditRequestId,
  durableAuditRequestId,
  type PendingAuditRequest,
} from "./audit-request-identity";
import {
  AuditDetailPanel,
  verificationLabel,
  verificationTone,
} from "./audit-detail-panel";
import { useSession } from "../../_providers/session-provider";
import {
  useAuditDetailQuery,
  useAuditDownloadGrantMutation,
  useAuditExportJobQuery,
  useAuditPageQuery,
  useAuditSearchMutation,
  useAuditVerifyMutation,
  useCreateAuditExportMutation,
} from "./audit.queries";

export type AuditVerificationStatus = AuditEventView["verificationStatus"];

type DraftFilters = Readonly<{
  from: string;
  to: string;
  actorId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  correlationId: string;
}>;

const DEFAULT_LIMIT = 50;
const EMPTY_ROWS: readonly AuditEventView[] = Object.freeze([]);

function requestId(): string {
  return crypto.randomUUID();
}

function toLocalInput(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultDraft(): DraftFilters {
  const to = new Date();
  const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  return {
    from: toLocalInput(from),
    to: toLocalInput(to),
    actorId: "",
    action: "",
    resourceType: "",
    resourceId: "",
    correlationId: "",
  };
}

function resetDateDraft(draft: DraftFilters): DraftFilters {
  const next = defaultDraft();
  return { ...draft, from: next.from, to: next.to };
}

function compact(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function filtersFromDraft(draft: DraftFilters): AuditSearchFilters {
  const actorId = compact(draft.actorId);
  const action = compact(draft.action);
  const resourceType = compact(draft.resourceType);
  const resourceId = compact(draft.resourceId);
  const correlationId = compact(draft.correlationId);
  return {
    from: new Date(draft.from).toISOString(),
    to: new Date(draft.to).toISOString(),
    ...(actorId ? { actorId } : {}),
    ...(action ? { action } : {}),
    ...(resourceType ? { resourceType } : {}),
    ...(resourceId ? { resourceId } : {}),
    ...(correlationId ? { correlationId } : {}),
  };
}

function formatInstant(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function label(value: string | null | undefined): string {
  if (!value) return "None";
  return value.replaceAll("_", " ").replaceAll(".", " ");
}

function errorText(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 403)
      return "You no longer have audit permission for this organization.";
    if (error.status === 409)
      return "The audit snapshot changed. Your filters are still here; create a fresh snapshot and retry.";
    if (error.status === 410)
      return "This audit snapshot or export expired. Create a fresh one and retry.";
    if (error.kind === "network")
      return "Audit services are temporarily unavailable. Retry when connected.";
    return error.message;
  }
  return "The audit request could not be completed.";
}

function jobStatus(job: AuditExportJob): string {
  if (job.status === "failed" && job.failureCode)
    return `Failed: ${label(job.failureCode)}`;
  return label(job.status);
}

export function AuditExplorer() {
  const { session, permissions, isLoading, isError } = useSession();
  const organizationId = session?.organization?.id ?? null;
  const canView = permissions.can_view_audit === true;
  const canExport = permissions.can_export_audit === true;
  const [draft, setDraft] = useState(defaultDraft);
  const [snapshot, setSnapshot] = useState<AuditSnapshot | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<readonly (string | null)[]>(
    [],
  );
  const [pageRequestId, setPageRequestId] = useState(requestId);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [verified, setVerified] = useState<
    Readonly<Record<string, AuditVerificationStatus>>
  >({});
  const [detailId, setDetailId] = useState<string | null>(null);
  const detailOpenerRef = useRef<HTMLElement | null>(null);
  const detailOpenerEventIdRef = useRef<string | null>(null);
  const [detailRequestId, setDetailRequestId] = useState(requestId);
  const [format, setFormat] = useState<AuditExportFormat>("csv");
  const [exportJobId, setExportJobId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const searchRequestRef = useRef<PendingAuditRequest | null>(null);
  const verifyRequestRef = useRef<PendingAuditRequest | null>(null);
  const exportRequestRef = useRef<PendingAuditRequest | null>(null);

  const search = useAuditSearchMutation();
  const page = useAuditPageQuery(
    organizationId,
    snapshot?.snapshotToken ?? null,
    {
      requestId: pageRequestId,
      cursor: cursor ?? undefined,
      limit: DEFAULT_LIMIT,
    },
    canView,
  );
  const detail = useAuditDetailQuery(
    organizationId,
    snapshot?.snapshotToken ?? null,
    detailId,
    detailRequestId,
    canView,
  );
  const verify = useAuditVerifyMutation();
  const createExport = useCreateAuditExportMutation();
  const exportJob = useAuditExportJobQuery(
    organizationId,
    exportJobId,
    canExport,
  );
  const grant = useAuditDownloadGrantMutation(exportJobId);

  useEffect(() => {
    setSnapshot(null);
    setCursor(null);
    setCursorStack([]);
    setPageRequestId(requestId());
    setSelected(new Set());
    setVerified({});
    setDetailId(null);
    clearDetailOpener();
    setExportJobId(null);
    setMessage(null);
    searchRequestRef.current = null;
    verifyRequestRef.current = null;
    exportRequestRef.current = null;
  }, [organizationId]);

  const rows = page.data?.items ?? EMPTY_ROWS;
  const selectedRows = useMemo(
    () => rows.filter((row) => selected.has(row.id)),
    [rows, selected],
  );
  const selectedVerifiableIds = selectedRows
    .filter((row) => !row.legacy)
    .map((row) => row.id);
  const hasIntegrityBreak = rows.some(
    (row) => (verified[row.id] ?? row.verificationStatus) === "integrity_break",
  );

  async function submitSearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    setExportJobId(null);
    try {
      const filters = filtersFromDraft(draft);
      const operationKey = JSON.stringify(filters);
      const response = await search.mutateAsync({
        requestId: durableAuditRequestId(
          searchRequestRef,
          operationKey,
          requestId,
        ),
        filters,
      });
      clearDurableAuditRequestId(searchRequestRef, operationKey);
      setSnapshot(response);
      setCursor(null);
      setCursorStack([]);
      setPageRequestId(requestId());
      setSelected(new Set());
      setVerified({});
      setDetailId(null);
      setMessage(
        "Audit snapshot created. Results are ordered by stable sequence.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function verifySelection() {
    if (!snapshot || selectedVerifiableIds.length === 0) return;
    setMessage(null);
    const operationKey = JSON.stringify({
      snapshotToken: snapshot.snapshotToken,
      eventIds: selectedVerifiableIds,
    });
    try {
      const result = await verify.mutateAsync({
        snapshotToken: snapshot.snapshotToken,
        input: {
          requestId: durableAuditRequestId(
            verifyRequestRef,
            operationKey,
            requestId,
          ),
          eventIds: selectedVerifiableIds,
        },
      });
      clearDurableAuditRequestId(verifyRequestRef, operationKey);
      const next = Object.fromEntries(
        result.items.map((item) => [item.eventId, item.status]),
      );
      setVerified((current) => Object.freeze({ ...current, ...next }));
      setMessage("Selected event hashes were checked for this snapshot.");
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function requestExport() {
    if (!snapshot || !canExport) return;
    setMessage(null);
    const operationKey = JSON.stringify({
      snapshotToken: snapshot.snapshotToken,
      format,
    });
    try {
      const job = await createExport.mutateAsync({
        requestId: durableAuditRequestId(
          exportRequestRef,
          operationKey,
          requestId,
        ),
        snapshotToken: snapshot.snapshotToken,
        format,
      });
      clearDurableAuditRequestId(exportRequestRef, operationKey);
      setExportJobId(job.id);
      setMessage(
        "Audit export queued. Access will be rechecked before download.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  async function authorizeDownload() {
    if (!exportJob.data || exportJob.data.status !== "ready") return;
    setMessage(null);
    try {
      const access = await grant.mutateAsync(requestId());
      startAuditExportDownload(access, requestId);
      setMessage(
        "Authorized download started. The URL is same-origin and short-lived.",
      );
    } catch (error) {
      setMessage(errorText(error));
    }
  }

  function toggle(row: AuditEventView) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(row.id)) next.delete(row.id);
      else next.add(row.id);
      return next;
    });
  }

  function openDetail(row: AuditEventView, opener: HTMLElement) {
    detailOpenerRef.current = opener;
    detailOpenerEventIdRef.current = row.id;
    setDetailId(row.id);
    setDetailRequestId(requestId());
  }

  function resolveDetailFocusTarget(): HTMLElement | null {
    const opener = detailOpenerRef.current;
    const openerEventId = detailOpenerEventIdRef.current;
    return opener && document.contains(opener)
      ? opener
      : openerEventId
        ? document.querySelector<HTMLElement>(
            `[data-audit-detail-opener="${openerEventId}"]`,
          )
        : null;
  }

  function clearDetailOpener() {
    detailOpenerRef.current = null;
    detailOpenerEventIdRef.current = null;
  }

  function focusDetailTarget(target: HTMLElement | null) {
    if (!target) return;
    target.focus();
    window.setTimeout(() => {
      if (document.contains(target) && document.activeElement !== target) {
        target.focus();
      }
    }, 0);
  }

  function closeDetail() {
    const target = resolveDetailFocusTarget();
    clearDetailOpener();
    setDetailId(null);
    window.setTimeout(() => focusDetailTarget(target), 0);
  }

  function restoreDetailFocus(event: Event) {
    const target = resolveDetailFocusTarget();
    clearDetailOpener();
    if (!target) return;
    event.preventDefault();
    focusDetailTarget(target);
  }

  function nextPage() {
    if (!page.data?.nextCursor) return;
    setCursorStack((current) => [...current, cursor]);
    setCursor(page.data.nextCursor);
    setPageRequestId(requestId());
  }

  function previousPage() {
    const previous = cursorStack.at(-1);
    setCursorStack((current) => current.slice(0, -1));
    setCursor(previous ?? null);
    setPageRequestId(requestId());
  }

  if (!isLoading && !canView) {
    return (
      <section
        aria-labelledby="audit-trail-heading"
        className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-6 py-8"
      >
        <h1 id="audit-trail-heading" className="text-h3 text-fg">
          Audit trail
        </h1>
        <p className="rounded-xl border border-border bg-canvas p-4 text-subhead-regular text-fg-muted">
          You do not have permission to view the audit trail.
        </p>
      </section>
    );
  }

  return (
    <section
      aria-labelledby="audit-trail-heading"
      className="mx-auto flex w-full max-w-7xl flex-col gap-5 px-6 py-8"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h1 id="audit-trail-heading" className="text-h3 text-fg">
            Audit trail
          </h1>
          <p className="text-subhead-regular text-fg-muted">
            Filtered reads and exports are audited. Dates are entered in local
            time and sent as UTC instants with an exclusive end.
          </p>
        </div>
        {isError ? (
          <Tag variant="dot" tone="orange">
            Session permissions stale
          </Tag>
        ) : null}
      </div>

      <form
        className="grid gap-4 rounded-xl border border-border bg-canvas p-4"
        onSubmit={submitSearch}
      >
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <AuditFilterField
            label="From"
            type="datetime-local"
            value={draft.from}
            onChange={(from) => setDraft((current) => ({ ...current, from }))}
          />
          <AuditFilterField
            label="To"
            type="datetime-local"
            value={draft.to}
            onChange={(to) => setDraft((current) => ({ ...current, to }))}
          />
          <AuditFilterField
            label="Actor"
            value={draft.actorId}
            placeholder="User or service identifier"
            onChange={(actorId) =>
              setDraft((current) => ({ ...current, actorId }))
            }
          />
          <AuditFilterField
            label="Action"
            value={draft.action}
            placeholder="product.updated"
            onChange={(action) =>
              setDraft((current) => ({ ...current, action }))
            }
          />
          <AuditFilterField
            label="Resource type"
            value={draft.resourceType}
            placeholder="product"
            onChange={(resourceType) =>
              setDraft((current) => ({ ...current, resourceType }))
            }
          />
          <AuditFilterField
            label="Resource"
            value={draft.resourceId}
            placeholder="Resource identifier"
            onChange={(resourceId) =>
              setDraft((current) => ({ ...current, resourceId }))
            }
          />
          <AuditFilterField
            label="Correlation ID"
            value={draft.correlationId}
            placeholder="00000000-0000-4000-8000-000000000000"
            onChange={(correlationId) =>
              setDraft((current) => ({ ...current, correlationId }))
            }
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="submit"
            loading={search.isPending}
            startIcon={<Search />}
          >
            Search audit trail
          </Button>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            startIcon={<RefreshCw />}
            onClick={() => setDraft(resetDateDraft)}
          >
            Reset dates
          </Button>
        </div>
      </form>

      {message ? (
        <p
          role={
            /permission|failed|expired|changed|unavailable/i.test(message)
              ? "alert"
              : "status"
          }
          className="rounded-xl border border-border bg-surface p-3 text-caption-1-regular text-fg"
        >
          {message}
        </p>
      ) : null}

      <section className="grid gap-3 rounded-xl border border-border bg-canvas p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-h5 text-fg">Snapshot results</h2>
            <p className="text-caption-1-regular text-fg-muted">
              {snapshot
                ? `Snapshot expires ${formatInstant(snapshot.expiresAt)}.`
                : "Create a snapshot before paging, verification, or export."}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {hasIntegrityBreak ? (
              <Tag variant="dot" tone="red">
                Integrity break detected
              </Tag>
            ) : null}
            <Button
              type="button"
              variant="outline"
              tone="grey"
              startIcon={<CheckCircle2 />}
              disabled={selectedVerifiableIds.length === 0}
              loading={verify.isPending}
              loadingLabel="Verifying selected events"
              onClick={() => void verifySelection()}
            >
              Verify selected
            </Button>
          </div>
        </div>

        {page.isLoading ? (
          <p role="status" className="text-caption-1-regular text-fg-muted">
            Loading audit events…
          </p>
        ) : null}
        {page.isError ? (
          <div role="alert" className="flex flex-wrap items-center gap-2">
            <span className="text-caption-1-regular text-danger">
              {errorText(page.error)}
            </span>
            <Button
              variant="outline"
              tone="grey"
              onClick={() => void page.refetch()}
            >
              Retry
            </Button>
          </div>
        ) : null}
        {snapshot && !page.isLoading && !page.isError && rows.length === 0 ? (
          <p className="text-caption-1-regular text-fg-muted">
            No audit events match these filters.
          </p>
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table
              aria-label="Audit events"
              aria-busy={page.isFetching || undefined}
              className="w-full min-w-[960px] border-collapse text-left text-caption-1-regular text-fg"
            >
              <thead>
                <tr className="border-b border-border text-caption-2-semibold text-fg-muted">
                  <th scope="col" className="p-2">
                    Select
                  </th>
                  <th scope="col" className="p-2">
                    Time
                  </th>
                  <th scope="col" className="p-2">
                    Actor
                  </th>
                  <th scope="col" className="p-2">
                    Action
                  </th>
                  <th scope="col" className="p-2">
                    Resource
                  </th>
                  <th scope="col" className="p-2">
                    Verification
                  </th>
                  <th scope="col" className="p-2">
                    Details
                  </th>
                </tr>
              </thead>
              <tbody className={cn(page.isFetching && "opacity-60")}>
                {rows.map((row) => {
                  const status = verified[row.id] ?? row.verificationStatus;
                  return (
                    <tr
                      key={row.id}
                      className="border-b border-border align-top last:border-0"
                    >
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selected.has(row.id)}
                          aria-label={`Select ${row.action}`}
                          onChange={() => toggle(row)}
                          className="size-4 rounded border-border text-active-500 focus-visible:ring-2 focus-visible:ring-focus"
                        />
                      </td>
                      <td className="p-2">
                        <time dateTime={row.createdAt}>
                          {formatInstant(row.createdAt)}
                        </time>
                        <span className="block text-caption-2-regular text-fg-muted">
                          {row.sequence
                            ? `Seq ${row.sequence}`
                            : "Legacy unchained"}
                        </span>
                      </td>
                      <td className="p-2">
                        <span className="block text-caption-1-semibold text-fg">
                          {row.actor.label ?? row.actor.id ?? "Unknown actor"}
                        </span>
                        <span className="block text-caption-2-regular text-fg-muted">
                          {label(row.actor.type)}
                        </span>
                      </td>
                      <td className="p-2">{row.action}</td>
                      <td className="p-2">
                        <span className="block text-caption-1-semibold text-fg">
                          {row.resourceType}
                        </span>
                        <span className="block max-w-64 truncate text-caption-2-regular text-fg-muted">
                          {row.resourceId ?? "None"}
                        </span>
                      </td>
                      <td className="p-2">
                        <Tag variant="dot" tone={verificationTone(status)}>
                          {verificationLabel(status)}
                        </Tag>
                      </td>
                      <td className="p-2">
                        <Button
                          size="sm"
                          variant="outline"
                          tone="grey"
                          startIcon={<Eye />}
                          data-audit-detail-opener={row.id}
                          onClick={(event) =>
                            openDetail(row, event.currentTarget)
                          }
                        >
                          Open
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : null}

        {snapshot ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={cursorStack.length === 0}
              onClick={previousPage}
            >
              Previous
            </Button>
            <span className="text-caption-1-regular text-fg-muted">
              {rows.length} rows on this page
            </span>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              disabled={!page.data?.nextCursor}
              onClick={nextPage}
            >
              Next
            </Button>
          </div>
        ) : null}
      </section>

      <section className="grid gap-3 rounded-xl border border-border bg-canvas p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-h5 text-fg">Filtered export</h2>
            <p className="text-caption-1-regular text-fg-muted">
              Exports include a manifest hash for offline verification. Download
              access is rechecked before the file is opened.
            </p>
          </div>
          {!canExport ? (
            <Tag variant="dot" tone="orange">
              Export permission required
            </Tag>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1 text-caption-1-semibold text-fg-muted">
            Format
            <select
              value={format}
              onChange={(event) =>
                setFormat(event.target.value as AuditExportFormat)
              }
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <option value="csv">CSV</option>
              <option value="json">JSON</option>
            </select>
          </label>
          <Button
            type="button"
            startIcon={format === "csv" ? <FileText /> : <FileJson />}
            disabled={!snapshot || !canExport}
            loading={createExport.isPending}
            onClick={() => void requestExport()}
          >
            Queue export
          </Button>
          {exportJob.data?.status === "ready" ? (
            <Button
              type="button"
              variant="outline"
              tone="grey"
              startIcon={<Download />}
              loading={grant.isPending}
              onClick={() => void authorizeDownload()}
            >
              Authorize download
            </Button>
          ) : null}
        </div>
        {exportJobId ? (
          <div className="grid gap-2 rounded-lg border border-border bg-surface p-3 text-caption-1-regular text-fg">
            <p>
              Export status:{" "}
              <span className="text-caption-1-semibold">
                {exportJob.data ? jobStatus(exportJob.data) : "Loading"}
              </span>
            </p>
            {exportJob.data?.packageHash ? (
              <p className="break-all font-mono text-caption-2-regular">
                SHA-256 {exportJob.data.packageHash}
              </p>
            ) : null}
          </div>
        ) : null}
      </section>

      <AuditDetailPanel
        open={detailId !== null}
        detail={detail}
        hasIntegrityBreak={hasIntegrityBreak}
        onOpenChange={(open) => {
          if (!open) closeDetail();
        }}
        onCloseAutoFocus={restoreDetailFocus}
        errorText={errorText}
      />
    </section>
  );
}
