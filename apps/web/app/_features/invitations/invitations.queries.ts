import type { CreateInvitationInput } from "@repo/contracts/invitations/types";
import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { invitationsApi } from "./invitations.api";
import { invitationKeys } from "./invitations.keys";

export function invitationListQueryOptions(enabled: boolean) {
  return queryOptions({
    queryKey: invitationKeys.list,
    enabled,
    retry: false,
    queryFn: ({ signal }) => invitationsApi.list(signal),
  });
}

export function useInvitationListQuery(enabled: boolean) {
  return useQuery(invitationListQueryOptions(enabled));
}

function useInvalidateInvitations() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: invitationKeys.all });
}

export function useCreateInvitationMutation() {
  const invalidate = useInvalidateInvitations();
  return useMutation({
    mutationFn: (input: CreateInvitationInput) => invitationsApi.create(input),
    onSuccess: invalidate,
  });
}

export function useResendInvitationMutation() {
  const invalidate = useInvalidateInvitations();
  return useMutation({
    mutationFn: (invitationId: string) => invitationsApi.resend(invitationId),
    onSuccess: invalidate,
  });
}

export function useRevokeInvitationMutation() {
  const invalidate = useInvalidateInvitations();
  return useMutation({
    mutationFn: (invitationId: string) => invitationsApi.revoke(invitationId),
    onSuccess: invalidate,
  });
}
