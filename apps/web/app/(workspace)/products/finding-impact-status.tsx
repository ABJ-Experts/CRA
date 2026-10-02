"use client";

import type { FindingImpactSummaryResponse } from "@repo/contracts/findings";
import { Button } from "@repo/ui/button";

import { useFindingImpactSummaryQuery } from "../../_features/findings/finding-impact.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { SectionCard } from "../../dashboard/_components/dashboard-chrome";

type FindingImpactSummary = FindingImpactSummaryResponse["summary"];

function countLabel(count: number, singular: string, plural = `${singular}s`) {
  return `${count} ${count === 1 ? singular : plural}`;
}

function statusMessage(summary: FindingImpactSummary): string | null {
  if (summary.propagationState === "in_progress") {
    return `Finding impact propagation is in progress: ${countLabel(
      summary.queuedJobCount,
      "job",
    )} queued and ${countLabel(summary.inProgressJobCount, "job")} being evaluated.`;
  }
  if (summary.propagationState === "partial_failure") {
    return `Finding impact propagation is partially unavailable. ${countLabel(
      summary.deadLetterJobCount,
      "job",
    )} requires attention before the impact view is complete.`;
  }
  if (summary.propagationState === "stale") {
    return "Finding impact is stale while the product relationship graph is being re-evaluated.";
  }
  return null;
}

function SummaryCounts({ summary }: { summary: FindingImpactSummary }) {
  const hasImpacts =
    summary.activeImpactCount > 0 ||
    summary.supersededImpactCount > 0 ||
    summary.closedImpactCount > 0 ||
    summary.overrideCount > 0;

  if (!hasImpacts) {
    return (
      <p className="text-subhead-regular text-fg-muted">
        No propagated finding impacts are currently associated with this
        product.
      </p>
    );
  }

  return (
    <dl
      aria-label="Finding impact counts"
      className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
    >
      <div className="rounded-xl border border-border bg-surface-subtle p-3">
        <dt className="text-caption-1-regular text-fg-muted">Active</dt>
        <dd className="mt-1 text-subhead-semibold text-fg">
          {countLabel(summary.activeImpactCount, "active impact")}
        </dd>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle p-3">
        <dt className="text-caption-1-regular text-fg-muted">Superseded</dt>
        <dd className="mt-1 text-subhead-semibold text-fg">
          {countLabel(summary.supersededImpactCount, "superseded impact")}
        </dd>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle p-3">
        <dt className="text-caption-1-regular text-fg-muted">Closed</dt>
        <dd className="mt-1 text-subhead-semibold text-fg">
          {countLabel(summary.closedImpactCount, "closed impact")}
        </dd>
      </div>
      <div className="rounded-xl border border-border bg-surface-subtle p-3">
        <dt className="text-caption-1-regular text-fg-muted">Overrides</dt>
        <dd className="mt-1 text-subhead-semibold text-fg">
          {countLabel(summary.overrideCount, "active override")}
        </dd>
      </div>
    </dl>
  );
}

function FailureState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry: () => void;
}) {
  if (error instanceof ApiClientError && error.status === 403) {
    return (
      <p role="alert" className="text-subhead-regular text-danger">
        You do not have permission to view finding impact for this product.
      </p>
    );
  }

  return (
    <div role="alert" className="flex flex-wrap items-center gap-3">
      <p className="text-subhead-regular text-danger">
        Finding impact could not be loaded. Try again.
      </p>
      <Button type="button" variant="outline" tone="grey" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** Product-safe aggregate status; individual findings remain in their own module. */
export function FindingImpactStatus({
  productId,
  enabled,
}: Readonly<{
  productId: string;
  enabled: boolean;
}>) {
  const impact = useFindingImpactSummaryQuery(productId, {}, enabled);

  return (
    <SectionCard title="Finding impact">
      {impact.isPending ? (
        <p role="status" className="text-subhead-regular text-fg-muted">
          Loading finding impact…
        </p>
      ) : impact.isError ? (
        <FailureState
          error={impact.error}
          onRetry={() => void impact.refetch()}
        />
      ) : impact.data ? (
        <div className="flex flex-col gap-4">
          <SummaryCounts summary={impact.data.summary} />
          {statusMessage(impact.data.summary) ? (
            <p
              role={
                impact.data.summary.propagationState === "partial_failure"
                  ? "alert"
                  : "status"
              }
              className={
                impact.data.summary.propagationState === "partial_failure"
                  ? "text-caption-1-regular text-danger"
                  : "text-caption-1-regular text-fg-muted"
              }
            >
              {statusMessage(impact.data.summary)}
            </p>
          ) : null}
        </div>
      ) : (
        <p role="alert" className="text-subhead-regular text-danger">
          Finding impact could not be loaded. Try again.
        </p>
      )}
    </SectionCard>
  );
}
