import type { BackupExecutionContext } from "../application/backup-execution.port";
import { BackupWorker } from "./backup-worker";
const configuration = {
  sourceAlias: "source",
  repositoryAlias: "repository",
  stagingAlias: "staging",
  keyAlias: "key",
  targetProfile: "isolated",
  residency: "local",
  schedulingEnabled: false,
  checkpointIntervalMinutes: 30,
  baseIntervalHours: 24,
  verificationIntervalDays: 30,
  retentionDays: 30,
  pauseLimitSeconds: 120,
};
const run = {
  id: "20000000-0000-4000-8000-000000000001",
  instanceId: "30000000-0000-4000-8000-000000000001",
  kind: "capture",
  parentRunId: null,
  state: "running",
  stage: "validating",
  progress: 0,
  version: 1,
  attempt: 1,
  configurationRevision: 1,
  createdAt: "2026-10-14T00:00:00.000Z",
  startedAt: "2026-10-14T00:00:00.000Z",
  completedAt: null,
  durationMs: null,
  failureCode: null,
  certificate: null,
  verification: null,
  cleanup: { state: "retained", deletedAt: null },
};
const options = () => {
  let version = 1;
  const control = {
    execute: jest
      .fn()
      .mockImplementation(
        (
          _instance: string,
          _actor: string,
          action: string,
          input: Record<string, unknown>,
        ) =>
          action === "run/claim"
            ? Promise.resolve({ run, execution: { configuration } })
            : Promise.resolve({
                ...run,
                version: ++version,
                stage: input.stage ?? "validating",
              }),
      ),
  };
  const requests = {
    capture: jest.fn().mockResolvedValue({ runId: run.id }),
    verification: jest.fn().mockResolvedValue({ runId: run.id }),
    captured: jest.fn().mockReturnValue({ safe: true }),
    verified: jest.fn().mockReturnValue({ safe: true }),
  };
  const executor = {
    capture: jest.fn().mockResolvedValue({}),
    verify: jest.fn().mockResolvedValue({}),
  };
  return {
    instanceId: run.instanceId,
    workerId: "worker",
    control,
    requests,
    executor,
  };
};
it("claims and safely completes an authorized lane with serialized checkpoints", async () => {
  const value = options();
  value.executor.capture.mockImplementationOnce(
    async (_request: unknown, context: BackupExecutionContext) => {
      await context.checkpoint("pausing_writes", 40);
      await context.checkpoint("copying_objects", 50);
      return {};
    },
  );
  await new BackupWorker(value).runOnce("capture");
  expect(
    value.control.execute.mock.calls.map(
      (call) => (call as unknown as unknown[])[2],
    ),
  ).toEqual([
    "run/claim",
    "run/pause",
    "run/heartbeat",
    "run/heartbeat",
    "run/heartbeat",
    "run/complete",
  ]);
  expect(value.requests.captured).toHaveBeenCalled();
  expect(value.executor.verify).not.toHaveBeenCalled();
});
it("skips empty claims and never runs unauthorized or malformed work", async () => {
  const value = options();
  value.control.execute.mockResolvedValueOnce(null);
  await new BackupWorker(value).runOnce("capture");
  expect(value.executor.capture).not.toHaveBeenCalled();
  value.control.execute.mockResolvedValueOnce({ run: { token: "secret" } });
  await expect(new BackupWorker(value).runOnce("capture")).rejects.toThrow();
  expect(value.executor.capture).not.toHaveBeenCalled();
});
it.each([new Error("object_missing"), new Error("secret-canary")])(
  "records bounded failures without publishing %s",
  async (error) => {
    const value = options();
    value.executor.capture.mockRejectedValueOnce(error);
    await new BackupWorker(value).runOnce("capture");
    expect(
      value.control.execute.mock.calls.map(
        (call) => (call as unknown as unknown[])[2],
      ),
    ).toEqual(["run/claim", "run/fail"]);
    expect(JSON.stringify(value.control.execute.mock.calls)).not.toContain(
      "secret-canary",
    );
  },
);
it("isolates verification and lets cancellation win publication", async () => {
  const value = options();
  value.control.execute.mockResolvedValueOnce({
    run: { ...run, kind: "verification", parentRunId: run.id },
    execution: { configuration },
  });
  await new BackupWorker(value).runOnce("verification");
  expect(value.executor.verify).toHaveBeenCalled();
  expect(value.requests.verified).toHaveBeenCalled();
  const cancelled = options();
  cancelled.control.execute
    .mockImplementationOnce(() =>
      Promise.resolve({ run, execution: { configuration } }),
    )
    .mockRejectedValueOnce(new Error("lease_lost"));
  await new BackupWorker(cancelled).runOnce("capture");
  expect(
    cancelled.control.execute.mock.calls.map(
      (call) => (call as unknown as unknown[])[2],
    ),
  ).not.toContain("run/complete");
});
it("requeues infrastructure failures before the write cut using the live lease and never retries after a cut", async () => {
  const value = options();
  value.executor.capture.mockRejectedValueOnce(new Error("source_unavailable"));
  await new BackupWorker(value).runOnce("capture");
  expect(value.control.execute).toHaveBeenLastCalledWith(
    run.instanceId,
    "backup-worker:worker",
    "run/retry",
    {
      runId: run.id,
      workerId: "worker",
      expectedVersion: run.version,
      failureCode: "source_unavailable",
    },
    expect.any(AbortSignal),
  );
  const cut = options();
  cut.executor.capture.mockImplementationOnce(
    async (_request: unknown, context: BackupExecutionContext) => {
      await context.checkpoint("write_pause", 45);
      throw new Error("source_unavailable");
    },
  );
  await new BackupWorker(cut).runOnce("capture");
  expect(
    cut.control.execute.mock.calls.map((call: unknown[]) => call[2]),
  ).toContain("run/fail");
  expect(
    cut.control.execute.mock.calls.map((call: unknown[]) => call[2]),
  ).not.toContain("run/retry");
});
it("heartbeats a long-running attempt and persists successful verification separately", async () => {
  jest.useFakeTimers();
  try {
    const value = options();
    value.executor.capture.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10001));
      return {};
    });
    const active = new BackupWorker(value).runOnce("capture");
    await jest.advanceTimersByTimeAsync(10002);
    await active;
    expect(
      value.control.execute.mock.calls
        .map((call: unknown[]) => call[2])
        .filter((action) => action === "run/heartbeat").length,
    ).toBeGreaterThan(1);
    const verification = options();
    verification.control.execute.mockResolvedValueOnce({
      run: { ...run, kind: "verification", parentRunId: run.id },
      execution: { configuration },
    });
    verification.executor.verify.mockResolvedValueOnce({ verified: true });
    await new BackupWorker(verification).runOnce("verification");
    expect(
      verification.control.execute.mock.calls.map((call: unknown[]) => call[2]),
    ).toContain("run/complete");
  } finally {
    jest.useRealTimers();
  }
});
it("reports an uncommitted terminal receipt instead of silently abandoning the live lease", async () => {
  const value = options();
  const original = value.control.execute.getMockImplementation()! as (
    instance: string,
    actor: string,
    action: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  value.control.execute.mockImplementation(
    (
      instance: string,
      actor: string,
      action: string,
      input: Record<string, unknown>,
    ) =>
      action === "run/complete" || action === "run/fail"
        ? Promise.reject(new Error("sensitive database canary"))
        : original(instance, actor, action, input),
  );
  await expect(new BackupWorker(value).runOnce("capture")).rejects.toThrow(
    "audit_unavailable",
  );
});
it("accepts an independently committed cancellation when receipt acknowledgement is lost", async () => {
  const value = options();
  const original = value.control.execute.getMockImplementation()! as (
    instance: string,
    actor: string,
    action: string,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  value.control.execute.mockImplementation(
    (
      instance: string,
      actor: string,
      action: string,
      input: Record<string, unknown>,
    ) => {
      if (action === "run/complete" || action === "run/fail")
        return Promise.reject(new Error("conflict"));
      if (action === "run/read")
        return Promise.resolve({
          ...run,
          state: "cancelled",
          stage: "cancelled",
          completedAt: run.createdAt,
        });
      return original(instance, actor, action, input);
    },
  );
  await expect(
    new BackupWorker(value).runOnce("capture"),
  ).resolves.toBeUndefined();
});
it("bounds verification before certificate authentication starts and forwards cancellation to the loader", async () => {
  jest.useFakeTimers();
  try {
    const value = options();
    value.control.execute.mockResolvedValueOnce({
      run: { ...run, kind: "verification", parentRunId: run.id },
      execution: { configuration },
    });
    value.requests.verification.mockImplementationOnce(
      (_run: unknown, _configuration: unknown, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener(
            "abort",
            () => reject(new Error("interrupted")),
            { once: true },
          ),
        ),
    );
    const active = new BackupWorker({
      ...value,
      verificationTimeoutMs: () => 100,
    }).runOnce("verification");
    await jest.advanceTimersByTimeAsync(101);
    await active;
    expect(value.executor.verify).not.toHaveBeenCalled();
    expect(
      value.control.execute.mock.calls.map((call: unknown[]) => call[2]),
    ).toContain("run/retry");
  } finally {
    jest.useRealTimers();
  }
});
it("preserves a periodic control transport failure instead of claiming that the lease expired", async () => {
  jest.useFakeTimers();
  try {
    const value = options();
    const original = value.control.execute.getMockImplementation()! as (
      instance: string,
      actor: string,
      action: string,
      input: Record<string, unknown>,
    ) => Promise<unknown>;
    value.control.execute.mockImplementation(
      (
        instance: string,
        actor: string,
        action: string,
        input: Record<string, unknown>,
      ) =>
        action === "run/heartbeat"
          ? Promise.reject(new Error("source_unavailable"))
          : original(instance, actor, action, input),
    );
    value.executor.capture.mockImplementationOnce(
      (_request: unknown, context: BackupExecutionContext) =>
        new Promise((_resolve, reject) =>
          context.signal.addEventListener(
            "abort",
            () =>
              reject(
                context.signal.reason instanceof Error
                  ? context.signal.reason
                  : new Error("interrupted"),
              ),
            { once: true },
          ),
        ),
    );
    const active = new BackupWorker(value).runOnce("capture");
    await jest.advanceTimersByTimeAsync(2001);
    await active;
    expect(value.control.execute).toHaveBeenCalledWith(
      run.instanceId,
      "backup-worker:worker",
      "run/retry",
      expect.objectContaining({ failureCode: "source_unavailable" }),
      expect.any(AbortSignal),
    );
  } finally {
    jest.useRealTimers();
  }
});
