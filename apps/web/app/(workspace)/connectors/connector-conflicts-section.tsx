"use client";

import type {
  ConflictResolutionAction,
  SyncConflict,
} from "../../_features/connectors/connectors.schemas";
import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useState } from "react";

import {
  useConnectorSyncRunsQuery,
  useResolveConflictMutation,
  useRunConflictsQuery,
} from "../../_features/connectors/connectors.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

/** Reused verbatim from `support-period-retention-section.tsx`. */
function isConflict(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "conflict";
}

function ReloadButton({ onReload }: Readonly<{ onReload: () => void }>) {
  return (
    <Button type="button" variant="outline" tone="grey" onClick={onReload}>
      Reload current data
    </Button>
  );
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (error instanceof ApiClientError && error.status === 404)
    return "This conflict is unavailable.";
  if (error instanceof ApiClientError && error.status === 409)
    return "This conflict changed in another session. Reload it before trying again.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network")
    return "We could not reach the connector registry.";
  return fallback;
}

const ACTION_LABELS: Readonly<Record<ConflictResolutionAction, string>> = {
  accept_external: "Accept external value",
  keep_cra: "Keep CRA value",
  enter_manual_value: "Enter manual value",
};

function ConflictRow({
  conflict,
  onResolve,
  onReload,
  resolving,
}: {
  conflict: SyncConflict;
  onResolve: (input: {
    chosenAction: ConflictResolutionAction;
    manualValue?: unknown;
    reason: string;
  }) => Promise<void>;
  onReload: () => void;
  resolving: boolean;
}) {
  const [chosenAction, setChosenAction] = useState<ConflictResolutionAction>(
    conflict.permittedActions[0] ?? "keep_cra",
  );
  const [manualValue, setManualValue] = useState("");
  const [reason, setReason] = useState("");
  const [rowMessage, setRowMessage] = useState<string | null>(null);
  const [staleUpdate, setStaleUpdate] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setRowMessage(null);
    setStaleUpdate(false);
    if (!reason.trim()) {
      setRowMessage("A resolution reason is required.");
      return;
    }
    try {
      await onResolve({
        chosenAction,
        manualValue:
          chosenAction === "enter_manual_value" ? manualValue : undefined,
        reason,
      });
    } catch (error) {
      setStaleUpdate(isConflict(error));
      setRowMessage(errorMessage(error, "The conflict could not be resolved."));
    }
  }

  return (
    <li className="rounded-xl bg-surface-subtle p-4">
      <p className="text-subhead-semibold text-fg">{conflict.fieldPath}</p>
      <dl className="mt-2 grid gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-caption-1-regular text-fg-muted">
            CRA value ({conflict.craValueSource})
          </dt>
          <dd className="mt-1 break-words text-caption-1-regular text-fg">
            {JSON.stringify(conflict.craValue)}
          </dd>
        </div>
        <div>
          <dt className="text-caption-1-regular text-fg-muted">
            External value
          </dt>
          <dd className="mt-1 break-words text-caption-1-regular text-fg">
            {JSON.stringify(conflict.externalValue)}
          </dd>
        </div>
      </dl>
      <form
        className="mt-3 grid gap-3 sm:grid-cols-2"
        noValidate
        onSubmit={submit}
      >
        <label
          className="flex flex-col gap-2 text-caption-1-regular text-fg"
          htmlFor={`conflict-action-${conflict.id}`}
        >
          Resolution
          <select
            id={`conflict-action-${conflict.id}`}
            value={chosenAction}
            onChange={(event) =>
              setChosenAction(event.target.value as ConflictResolutionAction)
            }
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          >
            {conflict.permittedActions.map((action) => (
              <option key={action} value={action}>
                {ACTION_LABELS[action]}
              </option>
            ))}
          </select>
        </label>
        {chosenAction === "enter_manual_value" ? (
          <label className="flex flex-col gap-2 text-caption-1-regular text-fg">
            Manual value
            <input
              value={manualValue}
              onChange={(event) => setManualValue(event.target.value)}
              className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
            />
          </label>
        ) : null}
        <label className="flex flex-col gap-2 text-caption-1-regular text-fg sm:col-span-2">
          Reason
          <input
            required
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            className="h-10 rounded-xl border border-border bg-canvas px-3 text-subhead-regular text-fg"
          />
        </label>
        <div className="sm:col-span-2">
          <Button
            type="submit"
            loading={resolving}
            loadingLabel="Resolving conflict"
          >
            Resolve
          </Button>
        </div>
        {rowMessage ? (
          <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
            <p role="alert" className="text-caption-1-regular text-danger">
              {rowMessage}
            </p>
            {staleUpdate ? <ReloadButton onReload={onReload} /> : null}
          </div>
        ) : null}
      </form>
    </li>
  );
}

/**
 * Deliverable 5: open conflicts for a run, or connector-wide (defaults to
 * the connector's most recent run — the fixed contract has no endpoint that
 * lists open conflicts across every run for a connector).
 */
export function ConnectorConflictsSection({
  connectorId,
  runId,
  canView,
  canApprove,
}: {
  connectorId: string;
  runId: string | null;
  canView: boolean;
  canApprove: boolean;
}) {
  const latestRun = useConnectorSyncRunsQuery(
    connectorId,
    { page: 1, pageSize: 1 },
    canView && runId === null,
  );
  const effectiveRunId = runId ?? latestRun.data?.runs.rows[0]?.id ?? "";
  const conflicts = useRunConflictsQuery(
    connectorId,
    effectiveRunId,
    canView && effectiveRunId !== "",
  );
  const resolve = useResolveConflictMutation(connectorId, effectiveRunId);
  const openConflicts =
    conflicts.data?.conflicts.filter(
      (conflict) => conflict.resolutionStatus === "open",
    ) ?? [];

  if (!canView) {
    return (
      <SectionCard title="Conflicts">
        <p role="alert" className="text-subhead-regular text-danger">
          You do not have permission to view sync conflicts.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard
      title="Conflicts"
      action={
        openConflicts.length > 0 ? (
          <Tag variant="fill" tone="red" size="sm">
            {openConflicts.length} open
          </Tag>
        ) : undefined
      }
    >
      {effectiveRunId === "" ? (
        <p className="text-subhead-regular text-fg-muted">
          No sync run has run yet.
        </p>
      ) : conflicts.isPending ? (
        <p role="status" className="text-subhead-regular text-fg-muted">
          Loading conflicts…
        </p>
      ) : conflicts.isError ? (
        <p role="alert" className="text-subhead-regular text-danger">
          Conflicts could not be loaded.
        </p>
      ) : openConflicts.length === 0 ? (
        <p className="text-subhead-regular text-fg-muted">
          No open conflicts for this run.
        </p>
      ) : !canApprove ? (
        <>
          <p role="alert" className="mb-3 text-subhead-regular text-danger">
            You do not have permission to resolve conflicts.
          </p>
          <ul className="grid gap-3" aria-label="Open conflicts">
            {openConflicts.map((conflict) => (
              <li
                key={conflict.id}
                className="rounded-xl bg-surface-subtle p-4"
              >
                <p className="text-subhead-semibold text-fg">
                  {conflict.fieldPath}
                </p>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ul className="grid gap-3" aria-label="Open conflicts">
          {openConflicts.map((conflict) => (
            <ConflictRow
              key={conflict.id}
              conflict={conflict}
              resolving={resolve.isPending}
              onReload={() => void conflicts.refetch()}
              onResolve={async (input) => {
                await resolve.mutateAsync({
                  conflictId: conflict.id,
                  input: {
                    expectedVersion: conflict.version,
                    idempotencyKey: crypto.randomUUID(),
                    ...input,
                  },
                });
              }}
            />
          ))}
        </ul>
      )}
    </SectionCard>
  );
}
