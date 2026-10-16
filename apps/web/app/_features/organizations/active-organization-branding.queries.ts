import { queryOptions, useQuery } from "@tanstack/react-query";

import { ORGANIZATIONS_STALE_TIME_MS } from "./organizations.queries";
import { organizationsApi } from "./organizations.api";
import { organizationKeys } from "./organizations.keys";

export function activeOrganizationBrandingQueryOptions(
  organizationId: string | null,
  enabled: boolean,
) {
  return queryOptions({
    queryKey: [...organizationKeys.branding, organizationId ?? "none"],
    enabled: enabled && organizationId !== null,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.branding(signal),
  });
}

export function useActiveOrganizationBrandingQuery(
  organizationId: string | null,
  enabled: boolean,
) {
  return useQuery(
    activeOrganizationBrandingQueryOptions(organizationId, enabled),
  );
}
