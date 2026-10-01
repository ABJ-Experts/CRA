import { NotFoundException } from "@nestjs/common";
import type { ConnectorAuthorizationAdapter } from "../infrastructure/connector-authorization.adapter";
import type { SupabaseConnectorHubRepository } from "../infrastructure/supabase-connector-hub.repository";
import type { SupabaseAgentRepository } from "./supabase-agent.repository";

/** Human intent is checked against live permissions before every service-role operation. */
export class AgentManagementUseCases {
  constructor(
    private readonly repository: SupabaseAgentRepository,
    private readonly authorization: ConnectorAuthorizationAdapter,
    private readonly hub: SupabaseConnectorHubRepository,
  ) {}
  private async assertConnector(
    orgId: string,
    connectorId: string,
  ): Promise<void> {
    const context = await this.hub.context(orgId, connectorId);
    if (context.connector.connectorType !== "on_prem_agent")
      throw new NotFoundException({
        code: "not_found",
        message: "Agent connector was not found.",
      });
  }
  async issue(
    orgId: string,
    connectorId: string,
    actorId: string,
    idempotencyKey: string,
  ) {
    const auth = await this.authorization.authorize(
      orgId,
      actorId,
      ["can_edit_connectors"],
      true,
    );
    await this.assertConnector(orgId, connectorId);
    return this.repository.issueEnrollment(
      orgId,
      connectorId,
      actorId,
      auth.permissionVersion,
      idempotencyKey,
    );
  }
  async status(
    orgId: string,
    connectorId: string,
    actorId: string,
    cursor?: string,
  ) {
    await this.authorization.authorize(orgId, actorId, ["can_view_connectors"]);
    await this.assertConnector(orgId, connectorId);
    return this.repository.status(orgId, connectorId, cursor);
  }
  async revoke(
    orgId: string,
    connectorId: string,
    agentId: string,
    actorId: string,
    idempotencyKey: string,
  ) {
    const auth = await this.authorization.authorize(
      orgId,
      actorId,
      ["can_edit_connectors"],
      true,
    );
    await this.assertConnector(orgId, connectorId);
    return this.repository.revoke(
      orgId,
      connectorId,
      agentId,
      actorId,
      auth.permissionVersion,
      idempotencyKey,
    );
  }
}
