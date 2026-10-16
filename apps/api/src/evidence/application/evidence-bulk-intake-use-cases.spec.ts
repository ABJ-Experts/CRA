import {
  EvidenceBulkIntakeUseCases,
  type EvidenceBulkIntakeRepository,
} from "./evidence-bulk-intake-use-cases";
import type { EvidenceStoragePort } from "./evidence-intake-use-cases";

describe("EvidenceBulkIntakeUseCases", () => {
  const command = {
    organizationId: "org-1",
    actorId: "actor-1",
    productId: "product-1",
    batchId: "batch-1",
    itemId: "item-1",
    idempotencyKey: "key-1",
  };

  it("delegates an unconfirmed batch to the durable server-side classifier", async () => {
    const repository = fakeRepository();
    repository.createBatch.mockResolvedValue({ outcome: "created" });
    const useCases = new EvidenceBulkIntakeUseCases(repository, fakeStorage());

    const result = await useCases.create({
      organizationId: command.organizationId,
      actorId: command.actorId,
      productId: command.productId,
      idempotencyKey: command.idempotencyKey,
      items: [item({ fileName: "risk-assessment.pdf" })],
    });

    expect(result.outcome).toBe("created");
    expect(repository.createBatch.mock.calls[0]).toEqual([
      command.organizationId,
      expect.objectContaining({
        productId: command.productId,
        items: [expect.objectContaining({ fileName: "risk-assessment.pdf" })],
      }),
    ]);
  });

  it("inspects an object before atomically completing its batch item", async () => {
    const repository = fakeRepository();
    repository.getUploadItem.mockResolvedValue({
      objectKey: "org-1/bulk/batch-1/item-1/object",
      versionId: "version-1",
      declaredByteSize: 12,
    });
    const storage = fakeStorage();
    storage.inspect.mockResolvedValue({
      outcome: "verified",
      sha256: "a".repeat(64),
      byteSize: 12,
      mediaType: "application/pdf",
    });
    repository.completeItem.mockResolvedValue({ outcome: "scan_pending" });

    const result = await new EvidenceBulkIntakeUseCases(
      repository,
      storage,
    ).complete(command);

    expect(result.outcome).toBe("scan_pending");
    expect(repository.completeItem.mock.calls[0]).toEqual([
      command.organizationId,
      expect.objectContaining({
        versionId: "version-1",
        sha256: "a".repeat(64),
        byteSize: 12,
        mediaType: "application/pdf",
      }),
    ]);
  });

  it("does not inspect storage when the batch item is inaccessible", async () => {
    const repository = fakeRepository();
    repository.getUploadItem.mockResolvedValue(null);
    const storage = fakeStorage();

    const result = await new EvidenceBulkIntakeUseCases(
      repository,
      storage,
    ).complete(command);

    expect(result).toEqual({ outcome: "not_found" });
    expect(storage.inspect.mock.calls).toHaveLength(0);
  });

  it("records an inspection failure on the item without treating the batch as a failure", async () => {
    const repository = fakeRepository();
    repository.getUploadItem.mockResolvedValue({
      objectKey:
        "org-1/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
      versionId: "version-1",
      declaredByteSize: 12,
    });
    repository.completeItem.mockResolvedValue({ outcome: "failed" });
    const storage = fakeStorage();
    storage.inspect.mockResolvedValue({
      outcome: "rejected",
      code: "invalid_content",
    });

    const result = await new EvidenceBulkIntakeUseCases(
      repository,
      storage,
    ).complete(command);

    expect(result.outcome).toBe("failed");
    expect(repository.completeItem.mock.calls[0]).toEqual([
      command.organizationId,
      expect.objectContaining({
        sha256: null,
        byteSize: null,
        mediaType: null,
        failureCode: "invalid_content",
      }),
    ]);
  });

  it("retries through a new opaque object reservation with fresh classification", async () => {
    const repository = fakeRepository();
    repository.retryItem.mockResolvedValue({
      outcome: "reserved",
      value: {
        objectKey:
          "org-1/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333",
        declaredByteSize: 12,
      },
    });
    const storage = fakeStorage();
    storage.createSignedUpload.mockResolvedValue({
      uploadUrl: "http://localhost:54321/storage/v1/object/upload/sign/test",
      expiresAt: "2026-01-01T00:00:00.000Z",
    });

    const result = await new EvidenceBulkIntakeUseCases(
      repository,
      storage,
    ).retry({
      ...command,
      documentClass: "policy",
      classificationDecision: "corrected",
      fileName: "corrected-policy.pdf",
      byteSize: 12,
    });

    expect(result.outcome).toBe("reserved");
    const retryCall = repository.retryItem.mock.calls[0];
    expect(retryCall?.[0]).toBe(command.organizationId);
    expect(retryCall?.[1]).toEqual(
      expect.objectContaining({
        documentClass: "policy",
        classificationDecision: "corrected",
      }),
    );
    expect(retryCall?.[1].objectKey).toMatch(
      /^org-1\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i,
    );
  });
});

function item(
  overrides: Partial<
    Parameters<EvidenceBulkIntakeRepository["createBatch"]>[1]["items"][number]
  > = {},
) {
  return {
    clientItemId: "11111111-1111-4111-8111-111111111111",
    fileName: "risk-assessment.pdf",
    byteSize: 12,
    title: "Risk assessment",
    ownerUserId: "22222222-2222-4222-8222-222222222222",
    productIds: ["33333333-3333-4333-8333-333333333333"],
    validFrom: null,
    validUntil: null,
    idempotencyKey: "item-key",
    ...overrides,
  };
}

function fakeRepository() {
  return {
    createBatch: jest.fn(),
    batch: jest.fn(),
    initializeItem: jest.fn(),
    getUploadItem: jest.fn(),
    completeItem: jest.fn(),
    retryItem: jest.fn(),
    cancelItem: jest.fn(),
  } as jest.Mocked<EvidenceBulkIntakeRepository>;
}

function fakeStorage() {
  return {
    createSignedUpload: jest.fn(),
    inspect: jest.fn(),
  } as jest.Mocked<EvidenceStoragePort>;
}
