import { failure, success } from "../../common/domain/result";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import { TechnicalFileReadinessUseCases } from "./technical-file-readiness-use-cases";

describe("TechnicalFileReadinessUseCases", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";

  it("validates the tenant-scoped product before recalculation", async () => {
    const repository = { recalculate: jest.fn().mockResolvedValue(null) };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(success({ retention: {} })),
    };
    const useCases = new TechnicalFileReadinessUseCases(
      repository as never,
      retention,
    );
    const input = { actorId, productId, idempotencyKey: "readiness-recalc-1" };

    await useCases.recalculate(organizationId, input);

    expect(repository.recalculate).toHaveBeenCalledWith(organizationId, input);
  });

  it("does not signal a source change for an unavailable product", async () => {
    const repository = { signalMaterialChange: jest.fn() };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(failure(new Error("not found"))),
    };
    const useCases = new TechnicalFileReadinessUseCases(
      repository as never,
      retention,
    );

    await expect(
      useCases.signalMaterialChange(organizationId, {
        actorId,
        productId,
        sectionKey: "standards_common_specifications",
        sourceId: "00000000-0000-4000-8000-000000000004",
        expectedVersion: 1,
        reason: "standard_edition_changed",
        currentObservedRevision: "2025",
        currentFingerprint: "edition-2025",
        idempotencyKey: "source-change-1",
      }),
    ).rejects.toBeInstanceOf(TechnicalFileProductUnavailableError);
    expect(repository.signalMaterialChange).not.toHaveBeenCalled();
  });
});
