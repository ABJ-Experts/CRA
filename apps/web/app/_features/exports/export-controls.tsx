"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import {
  exportSources,
  exportManifestSchema,
  type CreateExportJobInput,
  type ExportJob,
} from "@repo/contracts/exports";
import { ApiClientError } from "../../_lib/http/api-client";
import { exportsGateway, type ExportsGateway } from "./exports.api";
import { useSession } from "../../_providers/session-provider";
import { storeReportDraftSeed } from "../reports/report-draft";

type Gateway = Pick<
  ExportsGateway,
  | "create"
  | "get"
  | "cancel"
  | "retry"
  | "grant"
  | "createReadiness"
  | "manifest"
>;
type Source = keyof typeof exportSources;
export type ExportControlsProps = Readonly<{
  source: Source;
  label?: string;
  context: Record<string, unknown>;
  filters: Record<string, unknown>;
  columns?: readonly string[];
  selectedIds?: readonly string[];
  enabled: boolean;
  /** Source refresh only blocks new capture; existing authorized jobs remain available. */
  creationEnabled?: boolean;
  readinessProductId?: string;
  gateway?: Gateway;
}>;
const terminal = new Set(["ready", "failed", "cancelled", "expired"]);
function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.kind === "invalid_request")
    return "The current view filters are invalid. Refresh the view before retrying.";
  if (
    error instanceof ApiClientError &&
    [401, 403, 404].includes(error.status ?? 0)
  )
    return "Your permission or session changed. Refresh the view before requesting an export.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This export changed in another session. Refresh its status before retrying.";
  if (error instanceof ApiClientError && error.status === 422)
    return "This export exceeds a supported limit. Narrow the filters or choose CSV.";
  return "Export services are temporarily unavailable. Your format and scope are preserved; retry when available.";
}
function label(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " ");
}

/** Inline operational controls: never owns or changes the list's filters or drafts. */
export function ExportControls({
  source,
  label: buttonLabel,
  context,
  filters,
  columns,
  selectedIds,
  enabled,
  creationEnabled = true,
  readinessProductId,
  gateway = exportsGateway,
}: ExportControlsProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [format, setFormat] = useState<"csv" | "xlsx">("csv");
  const [scope, setScope] = useState<
    "all_filtered" | "current_page" | "selected"
  >("all_filtered");
  const [job, setJob] = useState<ExportJob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const attempt = useRef<{ signature: string; key: string } | null>(null);
  const sourceDefinition = exportSources[source];
  const { session, permissions = {}, role, isLoading } = useSession();
  const canSchedule =
    creationEnabled &&
    !isLoading &&
    Boolean(session?.organization?.id && session?.user?.id) &&
    sourceDefinition.subjectKind === "member" &&
    sourceDefinition.requiredPermissions.every(
      (permission) => permissions[permission] === true,
    ) &&
    (!sourceDefinition.requiredRole ||
      role === "owner" ||
      (sourceDefinition.requiredRole === "admin" && role === "admin"));
  const deliveryActive = useRef(true);
  const deliveryEnabled = useRef(enabled);
  deliveryEnabled.current = enabled;
  useEffect(() => {
    deliveryActive.current = true;
    return () => {
      deliveryActive.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) {
      setJob(null);
      setOpen(false);
    }
  }, [enabled]);
  useEffect(() => {
    if (!enabled || !job || terminal.has(job.state)) return;
    const controller = new AbortController();
    let active = true;
    const timer = setTimeout(() => {
      void gateway
        .get(job.id, controller.signal)
        .then((response) => {
          if (active) {
            setJob(response.data);
            setMessage(null);
          }
        })
        .catch((error: unknown) => {
          if (!active) return;
          setMessage(errorMessage(error));
          // Revoked access must remove all cached counts/artifact metadata.
          if (
            error instanceof ApiClientError &&
            [401, 403, 404].includes(error.status ?? 0)
          )
            setJob(null);
        });
    }, 2_000);
    return () => {
      active = false;
      clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, job, gateway]);

  if (!enabled) return null;
  async function create() {
    if (!creationEnabled) return;
    setBusy(true);
    setMessage(null);
    try {
      const draft = readinessProductId
        ? { productId: readinessProductId }
        : {
            source,
            context,
            filters,
            columns,
            scope,
            format,
            selectedIds: scope === "selected" ? selectedIds : undefined,
          };
      const signature = JSON.stringify(draft);
      if (attempt.current?.signature !== signature)
        attempt.current = { signature, key: crypto.randomUUID() };
      const key = attempt.current.key;
      const response = readinessProductId
        ? await gateway.createReadiness({
            productId: readinessProductId,
            idempotencyKey: key,
          })
        : await gateway.create({
            ...draft,
            idempotencyKey: key,
          } as CreateExportJobInput);
      setJob(response.data);
      attempt.current = null;
    } catch (error) {
      setMessage(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  async function action(kind: "cancel" | "retry" | "refresh") {
    if (!job) return;
    setBusy(true);
    setMessage(null);
    try {
      const response =
        kind === "refresh"
          ? await gateway.get(job.id)
          : await gateway[kind](job.id, job.version);
      setJob(response.data);
    } catch (error) {
      setMessage(errorMessage(error));
      if (
        error instanceof ApiClientError &&
        [401, 403, 404].includes(error.status ?? 0)
      )
        setJob(null);
    } finally {
      setBusy(false);
    }
  }
  async function downloadManifest() {
    if (!job) return;
    setBusy(true);
    setMessage(null);
    try {
      // Dedicated delivery performs fresh source/session authorization and durable access audit.
      const response = await gateway.manifest(job.id);
      if (!deliveryActive.current || !deliveryEnabled.current) return;
      const manifest = exportManifestSchema.parse(response.data);
      if (manifest.jobId !== job.id || manifest.source !== job.source)
        throw new ApiClientError(
          "invalid_response",
          "The manifest identity is invalid.",
        );
      const objectUrl = URL.createObjectURL(
        new Blob([JSON.stringify(manifest, null, 2) + "\n"], {
          type: "application/json;charset=utf-8",
        }),
      );
      const anchor = document.createElement("a");
      try {
        anchor.href = objectUrl;
        anchor.download = `export-${manifest.jobId}-manifest.json`;
        document.body.appendChild(anchor);
        anchor.click();
      } finally {
        anchor.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      }
    } catch (error) {
      setMessage(errorMessage(error));
      if (
        error instanceof ApiClientError &&
        [401, 403, 404].includes(error.status ?? 0)
      )
        setJob(null);
    } finally {
      setBusy(false);
    }
  }
  async function download(artifactId: string) {
    if (!job) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await gateway.grant(job.id, artifactId);
      const expectedSuffix = `/${job.id}/download/${response.data.grantId}`;
      const allowedPrefixes = [
        "/api/v1/exports",
        "/api/v1/auditor/exports",
        "/api/v1/supplier-evidence-portal/exports",
      ];
      if (
        !allowedPrefixes.some(
          (prefix) =>
            response.data.downloadPath === `${prefix}${expectedSuffix}`,
        )
      )
        throw new ApiClientError(
          "invalid_response",
          "The download path is invalid.",
        );
      const anchor = document.createElement("a");
      anchor.href = response.data.downloadPath;
      anchor.download = "";
      anchor.click();
    } catch (error) {
      setMessage(errorMessage(error));
      if (
        error instanceof ApiClientError &&
        [401, 403, 404].includes(error.status ?? 0)
      )
        setJob(null);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className={cn("flex flex-col gap-3 text-caption-1-regular text-fg")}>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="button"
          variant="outline"
          aria-expanded={open}
          aria-controls={`${id}-panel`}
          onClick={() => setOpen(!open)}
        >
          {buttonLabel ??
            (readinessProductId ? "Export readiness report" : "Export list")}
        </Button>
        {canSchedule ? (
          <Link
            className="inline-flex min-h-10 items-center rounded-md border border-border bg-canvas px-4 text-subhead-medium text-fg underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            href="/dashboard/reports"
            onClick={(event) => {
              event.preventDefault();
              try {
                const scope = `${session!.organization!.id}:${session!.user.id}`;
                const key = storeReportDraftSeed(
                  readinessProductId
                    ? { kind: "readiness", productId: readinessProductId }
                    : { source, format, context, filters, columns },
                  scope,
                );
                window.location.assign(
                  `/dashboard/reports?draft=${encodeURIComponent(key)}`,
                );
              } catch {
                setScheduleError(
                  "This source cannot be scheduled from the current view. Refresh its filters and try again.",
                );
              }
            }}
          >
            Schedule report
          </Link>
        ) : null}
      </div>
      {scheduleError ? (
        <p
          role="alert"
          className="max-w-prose text-caption-1-regular text-danger"
        >
          {scheduleError}
        </p>
      ) : null}
      {open ? (
        <section
          id={`${id}-panel`}
          aria-label={
            readinessProductId ? "Readiness report export" : "List export"
          }
          className={cn("flex flex-col gap-3 border-t border-border pt-3")}
        >
          {readinessProductId ? (
            <p className="max-w-prose text-fg-muted">
              PDF and JSON from current authorized evidence. Documentation
              readiness does not certify conformity.
            </p>
          ) : (
            <>
              <div className="flex flex-wrap gap-3">
                <label className="flex flex-col gap-1">
                  Export format
                  <select
                    aria-label="Export format"
                    value={format}
                    onChange={(event) =>
                      setFormat(event.target.value as "csv" | "xlsx")
                    }
                    className="rounded border border-border bg-canvas p-2 text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <option value="csv">CSV</option>
                    <option value="xlsx">XLSX</option>
                  </select>
                </label>
                <label className="flex flex-col gap-1">
                  Export scope
                  <select
                    aria-label="Export scope"
                    value={scope}
                    onChange={(event) =>
                      setScope(event.target.value as typeof scope)
                    }
                    className="rounded border border-border bg-canvas p-2 text-fg focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                  >
                    <option value="all_filtered">All filtered results</option>
                    {sourceDefinition.supportsPage ? (
                      <option value="current_page">Current page</option>
                    ) : null}
                    {sourceDefinition.supportsSelection &&
                    selectedIds?.length ? (
                      <option value="selected">Selected rows</option>
                    ) : null}
                  </select>
                </label>
              </div>
              <p className="max-w-prose text-fg-muted">
                Uses the current filters and approved columns. Maximum 100,000
                rows / 128 MiB per capture. Larger results require narrower
                filters; no rows are silently omitted.
              </p>
            </>
          )}
          <div>
            <Button
              type="button"
              disabled={busy || !creationEnabled}
              onClick={() => void create()}
            >
              {busy ? "Requesting…" : "Create export"}
            </Button>
          </div>
          {message ? (
            <p role="alert" className="max-w-prose text-danger">
              {message}
            </p>
          ) : null}
          {job ? (
            <div className="flex flex-col gap-2" aria-label="Export status">
              <p role="status">
                {label(job.state)}
                {job.snapshotAsOf
                  ? ` · Captured ${new Date(job.snapshotAsOf).toLocaleString()}`
                  : " · Snapshot pending"}
              </p>
              <p className="text-fg-muted">
                Requested {new Date(job.requestedAt).toLocaleString()}
                {job.rowCount === null
                  ? ""
                  : ` · ${job.rowCount.toLocaleString()} rows`}
              </p>
              {!terminal.has(job.state) ? (
                <progress
                  aria-label="Export progress"
                  max={100}
                  value={
                    job.progress.totalRows
                      ? Math.round(
                          (job.progress.processedRows /
                            job.progress.totalRows) *
                            100,
                        )
                      : undefined
                  }
                  className="w-full"
                />
              ) : null}
              {job.state === "ready" && job.rowCount === 0 ? (
                <p>No rows matched. The file includes column headers.</p>
              ) : null}
              {job.state === "failed" ? (
                <p role="alert">
                  Export failed. Refresh the status and retry; the captured
                  result is preserved when available.
                </p>
              ) : null}
              {job.state === "expired" ? (
                <p>
                  The download window expired. Create a new export from the
                  current filters.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void action("refresh")}
                >
                  Refresh status
                </Button>
                {!terminal.has(job.state) ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void action("cancel")}
                  >
                    Cancel export
                  </Button>
                ) : null}
                {job.state === "failed" && job.failure?.retryable ? (
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => void action("retry")}
                  >
                    Retry export
                  </Button>
                ) : null}
                {job.state === "ready" ? (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void downloadManifest()}
                  >
                    Download manifest JSON
                  </Button>
                ) : null}
                {job.state === "ready"
                  ? job.artifacts.map((artifact) => (
                      <Button
                        key={artifact.id}
                        type="button"
                        variant="outline"
                        disabled={busy}
                        onClick={() => void download(artifact.id)}
                      >
                        Download {artifact.name}
                      </Button>
                    ))
                  : null}
              </div>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}
