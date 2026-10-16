import { ExportWorker } from "./export-worker";
import type {
  ExportWorkerRepository,
  ExportPartCheckpoint,
  FrozenExportJob,
} from "./export-worker.types";

const job: FrozenExportJob = {
  id: "8cc33f37-0297-4327-aa68-8a11c557fe7a",
  organizationId: "8cc33f37-0297-4327-aa68-8a11c557fe7b",
  workerId: "worker",
  version: 1,
  source: "products.registry",
  requestedAt: "2026-10-09T00:00:00Z",
  requestDigest: "a".repeat(64),
  scope: "all_filtered",
  format: "csv",
  snapshotAsOf: "2026-10-09T00:00:00Z",
  totalRows: 1,
  columns: [{ key: "name", label: "Name", type: "text" }],
  parts: [],
  captureState: "published",
};
function repository(
  overrides: Partial<ExportWorkerRepository> = {},
): ExportWorkerRepository {
  return {
    claim: jest.fn().mockResolvedValue(job),
    capture: jest.fn().mockResolvedValue(job),
    publishCapture: jest.fn().mockResolvedValue(job),
    authorize: jest.fn().mockResolvedValue(true),
    heartbeat: jest.fn().mockResolvedValue(job),
    rows: jest
      .fn()
      .mockImplementation((_job, after) =>
        Promise.resolve(
          after === 0 ? [{ ordinal: 1, values: { name: "é" } }] : [],
        ),
      ),
    checkpoint: jest
      .fn()
      .mockImplementation(
        (active: FrozenExportJob, parts: readonly ExportPartCheckpoint[]) =>
          Promise.resolve({ ...active, parts }),
      ),
    complete: jest.fn().mockResolvedValue(undefined),
    fail: jest.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
describe("resumable export worker", () => {
  it("does not publish or read rows when revoked", async () => {
    const repo = repository({ authorize: jest.fn().mockResolvedValue(false) });
    const worker = new ExportWorker({
      repository: repo,
      storage: { upload: jest.fn(), verify: jest.fn() },
      workerId: "worker",
    });
    expect(await worker.runOnce()).toBe("processed");
    expect(repo.rows).not.toHaveBeenCalled();
    expect(repo.fail).toHaveBeenCalledWith(job, "access_changed", false);
  });
  it("uploads and checkpoints bounded frozen rows before completion", async () => {
    const repo = repository();
    const upload = jest.fn(async ({ stream }) => {
      for await (const chunk of stream) void chunk;
    });
    const worker = new ExportWorker({
      repository: repo,
      storage: { upload, verify: jest.fn().mockResolvedValue(true) },
      workerId: "worker",
    });
    expect(await worker.runOnce()).toBe("processed");
    expect(upload).toHaveBeenCalledTimes(1);
    expect(repo.checkpoint).toHaveBeenCalled();
    expect(repo.rows).toHaveBeenCalledWith(expect.anything(), 0, 250);
    expect(repo.complete).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ rowCount: 1 }),
    );
  });
  it("returns idle with no job", async () => {
    const worker = new ExportWorker({
      repository: repository({ claim: jest.fn().mockResolvedValue(null) }),
      storage: { upload: jest.fn(), verify: jest.fn() },
    });
    expect(await worker.runOnce()).toBe("idle");
  });
});

describe("worker recovery and bounds", () => {
  const storage = () => ({
    upload: jest.fn(async ({ stream }) => {
      for await (const chunk of stream) void chunk;
    }),
    verify: jest.fn().mockResolvedValue(true),
  });
  it("captures once then publishes durable audit before rows", async () => {
    const pending = { ...job, captureState: "pending" as const };
    const repo = repository({
      claim: jest.fn().mockResolvedValue(pending),
      capture: jest
        .fn()
        .mockResolvedValue({ ...job, captureState: "captured" }),
      publishCapture: jest.fn().mockResolvedValue(job),
    });
    await new ExportWorker({ repository: repo, storage: storage() }).runOnce();
    expect(repo.capture).toHaveBeenCalledTimes(1);
    expect(repo.publishCapture).toHaveBeenCalledTimes(1);
    expect(repo.complete).toHaveBeenCalled();
  });
  it.each(["xlsx", "csv"] as const)(
    "renders %s empty results",
    async (format) => {
      const active = { ...job, format, totalRows: 0 };
      const repo = repository({
        claim: jest.fn().mockResolvedValue(active),
        heartbeat: jest.fn().mockResolvedValue(active),
      });
      await new ExportWorker({
        repository: repo,
        storage: storage(),
      }).runOnce();
      expect(repo.complete).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ rowCount: 0 }),
      );
    },
  );
  it("does not regenerate verified checkpoint parts after host restart", async () => {
    const part = {
      id: job.id,
      name: "part-0001.csv",
      objectPath: `${job.organizationId}/${job.id}/part-0001.csv-${"a".repeat(64)}`,
      sha256: "a".repeat(64),
      byteLength: 100,
      startOrdinal: 1,
      endOrdinal: 1,
      rowCount: 1,
      mediaType: "text/csv" as const,
    };
    const active = { ...job, parts: [part] };
    const repo = repository({ claim: jest.fn().mockResolvedValue(active) });
    const files = storage();
    await new ExportWorker({ repository: repo, storage: files }).runOnce();
    expect(files.upload).not.toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalled();
  });
  it.each([
    "checkpoint_integrity_failed",
    "snapshot_integrity_failed",
    "storage_integrity_failed",
    "export_limit",
  ])("fails closed for %s", async (code) => {
    const active =
      code === "export_limit"
        ? { ...job, totalRows: 100001 }
        : code === "checkpoint_integrity_failed"
          ? {
              ...job,
              parts: [
                {
                  id: job.id,
                  name: "bad",
                  objectPath: "bad",
                  sha256: "a".repeat(64),
                  byteLength: 10,
                  startOrdinal: 2,
                  endOrdinal: 2,
                  rowCount: 1,
                  mediaType: "text/csv" as const,
                },
              ],
            }
          : job;
    const repo = repository({
      claim: jest.fn().mockResolvedValue(active),
      ...(code === "snapshot_integrity_failed"
        ? { rows: jest.fn().mockResolvedValue([]) }
        : {}),
    });
    const files = storage();
    if (code === "storage_integrity_failed")
      files.verify.mockResolvedValue(false);
    await new ExportWorker({ repository: repo, storage: files }).runOnce();
    expect(repo.fail).toHaveBeenCalledWith(expect.anything(), code, false);
    expect(repo.complete).not.toHaveBeenCalled();
  });
  it("records safe retryable provider failure without logging sensitive detail", async () => {
    const repo = repository({
      rows: jest.fn().mockRejectedValue(new Error("secret database URL")),
    });
    await new ExportWorker({ repository: repo, storage: storage() }).runOnce();
    expect(repo.fail).toHaveBeenCalledWith(
      expect.anything(),
      "generation_failed",
      true,
    );
  });
  it("renews lease during long row work", async () => {
    const repo = repository();
    let clock = 0;
    await new ExportWorker({
      repository: repo,
      storage: storage(),
      now: () => {
        clock += 16000;
        return clock;
      },
    }).runOnce();
    expect(repo.heartbeat).toHaveBeenCalled();
    expect(repo.complete).toHaveBeenCalled();
  });
});
it("persists PDF plus JSON artifacts and resumes report parts without recapture", async () => {
  const report = {
    version: "m14_03_v1",
    product: { id: job.id, name: "Product", version: 1 },
    snapshotAsOf: job.snapshotAsOf,
    technicalFileVersion: 1,
    canonicalReadiness: null,
    evidence: [],
    degraded: true,
    notices: [],
    documentationReadinessOnly: true,
    sourceVersions: [],
  };
  const active = {
    ...job,
    source: "technical_files.readiness_report",
    format: "report" as const,
    columns: [],
  };
  const repo = repository({
    claim: jest.fn().mockResolvedValue(active),
    heartbeat: jest
      .fn()
      .mockImplementation((current) => Promise.resolve(current)),
    rows: jest
      .fn()
      .mockResolvedValue([
        { ordinal: 1, values: { report: JSON.stringify(report) } },
      ]),
  });
  const storage = {
    upload: jest.fn(async ({ stream }) => {
      for await (const chunk of stream) void chunk;
    }),
    verify: jest.fn().mockResolvedValue(true),
  };
  await new ExportWorker({ repository: repo, storage }).runOnce();
  expect(storage.upload).toHaveBeenCalledTimes(2);
  expect(repo.complete).toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ documentationReadinessOnly: true }),
  );
  const completedCall = (
    repo.complete as jest.MockedFunction<ExportWorkerRepository["complete"]>
  ).mock.calls[0];
  if (!completedCall) throw new Error("Expected completed report job");
  const final = completedCall[0];
  const resumed = repository({
    claim: jest.fn().mockResolvedValue(final),
    rows: jest
      .fn()
      .mockResolvedValue([
        { ordinal: 1, values: { report: JSON.stringify(report) } },
      ]),
  });
  storage.upload.mockClear();
  await new ExportWorker({ repository: resumed, storage }).runOnce();
  expect(storage.upload).not.toHaveBeenCalled();
  expect(resumed.complete).toHaveBeenCalled();
});
it("heartbeats stalled output without losing the current checkpoint fence", async () => {
  jest.useFakeTimers();
  try {
    const repo = repository();
    let release!: () => void;
    const waiting = new Promise<void>((resolve) => {
      release = resolve;
    });
    let started!: () => void;
    const uploaded = new Promise<void>((resolve) => {
      started = resolve;
    });
    const storage = {
      upload: jest.fn(async ({ stream }) => {
        for await (const chunk of stream) void chunk;
        started();
        await waiting;
      }),
      verify: jest.fn().mockResolvedValue(true),
    };
    const running = new ExportWorker({ repository: repo, storage }).runOnce();
    await uploaded;
    await jest.advanceTimersByTimeAsync(16000);
    expect(repo.heartbeat).toHaveBeenCalledTimes(2);
    release();
    await running;
    expect(repo.complete).toHaveBeenCalled();
  } finally {
    jest.useRealTimers();
  }
});

it("rejects a million-row frozen job before reading or uploading, without truncation", async () => {
  const oversized = { ...job, totalRows: 1000000 };
  const repo = repository({ claim: jest.fn().mockResolvedValue(oversized) });
  const storage = { upload: jest.fn(), verify: jest.fn() };
  const worker = new ExportWorker({
    repository: repo,
    storage,
    workerId: "worker",
  });
  await worker.runOnce();
  expect(repo.rows).not.toHaveBeenCalled();
  expect(storage.upload).not.toHaveBeenCalled();
  expect(repo.fail).toHaveBeenCalledWith(oversized, "export_limit", false);
});
it.each([
  ["capture_timeout", true],
  ["export_limit", false],
  ["access_changed", false],
])(
  "persists safe capture failure %s with its retry policy",
  async (code, retryable) => {
    const pending = { ...job, captureState: "pending" as const };
    const repo = repository({
      claim: jest.fn().mockResolvedValue(pending),
      capture: jest.fn().mockRejectedValue(new Error(code)),
    });
    await new ExportWorker({
      repository: repo,
      storage: { upload: jest.fn(), verify: jest.fn() },
      workerId: "worker",
    }).runOnce();
    expect(repo.fail).toHaveBeenCalledWith(pending, code, retryable);
  },
);
it("abandons a stale lease without attempting a failure write", async () => {
  const pending = { ...job, captureState: "pending" as const };
  const repo = repository({
    claim: jest.fn().mockResolvedValue(pending),
    capture: jest.fn().mockRejectedValue(new Error("lease_conflict")),
  });
  await expect(
    new ExportWorker({
      repository: repo,
      storage: { upload: jest.fn(), verify: jest.fn() },
      workerId: "worker",
    }).runOnce(),
  ).resolves.toBe("processed");
  expect(repo.fail).not.toHaveBeenCalled();
});
it("abandons when fencing races with failure persistence", async () => {
  const repo = repository({
    authorize: jest.fn().mockResolvedValue(false),
    fail: jest.fn().mockRejectedValue(new Error("lease_conflict")),
  });
  await expect(
    new ExportWorker({
      repository: repo,
      storage: { upload: jest.fn(), verify: jest.fn() },
      workerId: "worker",
    }).runOnce(),
  ).resolves.toBe("processed");
});
