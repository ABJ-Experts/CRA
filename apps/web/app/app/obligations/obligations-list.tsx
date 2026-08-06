"use client";

import { Button } from "@repo/ui/button";
import { Tag } from "@repo/ui/tag";
import { useState } from "react";
import { browserApi } from "../_lib/browser-api";
import type { ObligationRow, ObligationStageRow } from "../_lib/api";

export function ObligationsList({ obligations }: { obligations: ObligationRow[] }) {
  return (
    <div className="space-y-4">
      {obligations.length === 0 ? (
        <p className="text-fg-muted">No active or historical reporting obligations.</p>
      ) : (
        obligations.map((obligation) => (
          <ObligationCard key={obligation.id} obligation={obligation} />
        ))
      )}
    </div>
  );
}

function ObligationCard({ obligation }: { obligation: ObligationRow }) {
  const [stages, setStages] = useState<ObligationStageRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function showTimeline() {
    if (stages) {
      setStages(null);
      return;
    }
    setLoading(true);
    setError(null);
    const response = await browserApi<ObligationStageRow[]>(`/obligations/${obligation.id}/stages`);
    if (response.data) setStages(response.data);
    else setError(response.error ?? "Could not load the obligation timeline.");
    setLoading(false);
  }

  return (
    <article className="rounded-xl border border-border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-medium">{obligation.obligationType.replaceAll("_", " ")}</h2>
          <p className="mt-1 text-sm text-fg-muted">
            Awareness: {new Date(obligation.awarenessAt).toLocaleString()}
          </p>
        </div>
        <Tag tone={obligation.overdue ? "red" : undefined}>
          {obligation.overdue ? "Overdue" : obligation.state}
        </Tag>
      </div>
      <div className="mt-4 rounded-md bg-surface-subtle p-3 text-sm">
        <p className="font-medium">
          {obligation.nextStage
            ? `Next: ${obligation.nextStage.replaceAll("_", " ")}`
            : "Waiting for an anchor"}
        </p>
        <p className="mt-1 text-fg-muted">
          {obligation.nextDueAt
            ? `Due ${new Date(obligation.nextDueAt).toLocaleString()}`
            : "No deadline has been calculated yet."}
        </p>
      </div>
      <Button
        className="mt-4"
        size="sm"
        variant="outline"
        disabled={loading}
        onClick={() => void showTimeline()}
      >
        {loading ? "Loading…" : stages ? "Hide timeline" : "Show timeline"}
      </Button>
      {error ? (
        <p role="alert" className="mt-2 text-sm text-danger-fg">
          {error}
        </p>
      ) : null}
      {stages ? (
        <ol className="mt-4 space-y-2 border-l border-border pl-4">
          {stages.map((stage) => (
            <li key={stage.stage} className="text-sm">
              <span className="font-medium">{stage.stage.replaceAll("_", " ")}</span>
              <span className="text-fg-muted">
                {" "}
                · {stage.state.replaceAll("_", " ")} ·{" "}
                {stage.dueAt
                  ? new Date(stage.dueAt).toLocaleString()
                  : `awaiting ${stage.anchorEvent.replaceAll("_", " ")}`}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </article>
  );
}
