import { ApiClientError } from "../../_lib/http/api-client";

export function dashboardNow(
  serverNow: string,
  receivedAt: number,
  monotonicNow: number,
): number {
  return Date.parse(serverNow) + Math.max(0, monotonicNow - receivedAt);
}

export function countdownLabel(
  dueAt: string | null,
  state: string,
  now: number,
): string {
  if (state === "cancelled") return "Cancelled";
  if (state === "submitted") return "Submitted";
  if (state === "not_required") return "Not required";
  if (dueAt === null || state === "pending_anchor") return "Awaiting trigger";
  const remaining = Date.parse(dueAt) - now;
  const seconds = Math.floor(Math.abs(remaining) / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m ${seconds % 60}s ${remaining > 0 ? "remaining" : "elapsed"}`;
}

export function retainsDashboardEvidence(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      (error.status !== undefined && error.status >= 500))
  );
}
