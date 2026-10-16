import { useEffect, useRef, useState } from "react";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type {
  SupportDiagnosticJob,
  SupportDiagnosticContent,
  SupportDiagnosticCleanupReview,
  SupportDiagnosticGrant,
} from "@repo/contracts/support-diagnostics/types";
import { diagnosticPanel, type DiagnosticGateway } from "./support-diagnostics";

export function DiagnosticJobDetail({
  organizationId,
  job,
  gateway,
  onJob,
  onFailure,
}: {
  organizationId: string;
  job: SupportDiagnosticJob;
  gateway: DiagnosticGateway;
  onJob: (value: SupportDiagnosticJob) => void;
  onFailure: (error: unknown) => void;
}) {
  const [content, setContent] = useState<SupportDiagnosticContent | null>(null);
  const [review, setReview] = useState<SupportDiagnosticCleanupReview | null>(
    null,
  );
  const [grant, setGrant] = useState<SupportDiagnosticGrant | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [section, setSection] =
    useState<SupportDiagnosticContent["section"]>("logs");
  const [offset, setOffset] = useState(0);
  const [reload, setReload] = useState(0);
  const [contentError, setContentError] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const mutationKeys = useRef<Record<string, string>>({});
  useEffect(() => {
    const current = new AbortController();
    controller.current = current;
    return () => current.abort();
  }, []);
  useEffect(() => {
    setReview(null);
    setConfirmed(false);
    setGrant(null);
  }, [job.version]);
  useEffect(() => {
    setContent(null);
    setContentError(false);
    if (job.state !== "ready") return;
    const current = new AbortController();
    void gateway
      .content(
        organizationId,
        job.id,
        { section, offset, limit: 100 },
        current.signal,
      )
      .then((value) => {
        if (!current.signal.aborted) setContent(value);
      })
      .catch((error: unknown) => {
        if (!current.signal.aborted) {
          setContentError(true);
          onFailure(error);
        }
      });
    return () => current.abort();
    // onFailure is event handling; its identity must not refetch sensitive content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    organizationId,
    job.id,
    job.version,
    job.state,
    section,
    offset,
    reload,
    gateway,
  ]);
  async function run<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    apply: (value: T) => void,
  ) {
    const signal = controller.current!.signal;
    setBusy(true);
    try {
      const value = await operation(signal);
      if (!signal.aborted) apply(value);
    } catch (error) {
      if (!signal.aborted) {
        setReview(null);
        setConfirmed(false);
        setGrant(null);
        onFailure(error);
      }
    } finally {
      if (!signal.aborted) setBusy(false);
    }
  }
  function mutation(action: string) {
    const key = `${action}:${job.version}`;
    mutationKeys.current = {
      ...mutationKeys.current,
      [key]: mutationKeys.current[key] ?? crypto.randomUUID(),
    };
    return {
      expectedVersion: job.version,
      idempotencyKey: mutationKeys.current[key]!,
    };
  }
  const active = ["queued", "running"].includes(job.state);
  return (
    <section
      aria-label="Diagnostic bundle details"
      className={cn(diagnosticPanel, "flex min-w-0 flex-col gap-5")}
    >
      <div className={cn("flex flex-wrap items-center justify-between gap-3")}>
        <h3 className={cn("text-h5")}>Diagnostic bundle details</h3>
        <Button
          disabled={busy}
          variant="outline"
          tone="grey"
          onClick={() =>
            void run(
              (signal) => gateway.read(organizationId, job.id, signal),
              onJob,
            )
          }
        >
          Refresh job
        </Button>
      </div>
      <p className={cn("break-all")}>
        Bundle {job.id} · {job.state} · version {job.version}
      </p>
      {active ? (
        <div role="status">
          <p>
            {job.stage}: {job.progress.completed.toLocaleString()} of{" "}
            {job.progress.total.toLocaleString()}
          </p>
          <progress
            className={cn("mt-2 w-full")}
            aria-label="Diagnostic generation progress"
            value={job.progress.completed}
            max={Math.max(1, job.progress.total)}
          />
        </div>
      ) : null}
      <p>
        Consent recorded {new Date(job.consentedAt).toLocaleString()}.{" "}
        {job.expiresAt
          ? `Availability ends ${new Date(job.expiresAt).toLocaleString()}.`
          : "Availability begins after generation."}
      </p>
      {job.state === "failed" ? (
        <p role="alert">
          Generation failed: {job.failureCode ?? "source unavailable"}. Review
          your selection and generate a new bundle.
        </p>
      ) : null}
      {["expired", "cancelled"].includes(job.state) ? (
        <p role="status">
          {job.state === "expired"
            ? "Availability expired."
            : "Consent withdrawn; generation stopped."}{" "}
          Retained artifacts continue to count toward storage until reviewed
          cleanup completes.
        </p>
      ) : null}
      {job.state === "deleted" ? (
        <p role="status">Cleanup completed. Diagnostic artifact deleted.</p>
      ) : null}
      {job.cleanup.state === "blocked" ? (
        <p role="alert">
          Cleanup blocked: {job.cleanup.blockers.join(", ")}. Retained storage
          remains accounted.
        </p>
      ) : null}
      {["requested", "deleting"].includes(job.cleanup.state) ? (
        <p role="status">
          Cleanup {job.cleanup.state}; retained storage remains accounted until
          deletion is confirmed.
        </p>
      ) : null}
      {["queued", "running", "ready"].includes(job.state) ? (
        <div>
          <Button
            disabled={busy}
            variant="outline"
            tone="grey"
            onClick={() =>
              void run(
                (signal) =>
                  gateway.cancel(
                    organizationId,
                    job.id,
                    mutation("cancel"),
                    signal,
                  ),
                onJob,
              )
            }
          >
            {active
              ? "Cancel generation and withdraw consent"
              : "Withdraw consent"}
          </Button>
        </div>
      ) : null}
      {job.omissions.length ? (
        <p role="status">
          Omissions:{" "}
          {job.omissions
            .map((item) => `${item.category}: ${item.code}`)
            .join("; ")}
        </p>
      ) : null}
      {job.state === "ready" ? (
        <>
          <div>
            <h4 className={cn("text-subhead-semibold")}>
              Inspect actual bundle content
            </h4>
            <p className={cn("mt-2")}>
              Redacted content from this generated artifact. Review each
              selected section and omissions before download.
            </p>
          </div>
          <div
            className={cn("flex flex-wrap gap-2")}
            role="group"
            aria-label="Content sections"
          >
            {(["logs", "configuration", "metrics", "omissions"] as const).map(
              (value) => (
                <Button
                  variant="outline"
                  tone="grey"
                  key={value}
                  aria-pressed={section === value}
                  disabled={busy}
                  onClick={() => {
                    if (value === section) return;
                    setContent(null);
                    setSection(value);
                    setOffset(0);
                  }}
                >
                  {value === "configuration"
                    ? "Configuration content"
                    : `${value[0]!.toUpperCase()}${value.slice(1)} content`}
                </Button>
              ),
            )}
          </div>
          {content ? (
            <div
              aria-label={`${content.section} content`}
              className={cn(
                "min-w-0 rounded-xl border border-border bg-surface p-4",
              )}
            >
              <pre
                className={cn(
                  "max-h-96 overflow-auto whitespace-pre-wrap break-words font-sans text-caption-regular",
                )}
              >
                {content.section === "configuration" && content.data === null
                  ? "Configuration was not selected or is unavailable. Inspect omissions for details."
                  : Array.isArray(content.data) && content.data.length === 0
                    ? content.section === "omissions"
                      ? "No source omissions recorded."
                      : "No redacted records in this section. Check omissions for details."
                    : JSON.stringify(content.data, null, 2)}
              </pre>
              <p className={cn("mt-3")}>
                Rows {offset.toLocaleString()} onward · up to 100 per page
              </p>
            </div>
          ) : contentError ? (
            <p role="alert">
              Content unavailable. Retry inspection before downloading.
            </p>
          ) : (
            <p role="status">Loading redacted content…</p>
          )}
          <div className={cn("flex flex-wrap gap-3")}>
            <Button
              variant="outline"
              tone="grey"
              disabled={busy || offset === 0}
              onClick={() => {
                setContent(null);
                setOffset(Math.max(0, offset - 100));
              }}
            >
              Previous content page
            </Button>
            <Button
              variant="outline"
              tone="grey"
              disabled={busy || content?.nextOffset == null}
              onClick={() => {
                setContent(null);
                setOffset(content!.nextOffset!);
              }}
            >
              Next content page
            </Button>
            <Button
              variant="outline"
              tone="grey"
              disabled={busy}
              onClick={() => {
                setContent(null);
                setReload((value) => value + 1);
              }}
            >
              Retry content
            </Button>
          </div>
          {job.artifact ? (
            <p className={cn("break-all")}>
              {job.artifact.fileName} · {job.artifact.byteSize.toLocaleString()}{" "}
              bytes · SHA-256 {job.artifact.sha256}
            </p>
          ) : null}
          <p>
            Downloading grants local access only. CRA Sentinel does not transmit
            the bundle to support.
          </p>
          <div>
            <Button
              disabled={busy || !content}
              onClick={() =>
                void run(
                  (signal) =>
                    gateway.grant(
                      organizationId,
                      job.id,
                      {
                        expectedVersion: job.version,
                        idempotencyKey: crypto.randomUUID(),
                      },
                      signal,
                    ),
                  setGrant,
                )
              }
            >
              Authorize bundle download
            </Button>
          </div>
          {grant ? (
            <div>
              <a
                className={cn(
                  "text-active-500 underline focus-visible:outline focus-visible:outline-2 motion-reduce:transition-none",
                )}
                href={grant.downloadPath}
                download
              >
                Download authorized diagnostic bundle
              </a>
              <p className={cn("mt-2")}>
                Grant expires {new Date(grant.expiresAt).toLocaleString()}.
                Request a fresh grant if it expires.
              </p>
            </div>
          ) : null}
        </>
      ) : null}
      {job.state !== "deleted" ? (
        <section
          aria-label="Review retained artifact cleanup"
          className={cn("flex flex-col gap-4 border-t border-border pt-5")}
        >
          <h4 className={cn("text-subhead-semibold")}>
            Retained artifact cleanup
          </h4>
          <p>
            Availability expires independently of retention. Review current
            retention and legal-hold blockers before permanently deleting the
            diagnostic artifact.
          </p>
          <div>
            <Button
              variant="outline"
              tone="grey"
              disabled={busy || active}
              onClick={() =>
                void run(
                  (signal) =>
                    gateway.reviewCleanup(organizationId, job.id, signal),
                  (value) => {
                    setReview(value);
                    setConfirmed(false);
                  },
                )
              }
            >
              Review cleanup
            </Button>
          </div>
          {review ? (
            <>
              <p role="status">
                {review.eligible
                  ? "Eligible for cleanup at this review."
                  : `Retained: ${review.blockers.join(", ") || "cleanup is not eligible"}.`}
              </p>
              {review.eligible ? (
                <>
                  <label className={cn("flex min-h-10 items-start gap-3")}>
                    <input
                      type="checkbox"
                      checked={confirmed}
                      disabled={busy}
                      onChange={(event) => setConfirmed(event.target.checked)}
                    />
                    <span>
                      I confirm permanent cleanup of this diagnostic artifact
                      using the current retention review.
                    </span>
                  </label>
                  <div>
                    <Button
                      disabled={busy || !confirmed}
                      onClick={() =>
                        void run(
                          (signal) =>
                            gateway.cleanup(
                              organizationId,
                              job.id,
                              {
                                ...mutation("cleanup"),
                                reviewFingerprint: review.reviewFingerprint,
                              },
                              signal,
                            ),
                          (value) => {
                            setContent(null);
                            onJob(value);
                            setReview(null);
                            setConfirmed(false);
                          },
                        )
                      }
                    >
                      Confirm diagnostic cleanup
                    </Button>
                  </div>
                </>
              ) : null}
            </>
          ) : null}
        </section>
      ) : null}
    </section>
  );
}
