import { failure, success } from "../../common/domain/result";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import { RiskRegisterUseCases } from "./risk-register-use-cases";

describe("RiskRegisterUseCases", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";

  it("validates the tenant-scoped product before reading the register", async () => {
    const repository = { get: jest.fn().mockResolvedValue(null) };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(success({ retention: {} })),
    };
    const useCases = new RiskRegisterUseCases(repository as never, retention);

    await useCases.get(organizationId, { actorId, productId });

    expect(repository.get).toHaveBeenCalledWith(organizationId, {
      actorId,
      productId,
    });
  });

  it("does not reach risk persistence when the product is unavailable", async () => {
    const repository = { createRisk: jest.fn() };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(failure(new Error("not found"))),
    };
    const useCases = new RiskRegisterUseCases(repository as never, retention);

    await expect(
      useCases.createRisk(organizationId, riskInput()),
    ).rejects.toBeInstanceOf(TechnicalFileProductUnavailableError);
    expect(repository.createRisk).not.toHaveBeenCalled();
  });

  function riskInput() {
    return {
      actorId,
      productId,
      idempotencyKey: "risk-create-0001",
      threat: "An exposed service can be exploited.",
      affectedAssets: [{ componentId: "00000000-0000-4000-8000-000000000004" }],
      requirements: [
        {
          identifier: "CRA Annex I Part I 1",
          edition: "2024",
          sourceReference: "Regulation (EU) 2024/2847",
          rationale: "The control reduces the exposure.",
        },
      ],
      inherentAssessment: {
        likelihood: 4,
        impact: 4,
        likelihoodRationale: "The service is exposed.",
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
      ownerId: "00000000-0000-4000-8000-000000000005",
      evidenceReferences: [],
    };
  }
});
