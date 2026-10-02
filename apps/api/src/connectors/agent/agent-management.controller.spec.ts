import type { RequestUser } from "../../auth/auth.types";
import { AgentRepositoryError } from "./supabase-agent.repository";
import { AgentManagementController } from "./agent-management.controller";
import type { AgentManagementUseCases } from "./agent-management.use-cases";

const orgId = "ace5f442-6b7f-4c35-b81d-b65930d9c157";
const connectorId = "1450c6ee-2607-4f66-83d5-e19bd5a159ab";
const agentId = "bb833cdf-4af0-4143-8b09-15eaa720c558";
const actorId = "f2cb5e61-9478-49fb-89de-96b653273425";
const requestId = "9fc15475-7c0e-48ac-98a4-9e7f8eef3622";

function fixture() {
  const useCases = {
    issue: jest.fn().mockResolvedValue({
      token: "opaque",
      expiresAt: new Date().toISOString(),
    }),
    status: jest.fn().mockResolvedValue({
      agent: null,
      batches: { rows: [], nextCursor: null },
    }),
    revoke: jest
      .fn()
      .mockResolvedValue({ agent: { id: agentId, status: "revoked" } }),
  };
  const controller = new AgentManagementController(
    useCases as unknown as AgentManagementUseCases,
  );
  const user = { id: actorId, organizationId: orgId } as RequestUser;
  return { controller, useCases, user };
}

describe("AgentManagementController", () => {
  it("passes verified tenant and actor scope to each operation", async () => {
    const f = fixture();
    await f.controller.issue(
      { connectorId },
      { idempotencyKey: requestId },
      f.user,
    );
    await f.controller.status({ connectorId }, { cursor: "20" }, f.user);
    await f.controller.revoke(
      { connectorId, agentId },
      { idempotencyKey: requestId },
      f.user,
    );
    expect(f.useCases.issue).toHaveBeenCalledWith(
      orgId,
      connectorId,
      actorId,
      requestId,
    );
    expect(f.useCases.status).toHaveBeenCalledWith(
      orgId,
      connectorId,
      actorId,
      "20",
    );
    expect(f.useCases.revoke).toHaveBeenCalledWith(
      orgId,
      connectorId,
      agentId,
      actorId,
      requestId,
    );
  });

  it("fails closed when the authenticated user has no organization", async () => {
    const f = fixture();
    const user = { id: actorId } as RequestUser;
    await expect(
      f.controller.issue({ connectorId }, { idempotencyKey: requestId }, user),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.controller.status({ connectorId }, {}, user),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      f.controller.revoke(
        { connectorId, agentId },
        { idempotencyKey: requestId },
        user,
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect(f.useCases.issue).not.toHaveBeenCalled();
    expect(f.useCases.status).not.toHaveBeenCalled();
    expect(f.useCases.revoke).not.toHaveBeenCalled();
  });

  it("maps repository conflicts to explicit safe HTTP errors", async () => {
    const f = fixture();
    f.useCases.issue.mockRejectedValue(
      new AgentRepositoryError("replacement_requires_new_connector"),
    );
    f.useCases.status.mockRejectedValue(
      new AgentRepositoryError("invalid_request"),
    );
    f.useCases.revoke.mockRejectedValue(new AgentRepositoryError("revoked"));
    await expect(
      f.controller.issue(
        { connectorId },
        { idempotencyKey: requestId },
        f.user,
      ),
    ).rejects.toMatchObject({ status: 409 });
    await expect(
      f.controller.status({ connectorId }, {}, f.user),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      f.controller.revoke(
        { connectorId, agentId },
        { idempotencyKey: requestId },
        f.user,
      ),
    ).rejects.toMatchObject({ status: 401 });
  });
});
