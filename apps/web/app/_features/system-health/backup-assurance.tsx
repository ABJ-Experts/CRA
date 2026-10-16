"use client";
import { useEffect, useState } from "react";
import type { z } from "zod";
import type { backupAssuranceSchema } from "@repo/contracts/backups/schemas";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import {
  backupAssuranceGateway,
  type BackupAssuranceGateway,
} from "./backup-assurance.gateway";

type Assurance = z.output<typeof backupAssuranceSchema>;
type History = Awaited<ReturnType<BackupAssuranceGateway["history"]>>;
const cell =
  "border-b border-border px-4 py-3 text-left align-top text-subhead-regular";
function label(value: string) {
  return value.replaceAll("_", " ");
}
function date(value: string | null) {
  return value ? (
    <time dateTime={value}>
      {new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))}
    </time>
  ) : (
    "Unknown"
  );
}
function duration(value: number | null | undefined) {
  return value == null
    ? "Unknown"
    : `${new Intl.NumberFormat().format(value / 1000)} seconds`;
}
function Metric({
  name,
  children,
}: {
  name: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <dt className={cn("text-subhead-regular text-fg-muted")}>{name}</dt>
      <dd className={cn("mt-1 break-words text-subhead-semibold")}>
        {children}
      </dd>
    </div>
  );
}
type Props = {
  organizationId: string;
  data: Assurance;
  gateway?: Pick<BackupAssuranceGateway, "history">;
};
export function BackupAssurance(props: Props) {
  return <ScopedBackupAssurance key={props.organizationId} {...props} />;
}
function ScopedBackupAssurance({
  organizationId,
  data,
  gateway = backupAssuranceGateway,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<string>();
  const [history, setHistory] = useState<History | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!expanded) return;
    const controller = new AbortController();
    setHistory(null);
    setFailed(false);
    void gateway
      .history(organizationId, { cursor }, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setHistory(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  }, [organizationId, expanded, attempt, cursor, gateway]);
  return (
    <section
      aria-labelledby="backup-health-heading"
      className={cn("rounded-lg border border-border p-5")}
    >
      <h2 id="backup-health-heading" className={cn("text-subhead-semibold")}>
        Backup and restore assurance
      </h2>
      <p className={cn("mt-2 max-w-[72ch] text-subhead-regular text-fg-muted")}>
        An encrypted capture and a verified clean restore provide different
        evidence. A recent capture does not establish recoverability.
        Whole-deployment controls remain with explicitly authorized operators.
      </p>
      <dl className={cn("mt-5 grid gap-5 sm:grid-cols-2 lg:grid-cols-3")}>
        <Metric name="Assurance status">{label(data.status)}</Metric>
        <Metric name="Last backup attempt">
          {date(data.lastAttempt?.createdAt ?? null)}
        </Metric>
        <Metric name="Last successful capture">
          {date(data.lastCapture?.completedAt ?? null)}
        </Metric>
        <Metric name="Capture duration">
          {duration(data.lastCapture?.durationMs)}
        </Metric>
        <Metric name="Capture integrity">
          {data.lastCapture?.integrity ?? "Unknown"}
        </Metric>
        <Metric name="Last verified restore">
          {date(data.lastVerifiedRestoreAt)}
        </Metric>
        <Metric name="Latest restore test result">
          {data.lastVerification
            ? `${label(data.lastVerification.state)} / ${data.lastVerification.integrity}`
            : "Unverified"}
        </Metric>
        <Metric name="Restore duration">
          {duration(data.lastVerification?.durationMs)}
        </Metric>
        <Metric name="Certified recovery point">
          {date(data.recoverablePointAt)}
        </Metric>
        <Metric name="Restore verification due">
          {date(data.verificationDueAt)}
        </Metric>
        <Metric name="Declared residency">{data.residency ?? "Unknown"}</Metric>
        <Metric name="Backup source time">{date(data.sourceAt)}</Metric>
        <Metric name="Backup observed">{date(data.observedAt)}</Metric>
        <Metric name="Assurance reasons">
          {data.reasons.length ? data.reasons.map(label).join("; ") : "None"}
        </Metric>
      </dl>
      <p className={cn("mt-5 max-w-[72ch] text-subhead-regular text-fg-muted")}>
        Recovery targets apply only to measured deployment profiles. Missing,
        stale, failed or overdue verification remains visible independently of
        successful captures.
      </p>
      <Button
        className={cn("mt-4")}
        variant="outline"
        tone="grey"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
      >
        {expanded ? "Hide backup history" : "Show backup history"}
      </Button>
      {expanded ? (
        failed ? (
          <div role="alert" className={cn("mt-4 text-subhead-regular")}>
            <p>
              Backup history access could not be verified. Retry to recheck
              current authorization.
            </p>
            <Button
              className={cn("mt-3")}
              variant="outline"
              tone="grey"
              onClick={() => setAttempt((value) => value + 1)}
            >
              Retry backup history
            </Button>
          </div>
        ) : !history ? (
          <p role="status" className={cn("mt-4 text-subhead-regular")}>
            Loading scoped backup history…
          </p>
        ) : (
          <>
            <div
              role="region"
              aria-label="Backup assurance history scroll area"
              tabIndex={0}
              className={cn(
                "mt-4 overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-accent",
              )}
            >
              <table className={cn("w-full border-collapse")}>
                <caption
                  className={cn(
                    "bg-surface px-4 py-3 text-left text-subhead-semibold",
                  )}
                >
                  Organization backup assurance history
                </caption>
                <thead>
                  <tr>
                    {[
                      "Activity",
                      "State",
                      "Created",
                      "Completed",
                      "Duration",
                      "Integrity / safe result",
                    ].map((title) => (
                      <th
                        scope="col"
                        key={title}
                        className={cn(cell, "bg-surface text-fg-muted")}
                      >
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {history.items.length ? (
                    history.items.map((run) => (
                      <tr key={run.id}>
                        <th scope="row" className={cn(cell)}>
                          {run.kind}
                        </th>
                        <td className={cn(cell)}>{label(run.state)}</td>
                        <td className={cn(cell)}>{date(run.createdAt)}</td>
                        <td className={cn(cell)}>{date(run.completedAt)}</td>
                        <td className={cn(cell)}>{duration(run.durationMs)}</td>
                        <td className={cn(cell)}>
                          {run.integrity}
                          {run.failureCode
                            ? ` / ${label(run.failureCode)}`
                            : ""}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={6} className={cn(cell)}>
                        No backup assurance events are available.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {history.nextCursor ? (
              <Button
                className={cn("mt-3")}
                variant="outline"
                tone="grey"
                onClick={() => setCursor(history.nextCursor ?? undefined)}
              >
                Next assurance page
              </Button>
            ) : null}
            {cursor ? (
              <Button
                className={cn("ml-3 mt-3")}
                variant="outline"
                tone="grey"
                onClick={() => setCursor(undefined)}
              >
                First assurance page
              </Button>
            ) : null}
          </>
        )
      ) : null}
    </section>
  );
}
