"use client";

import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useSession } from "../../_providers/session-provider";
import { ApiClientError } from "../../_lib/http/api-client";
import { reportsGateway, type ReportsGateway } from "./reports.api";
import type { ReportRunDetailResponse } from "@repo/contracts/reports";

function time(value: string | null): string {
  return value
    ? new Date(value).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Pending";
}

function errorMessage(error: unknown): string {
  if (
    error instanceof ApiClientError &&
    [401, 403, 404].includes(error.status ?? 0)
  )
    return "Your access to this report changed. Return to scheduled reports or sign in again.";
  if (error instanceof ApiClientError && error.status === 410)
    return "This protected artifact has expired. Its history remains available.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This run changed or recovery is no longer safe. Refresh its status before trying again.";
  return "This run is temporarily unavailable. Refresh to try again.";
}

export function ReportRunDetail({
  runId,
  gateway = reportsGateway,
}: {
  runId: string;
  gateway?: ReportsGateway;
}) {
  const { session, isLoading } = useSession();
  const scope = `${runId}:${session?.organization?.id ?? "none"}:${session?.user?.id ?? "none"}`;
  const scopeRef = useRef(scope);
  scopeRef.current = scope;
  const [detailScope, setDetailScope] = useState<string | null>(null);
  const [detail, setDetail] = useState<ReportRunDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [replayVersion, setReplayVersion] = useState<number | null>(null);
  const [busyReplay, setBusyReplay] = useState(false);
  const replayAttempt = useRef<{ signature: string; key: string } | null>(null);
  const [busyArtifact, setBusyArtifact] = useState<string | null>(null);
  const [download, setDownload] = useState<{
    artifactId: string;
    url: string;
    expiresAt: string;
  } | null>(null);
  const userId = session?.user?.id;

  const receiveRun = useCallback(
    (
      response: ReportRunDetailResponse,
      requestedScope: string,
      signal?: AbortSignal,
    ) => {
      if (scopeRef.current !== requestedScope || signal?.aborted) return;
      setDetail(response);
      setDetailScope(requestedScope);
      setError(null);
      setReplayVersion(null);
      if (
        response.run.kind !== "scheduled" ||
        !["failed", "succeeded"].includes(response.run.state) ||
        !response.recipients.some(
          (recipient) => recipient.generationState === "failed",
        )
      )
        return;
      void gateway
        .get(response.run.definitionId, signal)
        .then(({ data }) => {
          if (
            scopeRef.current === requestedScope &&
            !signal?.aborted &&
            data.ownerUserId === userId &&
            data.definitionVersion === response.run.definitionVersion &&
            data.state !== "archived"
          )
            setReplayVersion(data.version);
        })
        .catch(() => {
          // A recipient may view the run without owning its definition.
        });
    },
    [gateway, userId],
  );

  async function refresh() {
    const requestedScope = scope;
    setNotice(null);
    try {
      const response = await gateway.run(runId);
      receiveRun(response, requestedScope);
    } catch (reason) {
      if (scopeRef.current !== requestedScope) return;
      setError(errorMessage(reason));
      if (
        reason instanceof ApiClientError &&
        [401, 403, 404].includes(reason.status ?? 0)
      ) {
        setDetail(null);
        setDownload(null);
        setReplayVersion(null);
      }
    }
  }

  useEffect(() => {
    if (isLoading || !session?.organization?.id || !userId) return;
    const controller = new AbortController();
    setDetail(null);
    setDetailScope(null);
    setDownload(null);
    setError(null);
    setNotice(null);
    setReplayVersion(null);
    replayAttempt.current = null;
    void gateway
      .run(runId, controller.signal)
      .then((response) => {
        receiveRun(response, scope, controller.signal);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted && scopeRef.current === scope)
          setError(errorMessage(reason));
      });
    return () => controller.abort();
  }, [
    gateway,
    isLoading,
    receiveRun,
    runId,
    scope,
    session?.organization?.id,
    userId,
  ]);

  async function replayFailed() {
    if (!detail || replayVersion === null || busyReplay) return;
    const requestedScope = scope;
    const signature = `${runId}:${replayVersion}`;
    if (replayAttempt.current?.signature !== signature)
      replayAttempt.current = { signature, key: crypto.randomUUID() };
    setBusyReplay(true);
    setError(null);
    setNotice(null);
    try {
      const response = await gateway.replay(runId, {
        expectedVersion: replayVersion,
        idempotencyKey: replayAttempt.current.key,
      });
      if (scopeRef.current !== requestedScope) return;
      receiveRun(response, requestedScope);
      setNotice(
        "Recovery queued for failed recipients. Ready files remain available.",
      );
      replayAttempt.current = null;
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(errorMessage(reason));
    } finally {
      if (scopeRef.current === requestedScope) setBusyReplay(false);
    }
  }

  async function prepareDownload(recipientId: string, artifactId: string) {
    const requestedScope = scope;
    setBusyArtifact(artifactId);
    setDownload(null);
    setError(null);
    try {
      const response = await gateway.grant(runId, recipientId, artifactId);
      if (scopeRef.current !== requestedScope) return;
      const { url, grantId, expiresAt } = response.data;
      if (
        url !==
        `/api/v1/reports/runs/${runId}/recipients/${recipientId}/download/${grantId}`
      )
        throw new ApiClientError(
          "invalid_response",
          "The protected download path is invalid.",
        );
      setDownload({ artifactId, url, expiresAt });
    } catch (reason) {
      if (scopeRef.current === requestedScope) setError(errorMessage(reason));
    } finally {
      setBusyArtifact(null);
    }
  }

  if (isLoading || !userId || (detail !== null && detailScope !== scope))
    return (
      <div className="px-6 py-6">
        <p role="status">Loading report access…</p>
      </div>
    );
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-6 px-6 py-6 text-fg lg:px-[30px]",
      )}
    >
      <div>
        <Link
          href="/dashboard/reports"
          className="text-subhead-medium text-active-500 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
        >
          Scheduled reports
        </Link>
        <h1 className="mt-4 text-h3">Report run</h1>
        <p className="mt-2 max-w-prose text-subhead-regular text-fg-muted">
          Generation and notification delivery have separate outcomes. A ready
          file can remain available when email fails.
        </p>
      </div>
      {error ? (
        <p
          role="alert"
          className="max-w-prose rounded-lg border border-danger bg-surface p-4 text-subhead-regular text-danger"
        >
          {error}
        </p>
      ) : null}
      {notice ? (
        <p role="status" className="text-subhead-regular text-fg">
          {notice}
        </p>
      ) : null}
      <div>
        <Button type="button" variant="outline" onClick={() => void refresh()}>
          Refresh status
        </Button>
        {replayVersion !== null ? (
          <Button
            type="button"
            variant="outline"
            className="ml-3"
            disabled={busyReplay}
            onClick={() => void replayFailed()}
          >
            {busyReplay ? "Checking recovery…" : "Retry failed generation"}
          </Button>
        ) : null}
      </div>
      {!detail ? (
        <p role="status">Loading run…</p>
      ) : (
        <>
          <section
            className="border-y border-border py-5"
            aria-label="Run summary"
          >
            <dl className="grid gap-4 text-subhead-regular sm:grid-cols-3">
              <div>
                <dt className="text-fg-muted">Kind</dt>
                <dd>{detail.run.kind}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Run status</dt>
                <dd>{detail.run.state}</dd>
              </div>
              <div>
                <dt className="text-fg-muted">Scheduled for</dt>
                <dd>{time(detail.run.scheduledFor)}</dd>
              </div>
            </dl>
            {detail.run.safeErrorCode ? (
              <p className="mt-4">
                Reason: {detail.run.safeErrorCode.replaceAll("_", " ")}
              </p>
            ) : null}
          </section>
          <section aria-labelledby="run-recipients">
            <h2 id="run-recipients" className="text-h4">
              Recipients
            </h2>
            {detail.recipients.length === 0 ? (
              <p className="mt-3 text-subhead-regular text-fg-muted">
                No recipient result is available yet.
              </p>
            ) : (
              <ul className="mt-4 divide-y divide-border border-y border-border">
                {detail.recipients.map((recipient) => {
                  const mine = recipient.userId === userId;
                  const available =
                    recipient.generationState === "ready" &&
                    recipient.expiresAt !== null &&
                    Date.parse(recipient.expiresAt) > Date.now();
                  return (
                    <li key={recipient.id} className="py-5">
                      <h3 className="text-subhead-medium">
                        {mine ? "You" : "Member"}
                      </h3>
                      <div className="mt-2 flex flex-wrap gap-x-6 gap-y-1 text-subhead-regular">
                        <p>Generation: {recipient.generationState}</p>
                        <p>Email: {recipient.emailState}</p>
                        <p>Available until: {time(recipient.expiresAt)}</p>
                      </div>
                      {recipient.emailState === "uncertain" ? (
                        <p className="mt-2 max-w-prose text-subhead-regular text-fg-muted">
                          Email acceptance is uncertain. Check the inbox link;
                          an automatic resend is blocked.
                        </p>
                      ) : null}
                      {recipient.safeErrorCode ? (
                        <p className="mt-2 text-caption-1-regular text-fg-muted">
                          Reason: {recipient.safeErrorCode.replaceAll("_", " ")}
                        </p>
                      ) : null}
                      {mine && available ? (
                        <div className="mt-4 flex flex-col gap-3">
                          {recipient.artifacts.map((artifact) => (
                            <div
                              key={artifact.id}
                              className="flex flex-wrap items-center gap-3"
                            >
                              <span className="text-subhead-regular">
                                {artifact.name}
                              </span>
                              <Button
                                type="button"
                                variant="outline"
                                disabled={busyArtifact === artifact.id}
                                onClick={() =>
                                  void prepareDownload(
                                    recipient.id,
                                    artifact.id,
                                  )
                                }
                              >
                                Prepare protected download
                              </Button>
                              {download?.artifactId === artifact.id ? (
                                <a
                                  href={download.url}
                                  className="text-subhead-medium text-active-500 underline underline-offset-4 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
                                >
                                  Open protected download
                                </a>
                              ) : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      {mine &&
                      recipient.generationState === "ready" &&
                      !available ? (
                        <p className="mt-3 text-subhead-regular text-fg-muted">
                          The artifact availability window has expired.
                        </p>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  );
}
