"use client";

import type {
  IssueAgentEnrollmentInput,
  RevokeAgentInput,
} from "@repo/contracts/connectors/types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useSession } from "../../_providers/session-provider";
import { agentsApi } from "./agents.api";
import { useConnectorKeys, useConnectorMutation } from "./connectors.queries";

function useAgentStatusKey(connectorId: string) {
  const keys = useConnectorKeys();
  return [...keys.detail(connectorId), "agent-status"] as const;
}

export function useAgentStatusQuery(
  connectorId: string,
  cursor: string | null = null,
  enabled = true,
) {
  const key = useAgentStatusKey(connectorId);
  return useQuery({
    queryKey: [...key, cursor ?? "latest"],
    queryFn: ({ signal }) =>
      agentsApi.status(connectorId, cursor ?? undefined, signal),
    enabled: enabled && connectorId !== "",
    retry: false,
    refetchInterval: 15_000,
  });
}

/** One-time enrollment token never enters React Query's mutation cache. */
export function useIssueAgentEnrollment(connectorId: string) {
  const key = useAgentStatusKey(connectorId);
  const client = useQueryClient();
  const { session } = useSession();
  const orgId = session?.organization?.id;
  const activeOrg = useRef(orgId);
  activeOrg.current = orgId;
  const [isPending, setPending] = useState(false);

  return {
    isPending,
    async mutateAsync(input: IssueAgentEnrollmentInput) {
      if (!orgId || activeOrg.current !== orgId)
        throw new Error(
          "Organization changed. Reopen this connector before enrolling an agent.",
        );
      setPending(true);
      try {
        const result = await agentsApi.issueEnrollment(connectorId, input);
        if (activeOrg.current !== orgId)
          throw new Error(
            "Organization changed during enrollment. Discard the returned token.",
          );
        await client.invalidateQueries({ queryKey: key });
        return result;
      } finally {
        setPending(false);
      }
    },
  };
}

export function useRevokeAgent(connectorId: string) {
  const key = useAgentStatusKey(connectorId);
  const client = useQueryClient();
  return useConnectorMutation({
    mutationFn: ({
      agentId,
      input,
    }: {
      agentId: string;
      input: RevokeAgentInput;
    }) => agentsApi.revoke(connectorId, agentId, input),
    onSuccess: () => client.invalidateQueries({ queryKey: key }),
  });
}
