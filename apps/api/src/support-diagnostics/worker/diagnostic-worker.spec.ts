import { DiagnosticWorker } from "./diagnostic-worker";
const org = "11111111-1111-4111-8111-111111111111",
  id = "22222222-2222-4222-8222-222222222222";
const claim = {
  job: {
    id,
    organizationId: org,
    version: 2,
    selection: {
      categories: ["logs"],
      from: "2026-10-13T00:00:00.000Z",
      to: "2026-10-14T00:00:00.000Z",
    },
  },
  creatorUserId: id,
  sessionId: id,
  permissionVersion: "1",
  objectPath: `${org}/${id}/attempt-1/bundle.zip`,
};
function fixture() {
  const repository = {
    claim: jest.fn().mockResolvedValue(claim),
    authorize: jest.fn().mockResolvedValue(claim),
    heartbeat: jest.fn().mockResolvedValue(claim),
    checkpoint: jest.fn().mockResolvedValue(claim),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    claimCleanup: jest.fn().mockResolvedValue(null),
    authorizeCleanup: jest.fn().mockResolvedValue(claim),
    finishCleanup: jest.fn(),
  };
  const sources = {
    collect: jest.fn().mockResolvedValue({ logs: [], omissions: [] }),
  };
  const storage = {
    reconcileTemporaryFiles: jest.fn().mockResolvedValue(undefined),
    put: jest.fn().mockResolvedValue(undefined),
    read: jest.fn().mockResolvedValue(Buffer.from("zip")),
    remove: jest.fn(),
  };
  const archive = {
    pack: jest.fn().mockResolvedValue({
      bytes: Buffer.from("zip"),
      manifest: {},
      artifact: {
        sha256: "a".repeat(64),
        byteSize: 3,
        fileName: `support-diagnostics-${id}.zip`,
      },
    }),
  };
  return {
    repository,
    sources,
    storage,
    archive,
    worker: new DiagnosticWorker({
      workerId: "worker",
      repository: repository,
      sources: sources,
      storage: storage as never,
      archive: archive as never,
    }),
  };
}
describe("leased diagnostic generation", () => {
  it("uploads and verifies before the publication fence", async () => {
    const f = fixture();
    await f.worker.runOnce();
    expect(f.repository.complete).toHaveBeenCalledTimes(1);
    expect(f.storage.put.mock.invocationCallOrder[0]).toBeLessThan(
      f.repository.complete.mock.invocationCallOrder[0]!,
    );
    expect(f.storage.read).toHaveBeenCalled();
  });
  it("does not publish after cancellation or lost lease", async () => {
    const f = fixture();
    f.repository.authorize.mockRejectedValueOnce(new Error("access_changed"));
    await f.worker.runOnce();
    expect(f.storage.put).not.toHaveBeenCalled();
    expect(f.repository.complete).not.toHaveBeenCalled();
  });
  it("fails when every selected source is unavailable", async () => {
    const f = fixture();
    f.sources.collect.mockResolvedValue({
      omissions: [{ category: "logs", code: "source_unavailable" }],
    });
    await f.worker.runOnce();
    expect(f.repository.fail).toHaveBeenCalled();
    expect(f.storage.put).not.toHaveBeenCalled();
  });
  it("leaves uploaded bytes private when final authority fails", async () => {
    const f = fixture();
    f.repository.authorize
      .mockResolvedValueOnce(claim)
      .mockRejectedValueOnce(new Error("access_changed"));
    await f.worker.runOnce();
    expect(f.storage.put).toHaveBeenCalled();
    expect(f.repository.complete).not.toHaveBeenCalled();
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
  it("does no source work without a claimed job", async () => {
    const f = fixture();
    f.repository.claim.mockResolvedValue(null);
    await f.worker.runOnce();
    expect(f.sources.collect).not.toHaveBeenCalled();
  });
  it("rechecks cleanup authority before each scoped delete", async () => {
    const f = fixture();
    f.repository.claimCleanup.mockResolvedValue({
      ...claim,
      objectPaths: [claim.objectPath],
    });
    f.repository.authorizeCleanup.mockRejectedValue(
      new Error("access_changed"),
    );
    await f.worker.runOnce();
    expect(f.storage.remove).not.toHaveBeenCalled();
    expect(f.repository.finishCleanup).toHaveBeenCalledWith(
      expect.anything(),
      false,
      expect.any(AbortSignal),
    );
  });
});

describe("diagnostic worker crash and cancellation transport fences", () => {
  afterEach(() => jest.useRealTimers());
  it("heartbeats while awaiting a source and aborts the real source transport at60s", async () => {
    jest.useFakeTimers();
    const f = fixture();
    f.sources.collect.mockImplementation(
      (_claim: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ) as never,
    );
    const running = f.worker.runOnce();
    await jest.advanceTimersByTimeAsync(10_000);
    expect(f.repository.heartbeat).toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(50_000);
    await running;
    expect(f.repository.complete).not.toHaveBeenCalled();
    expect(f.repository.fail).toHaveBeenCalledWith(
      expect.anything(),
      "generation_timeout",
      expect.any(AbortSignal),
    );
  });
  it("lost heartbeat stops collection and never publishes", async () => {
    jest.useFakeTimers();
    const f = fixture();
    f.repository.heartbeat.mockRejectedValue(new Error("lease_lost"));
    f.sources.collect.mockImplementation(
      (_claim: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => reject(new Error("aborted")), {
            once: true,
          }),
        ) as never,
    );
    const running = f.worker.runOnce();
    await jest.advanceTimersByTimeAsync(10_000);
    await running;
    expect(f.repository.complete).not.toHaveBeenCalled();
  });
  it("cleans only authorized attempt paths then finalizes, preserving failure fences", async () => {
    const f = fixture();
    f.repository.claim.mockResolvedValue(null);
    f.repository.claimCleanup.mockResolvedValue({
      ...claim,
      objectPaths: [claim.objectPath],
    });
    await f.worker.runOnce();
    expect(f.storage.remove).toHaveBeenCalledWith(
      org,
      claim.objectPath,
      expect.any(AbortSignal),
    );
    expect(f.repository.finishCleanup).toHaveBeenCalledWith(
      expect.anything(),
      true,
      expect.any(AbortSignal),
    );
    f.repository.finishCleanup.mockRejectedValue(new Error("conflict"));
    await expect(f.worker.runOnce()).resolves.toBeUndefined();
  });
  it("does not remove private uploads after storage verification or terminal failure", async () => {
    const f = fixture();
    f.storage.read.mockRejectedValue(new Error("storage_unavailable"));
    f.repository.fail.mockRejectedValue(new Error("lease_lost"));
    await f.worker.runOnce();
    expect(f.repository.complete).not.toHaveBeenCalled();
    expect(f.storage.remove).not.toHaveBeenCalled();
  });
});

it.each([
  [new Error("bundle_limit"), "invalid_value"],
  [new Error("invalid_value"), "invalid_value"],
  [new Error("access_changed"), "authority_lost"],
  [new Error("unknown"), "source_unavailable"],
  ["not an error", "source_unavailable"],
])("maps generation failure to safe DB code %#", async (error, code) => {
  const f = fixture();
  f.sources.collect.mockRejectedValue(error);
  await f.worker.runOnce();
  expect(f.repository.fail).toHaveBeenCalledWith(
    expect.anything(),
    code,
    expect.any(AbortSignal),
  );
});

it("finishes pathless reviewed cleanup without storage or per-object authorization", async () => {
  const f = fixture();
  f.repository.claim.mockResolvedValue(null);
  f.repository.claimCleanup.mockResolvedValue({
    ...claim,
    objectPath: null,
    objectPaths: [],
  });
  await f.worker.runOnce();
  expect(f.storage.remove).not.toHaveBeenCalled();
  expect(f.repository.authorizeCleanup).not.toHaveBeenCalled();
  expect(f.repository.finishCleanup).toHaveBeenCalledWith(
    expect.objectContaining({ objectPath: null, objectPaths: [] }),
    true,
    expect.any(AbortSignal),
  );
});
