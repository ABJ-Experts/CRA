import type { DashboardTrendsQuery } from "@repo/contracts/dashboard/types";

export function defaultTrendFilters(now = new Date()): DashboardTrendsQuery {
  const start = new Date(now);
  start.setUTCDate(start.getUTCDate() - 29);
  return {
    from: start.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    timezone: "UTC",
    bucket: "day",
  };
}
export function trendValue(value: number | null): string {
  return value === null
    ? "Unavailable"
    : new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(
        value,
      );
}
export function trendDate(value: string, timezone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

/** Provider reason codes are policy identifiers, never display copy. */
export function trendReason(reason: string | null): string | null {
  if (reason === null) return null;
  const descriptions: Readonly<Record<string, string>> = {
    select_product:
      "Select a product to view its duration and readiness history.",
    history_unavailable:
      "Historical capture has not started for this source. Earlier observations are unavailable.",
    source_permission_required:
      "You do not have access to the source records for this metric.",
    snapshot_source_permission_required:
      "Some historical snapshot sources are restricted for your account.",
  };
  return Object.hasOwn(descriptions, reason)
    ? descriptions[reason]!
    : "Historical observations unavailable.";
}
