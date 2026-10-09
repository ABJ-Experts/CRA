import {
  agentIdentityParamsSchema,
  agentParamsSchema,
  agentStatusQuerySchema,
  agentStatusResponseSchema,
  issueAgentEnrollmentInputSchema,
  issueAgentEnrollmentResponseSchema,
  revokeAgentInputSchema,
  revokeAgentResponseSchema,
} from "@repo/contracts/connectors/schemas";
import type {
  IssueAgentEnrollmentInput,
  RevokeAgentInput,
} from "@repo/contracts/connectors/types";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { apiClient } from "../../_lib/http/api-client";

function agentsPath(connectorId: string): `/${string}` {
  const parsed = apiClient.parseInput(agentParamsSchema, { connectorId });
  return `/api/v1/connectors/${parsed.connectorId}/agents`;
}

function agentPath(connectorId: string, agentId: string): `/${string}` {
  const parsed = apiClient.parseInput(agentIdentityParamsSchema, {
    connectorId,
    agentId,
  });
  return `/api/v1/connectors/${parsed.connectorId}/agents/${parsed.agentId}`;
}

/** Human-side gateway. Enrollment tokens are returned only to the caller. */
export class AgentsApi {
  status(connectorId: string, cursor?: string, signal?: AbortSignal) {
    const query = apiClient.parseInput(
      agentStatusQuerySchema,
      cursor ? { cursor } : {},
    );
    return authenticatedRequestJson({
      path: query.cursor
        ? `${agentsPath(connectorId)}?${new URLSearchParams({ cursor: query.cursor })}`
        : agentsPath(connectorId),
      schema: agentStatusResponseSchema,
      signal,
    });
  }

  issueEnrollment(connectorId: string, input: IssueAgentEnrollmentInput) {
    return authenticatedRequestJson({
      path: `${agentsPath(connectorId)}/enrollments`,
      method: "POST",
      body: input,
      inputSchema: issueAgentEnrollmentInputSchema,
      schema: issueAgentEnrollmentResponseSchema,
    });
  }

  revoke(connectorId: string, agentId: string, input: RevokeAgentInput) {
    return authenticatedRequestJson({
      path: `${agentPath(connectorId, agentId)}/revoke`,
      method: "POST",
      body: input,
      inputSchema: revokeAgentInputSchema,
      schema: revokeAgentResponseSchema,
    });
  }
}

export const agentsApi = Object.freeze(new AgentsApi());
