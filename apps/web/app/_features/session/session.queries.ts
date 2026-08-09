import { queryOptions } from "@tanstack/react-query";

import { sessionApi } from "./session.api";
import { sessionKeys } from "./session.keys";

export const SESSION_STALE_TIME_MS = 5 * 60_000;

export function sessionIdentityQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: sessionKeys.identity,
    enabled,
    retry: false,
    staleTime: SESSION_STALE_TIME_MS,
    queryFn: ({ signal }) => sessionApi.identity({ signal }),
  });
}

export function sessionPermissionsQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: sessionKeys.permissions,
    enabled,
    retry: false,
    staleTime: SESSION_STALE_TIME_MS,
    queryFn: ({ signal }) => sessionApi.permissions({ signal }),
  });
}

export function sessionMenuQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: sessionKeys.menu,
    enabled,
    retry: false,
    staleTime: SESSION_STALE_TIME_MS,
    queryFn: ({ signal }) => sessionApi.menu({ signal }),
  });
}
