import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import type { BackupsGateway } from "./backups-gateway";

type Run = Awaited<ReturnType<BackupsGateway["history"]>>["items"][number];
type Review = Awaited<ReturnType<BackupsGateway["cleanupReview"]>>;
const cell =
  "border-b border-border px-4 py-3 text-left align-top text-subhead-regular";
function time(value: string | null) {
  return value
    ? new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "Unknown";
}
export function BackupsRuns({
  items,
  busy,
  review,
  onAction,
}: {
  items: readonly Run[];
  busy: boolean;
  review: Review | null;
  onAction: (
    run: Run,
    action: "cancel" | "verify" | "review" | "cleanup",
  ) => void;
}) {
  return (
    <>
      <div
        role="region"
        aria-label="Backup runs table scroll area"
        tabIndex={0}
        className={cn(
          "overflow-x-auto rounded-lg border border-border focus-visible:outline-2 focus-visible:outline-accent",
        )}
      >
        <table className={cn("w-full border-collapse")}>
          <caption
            className={cn(
              "bg-surface px-4 py-3 text-left text-subhead-semibold",
            )}
          >
            Backup and restoration runs
          </caption>
          <thead>
            <tr>
              {[
                "Kind / created",
                "State / progress",
                "Completed / duration",
                "Integrity / safe result",
                "Actions",
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
            {items.length === 0 ? (
              <tr>
                <td colSpan={5} className={cn(cell)}>
                  No backup runs have been recorded. Configure protection and
                  request a capture to begin.
                </td>
              </tr>
            ) : (
              items.map((run) => (
                <tr key={run.id}>
                  <th scope="row" className={cn(cell)}>
                    {run.kind}
                    <br />
                    <time dateTime={run.createdAt}>{time(run.createdAt)}</time>
                  </th>
                  <td className={cn(cell)}>
                    <span>{run.state.replaceAll("_", " ")}</span>
                    <br />
                    <span>
                      {run.stage.replaceAll("_", " ")} · {run.progress}%
                    </span>
                    {run.state === "running" ? (
                      <progress
                        aria-label={`${run.kind} progress`}
                        value={run.progress}
                        max={100}
                        className={cn("mt-2 block w-full accent-accent")}
                      />
                    ) : null}
                  </td>
                  <td className={cn(cell)}>
                    {time(run.completedAt)}
                    <br />
                    {run.durationMs === null
                      ? "Duration unknown"
                      : `${new Intl.NumberFormat().format(run.durationMs / 1000)} seconds`}
                  </td>
                  <td className={cn(cell)}>
                    {run.verification?.integrity ??
                      run.certificate?.integrity ??
                      "Unverified"}
                    {run.failureCode ? (
                      <p>{run.failureCode.replaceAll("_", " ")}</p>
                    ) : null}
                    {run.verification?.checks ? (
                      <ul className={cn("mt-2 space-y-1")}>
                        {run.verification.checks.map((check) => (
                          <li key={check.code}>
                            {check.code.replaceAll("_", " ")}: {check.status}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {run.cleanup.state === "deleted" ? (
                      <p>Retired after reviewed cleanup</p>
                    ) : null}
                  </td>
                  <td className={cn(cell)}>
                    <div className={cn("flex flex-wrap gap-2")}>
                      {["queued", "running"].includes(run.state) ? (
                        <Button
                          variant="outline"
                          tone="grey"
                          disabled={busy}
                          onClick={() => onAction(run, "cancel")}
                        >
                          Cancel {run.kind}
                        </Button>
                      ) : null}
                      {run.kind === "capture" &&
                      run.state === "certified" &&
                      run.cleanup.state !== "deleted" ? (
                        <Button
                          variant="outline"
                          tone="grey"
                          disabled={busy}
                          onClick={() => onAction(run, "verify")}
                        >
                          Verify clean restore
                        </Button>
                      ) : null}
                      {!["queued", "running"].includes(run.state) &&
                      run.cleanup.state !== "deleted" ? (
                        <Button
                          variant="outline"
                          tone="grey"
                          disabled={busy}
                          onClick={() => onAction(run, "review")}
                        >
                          Review {run.kind} cleanup
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {review ? (
        <section
          aria-label="Reviewed backup cleanup"
          className={cn(
            "rounded-lg border border-border p-4 text-subhead-regular",
          )}
        >
          <h3 className={cn("text-subhead-semibold")}>
            {review.eligible
              ? "Cleanup is eligible for explicit approval"
              : "Cleanup remains blocked"}
          </h3>
          <p className={cn("mt-2 text-fg-muted")}>
            Retention, holds and recoverable chain dependencies are checked
            again before cleanup.
          </p>
          <ul className={cn("mt-2 list-disc pl-5")}>
            {review.blockers.map((code) => (
              <li key={code}>{code.replaceAll("_", " ")}</li>
            ))}
          </ul>
          {review.eligible && items.find((run) => run.id === review.runId) ? (
            <Button
              className={cn("mt-3")}
              variant="outline"
              tone="grey"
              disabled={busy}
              onClick={() =>
                onAction(
                  items.find((run) => run.id === review.runId)!,
                  "cleanup",
                )
              }
            >
              Confirm reviewed cleanup
            </Button>
          ) : null}
        </section>
      ) : null}
    </>
  );
}
