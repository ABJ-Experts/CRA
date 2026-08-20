"use client";

import type { SyncRun } from "../../_features/connectors/connectors.schemas";
import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useState } from "react";

import {
  useCancelSyncRunMutation,
  useConnectorSyncRunsQuery,
  usePlanItemsQuery,
  useRequestCommitMutation,
  useRetrySyncRunMutation,
  useStartSyncRunMutation,
  useSyncRunQuery,
} from "../../_features/connectors/connectors.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

const STATUS_LABELS: Readonly<Record<SyncRun["status"], string>> = {
  queued: "Queued",
  running: "Syncing",
  waiting_for_review: "Waiting for review",
  retrying: "Retrying",
  failed: "Failed",
  canceled: "Canceled",
  completed: "Completed",
};

function statusTone(
  status: SyncRun["status"],
): "green" | "red" | "orange" | "indigo" | "blue" | undefined {
  switch (status) {
    case "completed":
      return "green";
    case "failed":
      return "red";
    case "waiting_for_review":
    case "retrying":
      return "orange";
    case "running":
      return "blue";
    case "queued":
      return "indigo";
    default:
      return undefined;
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This sync run changed in another session. Refresh it before trying again.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network")
    return "We could not reach the connector registry.";
  return fallback;
}

function CountsSummary({ run }: { run: SyncRun }) {
  const counts: readonly [string, number][] = [
    ["create", run.counts.create],
    ["update", run.counts.update],
    ["unchanged", run.counts.unchanged],
    ["skip", run.counts.skip],
    ["conflict", run.counts.conflict],
    ["tombstone", run.counts.tombstone],
    ["cycle blocked", run.counts.cycleBlocked],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-caption-1-regular text-fg sm:grid-cols-4">
      {counts.map(([label, value]) => (
        <div key={label} className="flex items-baseline gap-1">
          <dd className="font-medium tabular-nums">{value}</dd>
          <dt className="text-fg-muted">{label}</dt>
        </div>
      ))}
    </dl>
  );
}

/** Deliverable 4: sync-run screen. Mirrors `product-import-section.tsx`. */
export function ConnectorSyncRunSection({
  connectorId,
  canView,
  canStart,
  canManage,
  canApprove,
  mappingIncomplete,
  onSelectRun,
}: {
  connectorId: string;
  canView: boolean;
  canStart: boolean;
  canManage: boolean;
  canApprove: boolean;
  mappingIncomplete: boolean;
  onSelectRun: (runId: string | null) => void;
}) {
  const [runId, setRunId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState<string | null>(null);
  const history = useConnectorSyncRunsQuery(
    connectorId,
    { page: 1, pageSize: 5 },
    canView,
  );
  const run = useSyncRunQuery(
    connectorId,
    runId ?? "",
    runId !== null && canView,
  );
  const planItems = usePlanItemsQuery(
    connectorId,
    runId ?? "",
    { page, pageSize: 25 },
    runId !== null && canView,
  );
  const start = useStartSyncRunMutation(connectorId);
  const requestCommit = useRequestCommitMutation(connectorId, runId ?? "");
  const cancel = useCancelSyncRunMutation(connectorId, runId ?? "");
  const retry = useRetrySyncRunMutation(connectorId, runId ?? "");
  const current = run.data?.run ?? null;
  const canCancel =
    canManage &&
    current !== null &&
    ["queued", "running", "waiting_for_review", "retrying"].includes(
      current.status,
    );
  const canRetry = canManage && current?.status === "failed";
  const canRequestCommit =
    canApprove &&
    current?.status === "waiting_for_review" &&
    current.counts.conflict === 0;

  function selectRun(id: string) {
    setRunId(id);
    setPage(1);
    onSelectRun(id);
  }

  async function startDryRun(kind: "incremental" | "full") {
    setMessage(null);
    try {
      const response = await start.mutateAsync({
        reconciliationKind: kind,
        idempotencyKey: crypto.randomUUID(),
      });
      selectRun(response.run.id);
    } catch (error) {
      setMessage(errorMessage(error, "The sync run could not be started."));
    }
  }

  async function confirmRequestCommit() {
    if (!current) return;
    setMessage(null);
    try {
      await requestCommit.mutateAsync({
        expectedRowCount: current.rowCount,
      });
      setMessage("Commit requested.");
    } catch (error) {
      setMessage(errorMessage(error, "The commit could not be requested."));
    }
  }

  async function cancelRun() {
    setMessage(null);
    try {
      await cancel.mutateAsync({
        reason: "Canceled from the sync run screen.",
      });
      setMessage("Sync run canceled.");
    } catch (error) {
      setMessage(errorMessage(error, "The sync run could not be canceled."));
    }
  }

  async function retryRun() {
    setMessage(null);
    try {
      await retry.mutateAsync();
      setMessage("Sync run retrying.");
    } catch (error) {
      setMessage(errorMessage(error, "The sync run could not be retried."));
    }
  }

  if (!canView) {
    return (
      <SectionCard title="Sync runs">
        <p role="alert" className="text-subhead-regular text-danger">
          You do not have permission to view sync runs.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Sync runs">
      <div className="flex flex-col gap-5">
        {mappingIncomplete ? (
          <p role="alert" className="text-subhead-regular text-danger">
            Configure every required field authority policy before starting a
            sync.
          </p>
        ) : null}
        {canStart ? (
          <div className="flex flex-wrap gap-3 border-b border-border pb-5">
            <Button
              type="button"
              onClick={() => void startDryRun("incremental")}
              disabled={mappingIncomplete}
              loading={start.isPending}
              loadingLabel="Starting dry run"
            >
              Start dry run (incremental)
            </Button>
            <Button
              type="button"
              variant="outline"
              tone="grey"
              onClick={() => void startDryRun("full")}
              disabled={mappingIncomplete}
              loading={start.isPending}
              loadingLabel="Starting dry run"
            >
              Start dry run (full)
            </Button>
          </div>
        ) : null}
        {message ? (
          <p role="alert" className="text-subhead-regular text-danger">
            {message}
          </p>
        ) : null}
        {current ? (
          <div className="flex flex-col gap-4" aria-live="polite">
            <div className="flex flex-wrap items-center gap-3">
              <Tag
                variant={statusTone(current.status) ? "fill" : "cool"}
                tone={statusTone(current.status)}
                size="sm"
              >
                {STATUS_LABELS[current.status]}
              </Tag>
              <span className="text-caption-1-regular text-fg-muted">
                {current.reconciliationKind === "full" ? "Full" : "Incremental"}{" "}
                reconciliation ·{" "}
                {current.workKind === "commit" ? "Commit" : "Dry run"}
              </span>
            </div>
            <CountsSummary run={current} />
            {current.errorCode ? (
              <p role="alert" className="text-subhead-regular text-danger">
                {current.errorCode}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-3">
              <Button
                type="button"
                onClick={() => void confirmRequestCommit()}
                disabled={!canRequestCommit}
                loading={requestCommit.isPending}
                loadingLabel="Requesting commit"
              >
                Request commit
              </Button>
              {canCancel ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void cancelRun()}
                  loading={cancel.isPending}
                  loadingLabel="Canceling"
                >
                  Cancel
                </Button>
              ) : null}
              {canRetry ? (
                <Button
                  type="button"
                  variant="outline"
                  tone="grey"
                  onClick={() => void retryRun()}
                  loading={retry.isPending}
                  loadingLabel="Retrying"
                >
                  Retry
                </Button>
              ) : null}
            </div>
            <div className="border-t border-border pt-4">
              <h3 className="text-headline-semibold text-fg">Plan items</h3>
              {planItems.isPending ? (
                <p
                  role="status"
                  className="mt-3 text-subhead-regular text-fg-muted"
                >
                  Loading plan items…
                </p>
              ) : planItems.isError ? (
                <p
                  role="alert"
                  className="mt-3 text-subhead-regular text-danger"
                >
                  Plan items could not be loaded.
                </p>
              ) : planItems.data?.planItems.rows.length ? (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left text-caption-1-regular text-fg">
                    <thead className="border-b border-border text-fg-muted">
                      <tr>
                        <th scope="col" className="px-2 py-2 font-medium">
                          External ID
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Action
                        </th>
                        <th scope="col" className="px-2 py-2 font-medium">
                          Issues
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {planItems.data.planItems.rows.map((item) => (
                        <tr
                          key={`${item.entityType}:${item.externalId}`}
                          className="border-b border-border last:border-b-0"
                        >
                          <td className="px-2 py-3">{item.externalId}</td>
                          <td className="px-2 py-3 capitalize">
                            {item.proposedAction.replaceAll("_", " ")}
                          </td>
                          <td className="px-2 py-3">
                            {item.issues.length === 0
                              ? "—"
                              : item.issues
                                  .map(
                                    (issue) =>
                                      `${issue.severity}: ${issue.message}`,
                                  )
                                  .join("; ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {planItems.data.planItems.pageCount > 1 ? (
                    <div className="mt-4 flex items-center justify-between gap-3">
                      <p className="text-caption-1-regular text-fg-muted">
                        Page {planItems.data.planItems.page} of{" "}
                        {planItems.data.planItems.pageCount}
                      </p>
                      <div className="flex gap-3">
                        <Button
                          type="button"
                          variant="outline"
                          tone="grey"
                          disabled={planItems.data.planItems.page <= 1}
                          onClick={() =>
                            setPage((value) => Math.max(1, value - 1))
                          }
                        >
                          Previous page
                        </Button>
                        <Button
                          type="button"
                          variant="outline"
                          tone="grey"
                          disabled={
                            planItems.data.planItems.page >=
                            planItems.data.planItems.pageCount
                          }
                          onClick={() => setPage((value) => value + 1)}
                        >
                          Next page
                        </Button>
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                <p className="mt-3 text-subhead-regular text-fg-muted">
                  No plan items yet.
                </p>
              )}
            </div>
          </div>
        ) : null}
        {history.data?.runs.rows.length ? (
          <div className="border-t border-border pt-4">
            <h3 className="text-headline-semibold text-fg">Recent sync runs</h3>
            <ul
              className="mt-3 divide-y divide-border"
              aria-label="Recent sync runs"
            >
              {history.data.runs.rows.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Tag
                      variant={statusTone(item.status) ? "fill" : "cool"}
                      tone={statusTone(item.status)}
                      size="sm"
                    >
                      {STATUS_LABELS[item.status]}
                    </Tag>
                    <span className="text-caption-1-regular text-fg-muted">
                      {item.reconciliationKind === "full"
                        ? "Full"
                        : "Incremental"}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    tone="grey"
                    onClick={() => selectRun(item.id)}
                  >
                    View
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </SectionCard>
  );
}
