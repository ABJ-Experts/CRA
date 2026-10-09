import { failure, success } from "../../common/domain/result";
import { TechnicalFileProductUnavailableError } from "./technical-file.port";
import { TechnicalFileSnapshotUseCases } from "./technical-file-snapshot-use-cases";

describe("TechnicalFileSnapshotUseCases", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const actorId = "00000000-0000-4000-8000-000000000002";
  const productId = "00000000-0000-4000-8000-000000000003";

  it("validates the tenant-scoped product before creating an immutable snapshot", async () => {
    const repository = { create: jest.fn().mockResolvedValue(null) };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(success({ retention: {} })),
    };
    const useCases = new TechnicalFileSnapshotUseCases(
      repository as never,
      retention,
    );
    const input = {
      actorId,
      productId,
      expectedTechnicalFileVersion: 1,
      purpose: "audit" as const,
      auditRationale: "An audit point-in-time record is required.",
      idempotencyKey: "snapshot-create-1",
    };

    await useCases.create(organizationId, input);

    expect(repository.create).toHaveBeenCalledWith(organizationId, input);
  });

  it("does not expose a downloadable artifact for an unavailable product", async () => {
    const repository = { getDownload: jest.fn() };
    const retention = {
      getProductRetentionCalculation: jest
        .fn()
        .mockResolvedValue(failure(new Error("not found"))),
    };
    const useCases = new TechnicalFileSnapshotUseCases(
      repository as never,
      retention,
    );

    await expect(
      useCases.download(organizationId, {
        actorId,
        productId,
        snapshotId: "00000000-0000-4000-8000-000000000004",
        exportId: "00000000-0000-4000-8000-000000000005",
        artifact: "pdf",
      }),
    ).rejects.toBeInstanceOf(TechnicalFileProductUnavailableError);
    expect(repository.getDownload).not.toHaveBeenCalled();
  });
});
