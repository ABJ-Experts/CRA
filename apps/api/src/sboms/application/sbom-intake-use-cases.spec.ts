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

  it("replays verified initialization without signing an immutable existing object", async () => {
    const verified = {
      ...reservation(),
      status: "verified" as const,
      completedAt: "2026-08-20T12:00:00.000Z",
    };
    repository.reserve.mockResolvedValue({
      outcome: "replayed",
      reservation: verified,
    });
    storage.createSignedUpload.mockRejectedValue(
      new Error("Asset already exists"),
    );
    const result = await subject().initialize(command());
    expect(result).toEqual({
      ok: true,
      value: { reservation: verified, upload: null, replayed: true },
    });
    expect(storage.createSignedUpload).not.toHaveBeenCalled();
  });

  it.each(["created", "replayed"] as const)(
    "rejects inconsistent verified reservation %s without signing",
    async (outcome) => {
      repository.reserve.mockResolvedValue({
        outcome,
        reservation: {
          ...reservation(),
          status: "verified",
          completedAt: null,
        },
      });
      expect(await subject().initialize(command())).toEqual({
        ok: false,
        error: { code: "conflict" },
      });
      expect(storage.createSignedUpload).not.toHaveBeenCalled();
    },
  );

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

  it.each(["conflict", "not_found", "idempotency_mismatch", "invalid_request"])(
    "preserves initialization denial %s without storage access",
    async (outcome) => {
      repository.reserve.mockResolvedValue({ outcome });
      expect(await subject().initialize(command())).toEqual({
        ok: false,
        error: { code: outcome },
      });
      expect(storage.createSignedUpload).not.toHaveBeenCalled();
    },
  );
  it("issues a ticket for a fresh reservation and preserves storage failure", async () => {
    repository.reserve.mockResolvedValue({
      outcome: "created",
      reservation: reservation(),
    });
    storage.createSignedUpload.mockResolvedValue(signedUpload());
    expect(await subject().initialize(command())).toMatchObject({
      ok: true,
      value: { replayed: false, upload: signedUpload() },
    });
    storage.createSignedUpload.mockRejectedValue(new Error("offline"));
    expect(await subject().initialize(command())).toEqual({
      ok: false,
      error: { code: "unavailable" },
    });
  });
  it.each(["found", "missing", "offline"])(
    "returns job access %s without revealing denied facts",
    async (outcome) => {
      if (outcome === "offline")
        repository.getJob.mockRejectedValue(new Error("offline"));
      else
        repository.getJob.mockResolvedValue(outcome === "found" ? job() : null);
      expect(await subject().job(organizationId, actorId, jobId)).toEqual(
        outcome === "found"
          ? { ok: true, value: job() }
          : {
              ok: false,
              error: {
                code: outcome === "offline" ? "unavailable" : "not_found",
              },
            },
      );
      expect(repository.getJob).toHaveBeenCalledWith(
        organizationId,
        actorId,
        jobId,
      );
    },
  );
  it.each(["verified", "upload_pending", "missing", "offline"])(
    "signs original downloads only for verified authorized source %s",
    async (status) => {
      if (status === "offline")
        repository.getDownloadSource.mockRejectedValue(new Error("offline"));
      else
        repository.getDownloadSource.mockResolvedValue(
          status === "missing" ? null : { ...reservation(), status },
        );
      storage.createSignedDownload.mockResolvedValue({
        downloadUrl: "https://storage.test/download",
        expiresAt: reservation().expiresAt,
        fileName: reservation().filename,
        contentType: reservation().mediaType,
      });
      const result = await subject().download(
        organizationId,
        actorId,
        sourceId,
      );
      expect(result.ok).toBe(status === "verified");
      expect(storage.createSignedDownload).toHaveBeenCalledTimes(
        status === "verified" ? 1 : 0,
      );
    },
  );
  it.each(["found", "not_found", "conflict", "offline"])(
    "preserves audited job replay result %s",
    async (outcome) => {
      if (outcome === "offline")
        repository.replay.mockRejectedValue(new Error("offline"));
      else
        repository.replay.mockResolvedValue({
          outcome,
          job: outcome === "found" ? job() : null,
        });
      const input = {
        organizationId,
        actorId,
        jobId,
        idempotencyKey: sourceId,
      };
      expect(await subject().replay(input)).toEqual(
        outcome === "found"
          ? { ok: true, value: job() }
          : {
              ok: false,
              error: { code: outcome === "offline" ? "unavailable" : outcome },
            },
      );
      expect(repository.replay).toHaveBeenCalledWith(organizationId, input);
    },
  );
  it.each(["found", "invalid_request", "not_found", "offline"])(
    "scopes source history and handles %s",
    async (outcome) => {
      const response = { sources: [], nextCursor: null };
      if (outcome === "offline")
        repository.listSourcesForRelease.mockRejectedValue(
          new Error("offline"),
        );
      else
        repository.listSourcesForRelease.mockResolvedValue({
          outcome,
          response,
        });
      const input = {
        organizationId,
        actorId,
        productId: reservation().productId,
        releaseId,
        limit: 50,
      };
      expect(await subject().listSourcesForRelease(input)).toEqual(
        outcome === "found"
          ? { ok: true, value: response }
          : {
              ok: false,
              error: { code: outcome === "offline" ? "unavailable" : outcome },
            },
      );
      expect(repository.listSourcesForRelease).toHaveBeenCalledWith(
        organizationId,
        input,
      );
    },
  );
  it.each(["found", "not_found", "offline"])(
    "scopes validation reports and handles %s",
    async (outcome) => {
      const response = { report: null };
      if (outcome === "offline")
        repository.getValidationReport.mockRejectedValue(new Error("offline"));
      else
        repository.getValidationReport.mockResolvedValue({ outcome, response });
      const input = { organizationId, actorId, sourceId };
      expect(await subject().validationReport(input)).toEqual(
        outcome === "found"
          ? { ok: true, value: response }
          : {
              ok: false,
              error: { code: outcome === "offline" ? "unavailable" : outcome },
            },
      );
      expect(repository.getValidationReport).toHaveBeenCalledWith(
        organizationId,
        input,
      );
    },
  );
  it("completes a verified retry without reading bytes again", async () => {
    repository.getSourceForCompletion.mockResolvedValue({
      outcome: "replayed",
      source: { ...reservation(), status: "verified" },
    });
    repository.complete.mockResolvedValue({ outcome: "replayed", job: job() });
    expect(
      await subject().complete({
        organizationId,
        actorId,
        sourceId,
        idempotencyKey: sourceId,
        correlationId: "66666666-6666-4666-8666-666666666666",
      }),
    ).toEqual({ ok: true, value: { outcome: "replayed", job: job() } });
    expect(storage.inspect).not.toHaveBeenCalled();
  });

  it.each(["invalid_request", "unexpected", "offline"])(
    "fails completion safely when authorization is %s",
    async (outcome) => {
      if (outcome === "offline")
        repository.getSourceForCompletion.mockRejectedValue(
          new Error("offline"),
        );
      else repository.getSourceForCompletion.mockResolvedValue({ outcome });
      expect(
        await subject().complete({
          organizationId,
          actorId,
          sourceId,
          idempotencyKey: sourceId,
          correlationId: "66666666-6666-4666-8666-666666666666",
        }),
      ).toEqual({
        ok: false,
        error: {
          code: outcome === "invalid_request" ? "conflict" : "unavailable",
        },
      });
      expect(storage.inspect).not.toHaveBeenCalled();
    },
  );
  it.each(["replayed", "ready"])(
    "retains atomic completion failure for %s",
    async (outcome) => {
      repository.getSourceForCompletion.mockResolvedValue({
        outcome,
        source: reservation(),
      });
      storage.inspect.mockResolvedValue({
        outcome: "verified",
        sha256: hash,
        byteSize: 12,
        contentType: "application/json",
      });
      repository.complete.mockResolvedValue({ outcome: "conflict" });
      expect(
        await subject().complete({
          organizationId,
          actorId,
          sourceId,
          idempotencyKey: sourceId,
          correlationId: "66666666-6666-4666-8666-666666666666",
        }),
      ).toEqual({ ok: false, error: { code: "conflict" } });
    },
  );
  it("does not turn an unavailable byte inspection into a durable rejection", async () => {
    repository.getSourceForCompletion.mockResolvedValue({
      outcome: "ready",
      source: reservation(),
    });
    storage.inspect.mockResolvedValue({ outcome: "unavailable" });
    expect(
      await subject().complete({
        organizationId,
        actorId,
        sourceId,
        idempotencyKey: sourceId,
        correlationId: "66666666-6666-4666-8666-666666666666",
      }),
    ).toEqual({ ok: false, error: { code: "unavailable" } });
    expect(repository.rejectIntegrity).not.toHaveBeenCalled();
  });
  it.each(["not_found", "conflict"])(
    "preserves durable integrity rejection failure %s",
    async (outcome) => {
      repository.getSourceForCompletion.mockResolvedValue({
        outcome: "ready",
        source: reservation(),
      });
      storage.inspect.mockResolvedValue({ outcome: "missing" });
      repository.rejectIntegrity.mockResolvedValue({ outcome });
      expect(
        await subject().complete({
          organizationId,
          actorId,
          sourceId,
          idempotencyKey: sourceId,
          correlationId: "66666666-6666-4666-8666-666666666666",
        }),
      ).toEqual({ ok: false, error: { code: outcome } });
    },
  );

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
