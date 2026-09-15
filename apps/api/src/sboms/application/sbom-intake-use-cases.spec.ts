import { SbomIntakeUseCases } from "./sbom-intake-use-cases";

const organizationId = "11111111-1111-4111-8111-111111111111";
const releaseId = "22222222-2222-4222-8222-222222222222";
const actorId = "33333333-3333-4333-8333-333333333333";
const sourceId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const hash = "a".repeat(64);

describe("SbomIntakeUseCases", () => {
  const repository = {
    reserve: jest.fn(),
    complete: jest.fn(),
    rejectIntegrity: jest.fn(),
    getJob: jest.fn(),
    getSource: jest.fn(),
    getSourceForCompletion: jest.fn(),
    getDownloadSource: jest.fn(),
    replay: jest.fn(),
    listSourcesForRelease: jest.fn(),
    getValidationReport: jest.fn(),
  };
  const storage = {
    createSignedUpload: jest.fn(),
    inspect: jest.fn(),
    createSignedDownload: jest.fn(),
  };

  beforeEach(() => {
    jest.resetAllMocks();
    repository.rejectIntegrity.mockResolvedValue({ outcome: "rejected" });
  });

  it("returns the existing reservation on an idempotent replay without another side effect", async () => {
    repository.reserve.mockResolvedValue({
      outcome: "replayed",
      reservation: reservation(),
    });
    storage.createSignedUpload.mockResolvedValue(signedUpload());

    const result = await subject().initialize(command());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.replayed).toBe(true);
    expect(repository.reserve).toHaveBeenCalledWith(
      organizationId,
      expect.any(Object),
    );
    expect(storage.createSignedUpload).toHaveBeenCalledTimes(1);
  });

  it("authorizes completion before inspecting storage and durably rejects a hash mismatch", async () => {
    repository.getSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation(),
    });
    storage.inspect.mockResolvedValue({
      outcome: "hash_mismatch",
      sha256: "b".repeat(64),
      byteSize: 12,
      contentType: "application/json",
    });

    const result = await subject().complete({
      organizationId,
      actorId,
      sourceId,
      idempotencyKey: "complete-key",
      correlationId: "66666666-6666-4666-8666-666666666666",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "content_hash_mismatch" },
    });
    expect(repository.rejectIntegrity).toHaveBeenCalledWith(organizationId, {
      sourceId,
      actorId,
      idempotencyKey: "complete-key",
      code: "content_hash_mismatch",
      actualHash: "b".repeat(64),
      actualByteSize: 12,
      actualMediaType: "application/json",
      correlationId: "66666666-6666-4666-8666-666666666666",
    });
    expect(repository.complete).not.toHaveBeenCalled();
    expect(storage.inspect).toHaveBeenCalledTimes(1);
  });

  it("does not inspect storage when completion authorization or idempotency fails", async () => {
    repository.getSourceForCompletion.mockResolvedValue({
      outcome: "not_found",
    });

    const result = await subject().complete({
      organizationId,
      actorId,
      sourceId,
      idempotencyKey: "complete-key",
      correlationId: "66666666-6666-4666-8666-666666666666",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "not_found" },
    });
    expect(storage.inspect).not.toHaveBeenCalled();
  });

  it("durably rejects a byte-size or media-type mismatch", async () => {
    repository.getSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation(),
    });
    storage.inspect.mockResolvedValue({
      outcome: "type_mismatch",
      sha256: hash,
      byteSize: 12,
      contentType: "application/xml",
    });

    const result = await subject().complete({
      organizationId,
      actorId,
      sourceId,
      idempotencyKey: "complete-key",
      correlationId: "66666666-6666-4666-8666-666666666666",
    });

    expect(result).toEqual({
      ok: false,
      error: { code: "content_hash_mismatch" },
    });
    expect(repository.rejectIntegrity).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        actualHash: hash,
        actualByteSize: 12,
        actualMediaType: "application/xml",
      }),
    );
  });

  it("creates the persisted job only after exact object verification", async () => {
    repository.getSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation(),
    });
    storage.inspect.mockResolvedValue({
      outcome: "verified",
      sha256: hash,
      byteSize: 12,
      contentType: "application/json",
    });
    repository.complete.mockResolvedValue({ outcome: "queued", job: job() });

    const result = await subject().complete({
      organizationId,
      actorId,
      sourceId,
      idempotencyKey: "complete-key",
      correlationId: "66666666-6666-4666-8666-666666666666",
    });

    expect(result).toEqual({
      ok: true,
      value: { job: job(), outcome: "queued" },
    });
    expect(repository.complete).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        sourceId,
        actorId,
        actualHash: hash,
        actualByteSize: 12,
      }),
    );
  });

  it("returns the canonical job for a byte-exact deduplicated source without queueing another job", async () => {
    repository.getSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation(),
    });
    storage.inspect.mockResolvedValue({
      outcome: "verified",
      sha256: hash,
      byteSize: 12,
      contentType: "application/json",
    });
    repository.complete.mockResolvedValue({
      outcome: "deduplicated",
      job: job(),
    });

    await expect(
      subject().complete({
        organizationId,
        actorId,
        sourceId,
        idempotencyKey: "complete-key",
        correlationId: "66666666-6666-4666-8666-666666666666",
      }),
    ).resolves.toEqual({
      ok: true,
      value: { job: job(), outcome: "deduplicated" },
    });
    expect(repository.complete).toHaveBeenCalledTimes(1);
  });

  function subject() {
    return new SbomIntakeUseCases(repository, storage);
  }
});

function command() {
  return {
    organizationId,
    actorId,
    productId: "77777777-7777-4777-8777-777777777777",
    releaseId,
    filename: "release.sbom.json",
    byteSize: 12,
    mediaType: "application/json",
    sha256: hash,
    source: "manual_upload" as const,
    idempotencyKey: "intake-key",
    correlationId: "66666666-6666-4666-8666-666666666666",
  };
}

function reservation() {
  return {
    id: sourceId,
    organizationId,
    productId: "77777777-7777-4777-8777-777777777777",
    releaseId,
    source: "manual_upload" as const,
    objectKey: `${organizationId}/${sourceId}/${hash}`,
    filename: "release.sbom.json",
    byteSize: 12,
    mediaType: "application/json",
    sha256: hash,
    expiresAt: "2026-08-20T12:00:00.000Z",
    status: "upload_pending" as const,
    createdAt: "2026-08-20T11:00:00.000Z",
    completedAt: null,
  };
}

function signedUpload() {
  return {
    uploadUrl: "http://localhost/upload",
    expiresAt: "2026-08-20T12:00:00.000Z",
  };
}

function job() {
  return {
    id: jobId,
    organizationId,
    releaseId,
    sourceId,
    inputSha256: hash,
    correlationId: "66666666-6666-4666-8666-666666666666",
    status: "queued" as const,
    progress: { stage: "queued", percent: 0, message: "Queued" },
    attempts: 0,
    maxAttempts: 5 as const,
    error: null,
    result: null,
    createdAt: "2026-08-20T11:00:00.000Z",
    updatedAt: "2026-08-20T11:00:00.000Z",
    completedAt: null,
  };
}
