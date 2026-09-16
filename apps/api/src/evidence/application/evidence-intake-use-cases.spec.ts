import { EvidenceIntakeUseCases, type EvidenceRepository, type EvidenceStoragePort } from "./evidence-intake-use-cases";

describe("EvidenceIntakeUseCases", () => {
  const repository: jest.Mocked<Pick<EvidenceRepository, "reserve" | "finalize">> = { reserve: jest.fn(), finalize: jest.fn() };
  const storage: jest.Mocked<Pick<EvidenceStoragePort, "createSignedUpload" | "inspect">> = { createSignedUpload: jest.fn(), inspect: jest.fn() };
  it("never submits uninspectable content as clean", async () => {
    storage.inspect.mockResolvedValue({ outcome: "rejected", code: "unsupported_or_disguised_content" });
    repository.finalize.mockResolvedValue({ outcome: "failed", state: "failed" });
    const useCases = new EvidenceIntakeUseCases(repository as unknown as EvidenceRepository, storage as unknown as EvidenceStoragePort);
    await expect(useCases.complete({ organizationId: "org", actorId: "actor", versionId: "version", objectKey: "key", idempotencyKey: "key" })).resolves.toEqual({ outcome: "failed", state: "failed" });
    expect(repository.finalize).toHaveBeenCalledWith("org", expect.objectContaining({ sha256: null, byteSize: null, mediaType: null, failureCode: "unsupported_or_disguised_content" }));
  });
});
