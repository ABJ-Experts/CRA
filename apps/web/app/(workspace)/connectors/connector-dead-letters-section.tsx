"use client";

import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useState } from "react";

import {
  useConnectorDeadLettersQuery,
  useRetrySyncRunMutation,
} from "../../_features/connectors/connectors.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiClientError && error.status === 403)
    return "You do not have permission to perform that action.";
  if (error instanceof ApiClientError && error.kind === "api")
    return error.message;
  if (error instanceof ApiClientError && error.kind === "network")
    return "We could not reach the connector registry.";
  return fallback;
}

function DeadLetterRow({
  connectorId,
  runId,
  errorCode,
  onRetried,
}: {
  connectorId: string;
  runId: string;
  errorCode: string | null;
  onRetried: () => void;
}) {
  const retry = useRetrySyncRunMutation(connectorId, runId);
  const [message, setMessage] = useState<string | null>(null);

  async function retryRun() {
    setMessage(null);
    try {
      await retry.mutateAsync();
      onRetried();
    } catch (error) {
      setMessage(errorMessage(error, "The sync run could not be retried."));
    }
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Tag variant="fill" tone="red" size="sm">
          Failed
        </Tag>
        <span className="text-caption-1-regular text-fg-muted">
          {errorCode ?? "No error code recorded"}
        </span>
        {message ? (
          <span role="alert" className="text-caption-1-regular text-danger">
            {message}
          </span>
        ) : null}
      </div>
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
    </li>
  );
}

/** Deliverable 6: dead-letters screen — failed runs with a retry action. */
export function ConnectorDeadLettersSection({
  connectorId,
  canView,
  canEdit,
}: {
  connectorId: string;
  canView: boolean;
  canEdit: boolean;
}) {
  const deadLetters = useConnectorDeadLettersQuery(
    connectorId,
    { page: 1, pageSize: 25 },
    canView,
  );

  if (!canView) {
    return (
      <SectionCard title="Dead letters">
        <p role="alert" className="text-subhead-regular text-danger">
          You do not have permission to view dead letters.
        </p>
      </SectionCard>
    );
  }

  return (
    <SectionCard title="Dead letters">
      {deadLetters.isPending ? (
        <p role="status" className="text-subhead-regular text-fg-muted">
          Loading dead letters…
        </p>
      ) : deadLetters.isError ? (
        <div role="alert" className="flex flex-wrap items-center gap-3">
          <p className="text-subhead-regular text-danger">
            Dead letters could not be loaded.
          </p>
          <Button
            type="button"
            variant="outline"
            tone="grey"
            onClick={() => void deadLetters.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : deadLetters.data?.runs.rows.length === 0 ? (
        <p className="text-subhead-regular text-fg-muted">
          No failed sync runs.
        </p>
      ) : (
        <ul className="divide-y divide-border" aria-label="Dead letters">
          {deadLetters.data?.runs.rows.map((run) =>
            canEdit ? (
              <DeadLetterRow
                key={run.id}
                connectorId={connectorId}
                runId={run.id}
                errorCode={run.errorCode}
                onRetried={() => void deadLetters.refetch()}
              />
            ) : (
              <li
                key={run.id}
                className="flex flex-wrap items-center gap-3 py-3"
              >
                <Tag variant="fill" tone="red" size="sm">
                  Failed
                </Tag>
                <span className="text-caption-1-regular text-fg-muted">
                  {run.errorCode ?? "No error code recorded"}
                </span>
              </li>
            ),
          )}
        </ul>
      )}
    </SectionCard>
  );
}
