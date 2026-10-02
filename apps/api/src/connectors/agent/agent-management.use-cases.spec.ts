import { NotFoundException } from "@nestjs/common";
import type { ConnectorAuthorizationAdapter } from "../infrastructure/connector-authorization.adapter";
import type { SupabaseConnectorHubRepository } from "../infrastructure/supabase-connector-hub.repository";
import type { SupabaseAgentRepository } from "./supabase-agent.repository";
import { AgentManagementUseCases } from "./agent-management.use-cases";

const orgId = "ace5f442-6b7f-4c35-b81d-b65930d9c157";
const connectorId = "1450c6ee-2607-4f66-83d5-e19bd5a159ab";
const agentId = "bb833cdf-4af0-4143-8b09-15eaa720c558";
const actorId = "f2cb5e61-9478-49fb-89de-96b653273425";
const requestId = "9fc15475-7c0e-48ac-98a4-9e7f8eef3622";

function fixture(connectorType = "on_prem_agent") {
  const repository = {
    issueEnrollment: jest.fn().mockResolvedValue({ token: "opaque" }),
    status: jest.fn().mockResolvedValue({
      agent: null,
      batches: { rows: [], nextCursor: null },
    }),
    revoke: jest
      .fn()
      .mockResolvedValue({ agent: { id: agentId, status: "revoked" } }),
  };
  const authorization = {
    authorize: jest.fn().mockResolvedValue({ permissionVersion: 7 }),
  };
  const hub = {
    context: jest.fn().mockResolvedValue({ connector: { connectorType } }),
  };
  const useCases = new AgentManagementUseCases(
    repository as unknown as SupabaseAgentRepository,
    authorization as unknown as ConnectorAuthorizationAdapter,
    hub as unknown as SupabaseConnectorHubRepository,
  );
  return { useCases, repository, authorization, hub };
}

describe("AgentManagementUseCases", () => {
  it("checks current edit permission and connector type before issuing a scoped enrollment", async () => {
    const f = fixture();
    await expect(
      f.useCases.issue(orgId, connectorId, actorId, requestId),
    ).resolves.toEqual({ token: "opaque" });
    expect(f.authorization.authorize).toHaveBeenCalledWith(
      orgId,
      actorId,
      ["can_edit_connectors"],
      true,
    );
    expect(f.hub.context).toHaveBeenCalledWith(orgId, connectorId);
    expect(f.repository.issueEnrollment).toHaveBeenCalledWith(
      orgId,
      connectorId,
      actorId,
      7,
      requestId,
    );
  });

  it("checks view permission and passes the bounded status cursor", async () => {
    const f = fixture();
    await f.useCases.status(orgId, connectorId, actorId, "20");
    expect(f.authorization.authorize).toHaveBeenCalledWith(orgId, actorId, [
      "can_view_connectors",
    ]);
    expect(f.repository.status).toHaveBeenCalledWith(orgId, connectorId, "20");
  });

  it("rechecks edit permission and version for revocation", async () => {
    const f = fixture();
    await f.useCases.revoke(orgId, connectorId, agentId, actorId, requestId);
    expect(f.repository.revoke).toHaveBeenCalledWith(
      orgId,
      connectorId,
      agentId,
      actorId,
      7,
      requestId,
    );
  });

  it("rejects other connector types before touching agent state", async () => {
    const f = fixture("reference_conformance");
    await expect(
      f.useCases.issue(orgId, connectorId, actorId, requestId),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(f.repository.issueEnrollment).not.toHaveBeenCalled();
  });

  it("fails closed when permission resolution rejects", async () => {
    const f = fixture();
    f.authorization.authorize.mockRejectedValue(new Error("revoked"));
    await expect(
      f.useCases.revoke(orgId, connectorId, agentId, actorId, requestId),
    ).rejects.toThrow("revoked");
    expect(f.hub.context).not.toHaveBeenCalled();
    expect(f.repository.revoke).not.toHaveBeenCalled();
  });
});
