import type { QueryClient } from "@tanstack/react-query";
import { ApiClientError } from "../../_lib/http/api-client";
import { sessionKeys } from "../session/session.keys";

export function isDashboardAuthorizationFailure(error: unknown): boolean {
  return (
    error instanceof ApiClientError &&
    (error.status === 401 || error.status === 403)
  );
}

/** A definite denial on any page revokes the whole browser projection immediately. */
export function revokeDashboardScope(client: QueryClient, scope: string): void {
  client.setQueryData(["dashboard-access", scope], true);
  void client.cancelQueries({ queryKey: ["dashboard", scope] });
  client.removeQueries({ queryKey: ["dashboard", scope] });
  void client.invalidateQueries({ queryKey: sessionKeys.all });
}
