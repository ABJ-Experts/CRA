"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type {
  SupportDiagnosticSelection,
  SupportDiagnosticPreview,
  SupportDiagnosticJob,
  SupportDiagnosticList,
} from "@repo/contracts/support-diagnostics/types";
import { diagnosticSelectionSchema } from "@repo/contracts/support-diagnostics/schemas";
import { ApiClientError } from "../../_lib/http/api-client";
import type { HealthScope } from "../system-health/system-health-content";
import {
  supportDiagnosticsGateway,
  type SupportDiagnosticsGateway,
} from "./support-diagnostics.gateway";
import { DiagnosticJobDetail } from "./diagnostic-job-detail";
import { DiagnosticSelectionForm } from "./diagnostic-selection-form";
export type DiagnosticGateway = Pick<
  SupportDiagnosticsGateway,
  | "preview"
  | "create"
  | "list"
  | "read"
  | "content"
  | "cancel"
  | "grant"
  | "reviewCleanup"
  | "cleanup"
>;
export const diagnosticPanel = "rounded-xl border border-border bg-canvas p-6";
export function diagnosticFailure(error: unknown) {
  if (error instanceof ApiClientError) {
    if (error.status === 403 || error.status === 401)
      return "Diagnostic access is forbidden or has changed. Refresh access before continuing.";
    if (error.status === 409)
      return "The diagnostic or cleanup review is stale or conflicted. Refresh the job and review again.";
    if (error.status === 410)
      return "This preview or download has expired. Request a fresh preview or download grant.";
    if (error.status === 429)
      return "Another diagnostic is active or the request limit was reached. Try again shortly.";
  }
  return "Diagnostics are unavailable. Your form is preserved. Try again.";
}
export function defaultDiagnosticSelection(): SupportDiagnosticSelection {
  const to = new Date();
  return {
    categories: ["logs", "configuration", "metrics"],
    from: new Date(to.getTime() - 86_400_000).toISOString(),
    to: to.toISOString(),
  };
}
export function SupportDiagnostics({
  scope,
  canGenerate,
  gateway = supportDiagnosticsGateway,
}: {
  scope: HealthScope | null;
  canGenerate: boolean;
  gateway?: DiagnosticGateway;
}) {
  if (!scope) return null;
  return (
    <DiagnosticDraft
      key={JSON.stringify([scope.userId, scope.organizationId])}
      scope={scope}
      canGenerate={canGenerate}
      gateway={gateway}
    />
  );
}
function DiagnosticDraft({
  scope,
  canGenerate,
  gateway,
}: {
  scope: HealthScope;
  canGenerate: boolean;
  gateway: DiagnosticGateway;
}) {
  const [selection, setSelection] = useState(defaultDiagnosticSelection);
  return (
    <DiagnosticWorkspace
      key={JSON.stringify([scope.permissionRevision, canGenerate])}
      scope={scope}
      canGenerate={canGenerate}
      gateway={gateway}
      selection={selection}
      onSelection={setSelection}
    />
  );
}
function DiagnosticWorkspace({
  scope,
  canGenerate,
  gateway,
  selection,
  onSelection,
}: {
  scope: HealthScope;
  canGenerate: boolean;
  gateway: DiagnosticGateway;
  selection: SupportDiagnosticSelection;
  onSelection: (selection: SupportDiagnosticSelection) => void;
}) {
  const [history, setHistory] = useState<SupportDiagnosticList | null>(null);
  const [preview, setPreview] = useState<SupportDiagnosticPreview | null>(null);
  const [consent, setConsent] = useState(false);
  const [job, setJob] = useState<SupportDiagnosticJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const createKey = useRef<string | null>(null);
  const org = scope.organizationId;
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  const fail = (value: unknown) => {
    setError(diagnosticFailure(value));
    if (
      value instanceof ApiClientError &&
      [401, 403].includes(value.status ?? 0)
    ) {
      setForbidden(true);
      setPreview(null);
      setConsent(false);
      setJob(null);
      setHistory(null);
    }
  };
  useEffect(() => {
    if (!canGenerate) return;
    const current = new AbortController();
    setLoading(true);
    void gateway
      .list(org, undefined, current.signal)
      .then((value) => {
        if (!current.signal.aborted) {
          setHistory(value);
          setError(null);
        }
      })
      .catch((value: unknown) => {
        if (!current.signal.aborted) fail(value);
      })
      .finally(() => {
        if (!current.signal.aborted) setLoading(false);
      });
    return () => current.abort();
  }, [canGenerate, gateway, org, attempt]);
  async function perform<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
  ) {
    const signal = controller.current!.signal;
    setBusy(true);
    setError(null);
    try {
      const value = await operation(signal);
      if (!signal.aborted) apply(value);
    } catch (value) {
      if (!signal.aborted) fail(value);
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  const acceptJob = (value: SupportDiagnosticJob) => {
    setJob((current) =>
      current?.id === value.id && current.version > value.version
        ? current
        : value,
    );
    setHistory((current) =>
      current?.items.some(
        (item) => item.id === value.id && item.version > value.version,
      )
        ? current
        : current
          ? {
              ...current,
              items: [
                value,
                ...current.items.filter((item) => item.id !== value.id),
              ],
            }
          : current,
    );
  };
  useEffect(() => {
    if (
      !job ||
      forbidden ||
      (!["queued", "running"].includes(job.state) &&
        !["requested", "deleting"].includes(job.cleanup.state))
    )
      return;
    const current = new AbortController();
    const timer = setTimeout(() => {
      void gateway
        .read(org, job.id, current.signal)
        .then((value) => {
          if (!current.signal.aborted) acceptJob(value);
        })
        .catch((value: unknown) => {
          if (!current.signal.aborted) fail(value);
        });
    }, 2_000);
    return () => {
      clearTimeout(timer);
      current.abort();
    };
  }, [job, gateway, org, forbidden]);
  const changeSelection = (value: SupportDiagnosticSelection) => {
    onSelection(value);
    setPreview(null);
    setConsent(false);
    createKey.current = null;
  };
  return (
    <section
      aria-label="Support diagnostics"
      className={cn(
        "mt-8 flex min-w-0 flex-col gap-6 text-subhead-regular text-fg",
      )}
    >
      <div>
        <h2 className={cn("text-h4")}>Support diagnostics</h2>
        <p className={cn("mt-2")}>
          Generate a redacted local bundle for inspection. Nothing is sent to
          support. Only bundles you created in this organization are listed.
        </p>
      </div>
      {!canGenerate || forbidden ? (
        <p role="alert">
          Diagnostics require a current owner or administrator with system
          health export permission. Refresh access to continue.
        </p>
      ) : (
        <>
          {error ? (
            <div role="alert" className={cn(diagnosticPanel)}>
              <p>{error}</p>
              <Button
                variant="outline"
                tone="grey"
                onClick={() => {
                  setError(null);
                  setAttempt((value) => value + 1);
                }}
              >
                Retry history
              </Button>
            </div>
          ) : null}
          <DiagnosticSelectionForm
            selection={selection}
            onSelection={changeSelection}
            busy={busy}
            preview={preview}
            consent={consent}
            onConsent={setConsent}
            onPreview={() => {
              const parsed = diagnosticSelectionSchema.safeParse(selection);
              if (!parsed.success) {
                setError(
                  "Select at least one category and a valid UTC window of no more than seven days.",
                );
                return;
              }
              void perform(
                (signal) => gateway.preview(org, parsed.data, signal),
                (value) => {
                  setPreview(value);
                  setConsent(false);
                  createKey.current = crypto.randomUUID();
                },
              );
            }}
            onCreate={() => {
              if (!preview || !consent) return;
              if (Date.parse(preview.expiresAt) <= Date.now()) {
                setError(
                  "This preview has expired. Preview the selection again.",
                );
                setPreview(null);
                setConsent(false);
                return;
              }
              createKey.current ??= crypto.randomUUID();
              void perform(
                (signal) =>
                  gateway.create(
                    org,
                    {
                      previewToken: preview.previewToken,
                      consent: true,
                      idempotencyKey: createKey.current!,
                    },
                    signal,
                  ),
                (value) => {
                  acceptJob(value);
                  setPreview(null);
                  setConsent(false);
                  createKey.current = null;
                },
              );
            }}
          />
          <section
            aria-label="Your diagnostic history"
            className={cn(diagnosticPanel)}
          >
            <div
              className={cn(
                "flex flex-wrap items-center justify-between gap-3",
              )}
            >
              <h3 className={cn("text-h5")}>Your diagnostic history</h3>
              <Button
                variant="outline"
                tone="grey"
                disabled={loading || busy}
                onClick={() => setAttempt((value) => value + 1)}
              >
                Refresh history
              </Button>
            </div>
            {loading ? (
              <p role="status" className={cn("mt-4")}>
                Loading your diagnostic history…
              </p>
            ) : history?.items.length === 0 ? (
              <p className={cn("mt-4")}>
                No diagnostic bundles created by you.
              </p>
            ) : (
              <ul className={cn("mt-4 flex flex-col divide-y divide-border")}>
                {history?.items.map((item) => (
                  <li
                    key={item.id}
                    className={cn(
                      "flex flex-wrap items-center justify-between gap-3 py-3",
                    )}
                  >
                    <div>
                      <p>
                        {new Date(item.createdAt).toLocaleString()} ·{" "}
                        {item.state}
                      </p>
                      <p>{item.selection.categories.join(", ")}</p>
                    </div>
                    <Button
                      variant="outline"
                      tone="grey"
                      disabled={busy}
                      onClick={() =>
                        void perform(
                          (signal) => gateway.read(org, item.id, signal),
                          acceptJob,
                        )
                      }
                    >
                      Inspect bundle {item.id.slice(0, 8)}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
            {history?.nextCursor ? (
              <Button
                variant="outline"
                tone="grey"
                disabled={busy}
                onClick={() =>
                  void perform(
                    (signal) => gateway.list(org, history.nextCursor!, signal),
                    (value) =>
                      setHistory({
                        ...value,
                        items: [...history.items, ...value.items],
                      }),
                  )
                }
              >
                Load older bundles
              </Button>
            ) : null}
          </section>
          {job ? (
            <DiagnosticJobDetail
              key={`${job.id}:${job.version}`}
              organizationId={org}
              job={job}
              gateway={gateway}
              onJob={acceptJob}
              onFailure={fail}
            />
          ) : null}
        </>
      )}
    </section>
  );
}
