import type {
  CreateOrganizationInput,
  UpdateLegalProfileInput,
} from "@repo/contracts";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { sessionKeys } from "../session/session.keys";
import { organizationsApi } from "./organizations.api";
import { organizationKeys } from "./organizations.keys";

/** Progress is server-authoritative, so avoid showing a stale wizard stage. */
export const ORGANIZATIONS_STALE_TIME_MS = 30_000;

export function organizationCurrentQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.current,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.current(signal),
  });
}

export function organizationOnboardingQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: organizationKeys.onboarding,
    enabled,
    retry: false,
    staleTime: ORGANIZATIONS_STALE_TIME_MS,
    queryFn: ({ signal }) => organizationsApi.onboarding(signal),
  });
}

export function useCurrentOrganizationQuery(enabled: boolean) {
  return useQuery(organizationCurrentQueryOptions(enabled));
}

export function useOnboardingQuery(enabled: boolean) {
  return useQuery(organizationOnboardingQueryOptions(enabled));
}

function useInvalidateOrganizationState() {
  const queryClient = useQueryClient();

  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: sessionKeys.all }),
      queryClient.invalidateQueries({ queryKey: organizationKeys.all }),
    ]);
  };
}

export function useCreateOrganizationMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (input: CreateOrganizationInput) =>
      organizationsApi.create(input),
    onSuccess: invalidateOrganizationState,
  });
}

export function useSwitchOrganizationMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (organizationId: string) =>
      organizationsApi.switch(organizationId),
    onSuccess: invalidateOrganizationState,
  });
}

export function useUpdateLegalProfileMutation() {
  const invalidateOrganizationState = useInvalidateOrganizationState();

  return useMutation({
    mutationFn: (input: UpdateLegalProfileInput) =>
      organizationsApi.updateLegalProfile(input),
    onSuccess: invalidateOrganizationState,
  });
}
