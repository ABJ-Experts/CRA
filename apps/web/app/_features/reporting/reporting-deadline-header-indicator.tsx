"use client";

import { cn } from "@repo/ui/cn";
import Link from "next/link";

import {
  useHasPermission,
  useSession,
} from "../../_providers/session-provider";
import { useReportingDeadlineSummaryQuery } from "./reporting.queries";

function compactCountdown(dueAt: string, serverNow: string): string {
  const seconds = Math.ceil(
    (new Date(dueAt).getTime() - new Date(serverNow).getTime()) / 1_000,
  );
  if (seconds <= 0) return "Deadline reached";
  const hours = Math.floor(seconds / 3_600);
  const minutes = Math.floor((seconds % 3_600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m left` : `${minutes}m left`;
}

/** A permission-gated display projection; reporting data remains API-authorized. */
export function ReportingDeadlineHeaderIndicator() {
  const { isLoading } = useSession();
  const canView = useHasPermission("can_view_findings");
  const query = useReportingDeadlineSummaryQuery(canView && !isLoading);

  if (isLoading || !canView) return null;
  if (query.isError) {
    return (
      <Link
        href="/reporting"
        className={cn(
          "rounded-lg border border-border px-3 py-2",
          "text-caption-1-regular text-fg-muted",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        )}
      >
        Reporting timers unavailable
      </Link>
    );
  }
  const summary = query.data?.summary;
  if (summary === undefined || summary.nextDeadline === null) return null;
  const urgency = summary.overdueCount > 0 ? "text-danger" : "text-fg";
  return (
    <Link
      href={summary.nextDeadline.reportingHref}
      aria-live="polite"
      className={cn(
        "flex min-w-0 items-center gap-2 rounded-lg border border-border px-3 py-2",
        "text-caption-1-regular focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
        urgency,
      )}
    >
      <span className="text-fg-muted">Reporting deadline</span>
      <span className="whitespace-nowrap">
        {summary.overdueCount > 0
          ? `${summary.overdueCount} overdue`
          : compactCountdown(summary.nextDeadline.dueAt, summary.serverNow)}
      </span>
    </Link>
  );
}
