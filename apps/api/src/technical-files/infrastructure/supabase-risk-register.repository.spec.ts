import { RiskRegisterConflictError } from "../application/risk-register.port";
import { SupabaseRiskRegisterRepository } from "./supabase-risk-register.repository";

describe("SupabaseRiskRegisterRepository", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";
  const riskId = "00000000-0000-4000-8000-000000000004";

  type RpcResult = {
    data: { outcome: string; result: unknown } | null;
    error: null;
  };
  type RpcArgs = [name: string, parameters: Record<string, unknown>];

  it("passes tenant scope and omits transport fields from the durable update payload", async () => {
    const rpc = jest.fn<Promise<RpcResult>, RpcArgs>().mockResolvedValue({
      data: { outcome: "conflict", result: null },
      error: null,
    });
    const repository = new SupabaseRiskRegisterRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.updateRisk(organizationId, riskInput()),
    ).rejects.toBeInstanceOf(RiskRegisterConflictError);
    expect(rpc).toHaveBeenCalledWith(
      "update_technical_file_risk_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_product_id: productId,
        p_risk_id: riskId,
        p_expected_version: 1,
        p_idempotency_key: "risk-update-0001",
      }),
    );
    const payload = rpc.mock.calls[0]?.[1].p_payload;
    expect(payload).toBeDefined();
    expect(typeof payload).toBe("object");
    expect(payload).not.toBeNull();
    if (payload === null || typeof payload !== "object") {
      throw new Error("Expected a durable risk payload.");
    }
    for (const key of [
      "actorId",
      "productId",
      "riskId",
      "expectedVersion",
      "idempotencyKey",
    ]) {
      expect(key in payload).toBe(false);
    }
  });

  it("preserves an intentional missing register", async () => {
    const rpc = jest.fn<Promise<RpcResult>, RpcArgs>().mockResolvedValue({
      data: { outcome: "not_found", result: null },
      error: null,
    });
    const repository = new SupabaseRiskRegisterRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.get(organizationId, { actorId, productId }),
    ).resolves.toBeNull();
  });

  it("keeps the current version from direct archive conflicts", async () => {
    const rpc = jest.fn<Promise<RpcResult>, RpcArgs>().mockResolvedValue({
      data: { outcome: "conflict", result: { currentVersion: 4 } },
      error: null,
    });
    const repository = new SupabaseRiskRegisterRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.archiveRisk(organizationId, {
        actorId,
        productId,
        riskId,
        expectedVersion: 2,
        archiveRationale: "Superseded by a newer assessment.",
        idempotencyKey: "risk-archive-0001",
      }),
    ).rejects.toMatchObject({ currentVersion: 4 });
  });

  function riskInput() {
    return {
      actorId,
      productId,
      riskId,
      expectedVersion: 1,
      idempotencyKey: "risk-update-0001",
      threat: "An attacker can exploit an exposed service.",
      affectedAssets: [{ componentId: "00000000-0000-4000-8000-000000000005" }],
      requirements: [
        {
          identifier: "CRA Annex I Part I 1",
          edition: "2024",
          sourceReference: "Regulation (EU) 2024/2847",
          rationale: "The control reduces exposure.",
        },
      ],
      inherentAssessment: {
        likelihood: 4,
        impact: 4,
        likelihoodRationale: "An exposed service is reachable.",
        impactRationale: "Compromise has broad impact.",
      },
      mitigations: "Restrict access and patch the service.",
      residualAssessment: {
        likelihood: 2,
        impact: 2,
        likelihoodRationale: "Access controls lower opportunity.",
        impactRationale: "Containment limits effect.",
      },
      revisionRationale: "Initial assessment.",
      ownerId: "00000000-0000-4000-8000-000000000006",
      evidenceReferences: [],
    };
  }
});
