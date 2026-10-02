import { failure, success } from "../../common/domain/result";
import { TechnicalFileUseCases } from "./technical-file-use-cases";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";

describe("TechnicalFileUseCases", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";

  it("validates the product through the published retention projection before writing", async () => {
    const repository = repositoryStub({
      create: jest.fn().mockResolvedValue(null),
    });
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(success({ retention: {} })),
    };
    const useCases = new TechnicalFileUseCases(repository, retention);

    await useCases.create(organizationId, {
      actorId,
      productId,
      idempotencyKey: "technical-file-create-0001",
    });

    expect(retention.getProductRetentionCalculation).toHaveBeenCalledWith({
      organizationId,
      actorId,
      productId,
    });
    expect(repository.create).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ actorId, productId }),
    );
  });

  it("does not reach persistence when the product is not available in the active tenant", async () => {
    const repository = repositoryStub({ get: jest.fn() });
    const error = new Error("not found");
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(failure(error)),
    };
    const useCases = new TechnicalFileUseCases(repository, retention);

    await expect(
      useCases.get(organizationId, { actorId, productId }),
    ).rejects.toBeInstanceOf(TechnicalFileProductUnavailableError);
    expect(repository.get).not.toHaveBeenCalled();
  });
});

function repositoryStub(overrides: Record<string, jest.Mock>) {
  return {
    get: jest.fn(),
    create: jest.fn(),
    getSection: jest.fn(),
    updateSection: jest.fn(),
    addSource: jest.fn(),
    removeSource: jest.fn(),
    ...overrides,
  };
}
