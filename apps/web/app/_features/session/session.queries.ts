import { queryOptions } from "@tanstack/react-query";

import { ApiClientError } from "../../_lib/http/api-client";
import { sessionApi } from "./session.api";
import { sessionKeys } from "./session.keys";

export const SESSION_STALE_TIME_MS = 5 * 60_000;

/**
 * Session, permission, and menu reads gate every workspace query. With retry
 * disabled, one transient 5xx errors the query and leaves dependent pages
 * stuck on their loading state until a manual reload, which contradicts the
 * fail-open posture: retry provider blips, fail fast only on definite 4xx.
 */
function retryProviderOutage(failureCount: number, error: unknown): boolean {
  if (failureCount >= 3) return false;
  return (
    error instanceof ApiClientError &&
    (error.kind === "network" ||
      (error.status !== undefined && error.status >= 500))
  );
}

export function sessionIdentityQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: sessionKeys.identity,
    enabled,
    retry: retryProviderOutage,
    staleTime: SESSION_STALE_TIME_MS,
    queryFn: ({ signal }) => sessionApi.identity({ signal }),
  });
}

export function sessionPermissionsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: sessionKeys.permissions,
    enabled,
    retry: retryProviderOutage,
    staleTime: SESSION_STALE_TIME_MS,
    queryFn: ({ signal }) => sessionApi.permissions({ signal }),
  });
}

export function sessionMenuQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: sessionKeys.menu,
    enabled,
    retry: retryProviderOutage,
    staleTime: SESSION_STALE_TIME_MS,
    queryFn: ({ signal }) => sessionApi.menu({ signal }),
  });
}
