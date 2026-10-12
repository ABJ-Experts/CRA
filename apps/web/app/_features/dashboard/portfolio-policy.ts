import { ApiClientError } from "../../_lib/http/api-client";
import { retainsDashboardEvidence } from "./dashboard-clock";

export function portfolioScope(
  organizationId: string | undefined,
  actorId: string | undefined,
  revision: number,
  permissions: Readonly<Record<string, boolean>>,
): string {
  return JSON.stringify([
    organizationId,
    actorId,
    revision,
    Object.entries(permissions).sort(),
  ]);
}

/** Only a transient same-scope outage may retain previously authorized evidence. */
export function portfolioEvidence<T extends { organizationId: string }>(
  data: T | undefined,
  organizationId: string | undefined,
  enabled: boolean,
  error: unknown,
): T | undefined {
  return enabled &&
    data?.organizationId === organizationId &&
    (!error || retainsDashboardEvidence(error))
    ? data
    : undefined;
}

export function portfolioError(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.status === 401 || error.status === 403)
      return "Portfolio access is unavailable. Refresh your session to continue.";
    if (error.status === 409)
      return "Portfolio evidence changed during navigation. Refresh to restart this view.";
    if (error.status === 400)
      return "This portfolio reference is invalid or expired. Refresh the portfolio to continue.";
  }
  return "Portfolio evidence is unavailable. Retry with your current filters.";
}
