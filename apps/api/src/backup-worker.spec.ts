import { backupVerificationCheckSchema } from "@repo/contracts/backups/schemas";
import {
  bootstrapBackupWorker,
  deterministicOccurrenceId,
} from "./backup-worker";
import { loadBackupWorkerRuntime } from "./backups/infrastructure/backup-worker-runtime";
import {
  NativeBackupWorkerControlClient,
  backupWorkerControlSource,
} from "./backups/infrastructure/native-backup-worker-control.client";
import { BackupWorker } from "./backups/worker/backup-worker";
import { BackupCleanupWorker } from "./backups/worker/backup-cleanup-worker";
import { NativeBackupCleanupAdapter } from "./backups/infrastructure/cleanup/native-backup-cleanup.adapter";
import { MountedBackupWorkerRequests } from "./backups/infrastructure/backup-worker-requests";
import { NativeBackupCaptureAdapter } from "./backups/infrastructure/capture/native-backup-capture.adapter";
import { resolveBackupMounts } from "./backups/infrastructure/capture/backup-mounted-runtime";
import { reconcileStaleRecoveryTargets } from "./backups/infrastructure/restore/recovery-reconciliation";
import { reconcileStaleCaptureResources } from "./backups/infrastructure/capture/capture-resource-reconciliation";
jest.mock("./backups/infrastructure/backup-worker-runtime");
jest.mock("./backups/infrastructure/native-backup-worker-control.client");
jest.mock("./backups/infrastructure/backup-executor", () => ({
  createBackupExecutor: jest.fn().mockReturnValue({}),
}));
jest.mock("./backups/infrastructure/backup-worker-requests");
jest.mock("./backups/infrastructure/capture/native-backup-capture.adapter");
jest.mock("./backups/infrastructure/capture/backup-mounted-runtime");
jest.mock(
  "./backups/infrastructure/restore/recovery-reconciliation",
  () => ({
    reconcileStaleRecoveryTargets: jest
      .fn()
      .mockResolvedValue({ removed: 0, retained: 0 }),
  }),
  { virtual: true },
);
jest.mock(
  "./backups/infrastructure/capture/capture-resource-reconciliation",
  () => ({
    reconcileStaleCaptureResources: jest
      .fn()
      .mockResolvedValue({ removed: 0, retained: 0 }),
  }),
);
jest.mock("./backups/infrastructure/alerts/backup-operator-alerts", () => ({
  BackupOperatorAlerts: jest.fn().mockImplementation(() => ({
    select: jest.fn(),
    record: jest.fn().mockResolvedValue(true),
  })),
}));
jest.mock("./backups/worker/backup-worker");
jest.mock("./backups/worker/backup-cleanup-worker", () => ({
  BackupCleanupWorker: jest.fn().mockImplementation(() => ({
    runOnce: jest.fn().mockResolvedValue(undefined),
  })),
}));
jest.mock(
  "./backups/infrastructure/cleanup/native-backup-cleanup.adapter",
  () => ({
    NativeBackupCleanupAdapter: jest.fn().mockImplementation(() => ({
      cleanup: jest.fn().mockResolvedValue(undefined),
    })),
  }),
);
const config = {
  instanceId: "20000000-0000-4000-8000-000000000001",
  databaseUrl: "http://localhost",
  credential: "narrow",
  projectApiKey: "anon",
  runtime: { sources: { source: {} } },
  targetProfiles: { isolated: {} },
};
const configuration = {
  sourceAlias: "source",
  repositoryAlias: "repo",
  stagingAlias: "stage",
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
const policy = {
  instanceId: config.instanceId,
  version: 1,
  configurationRevision: 1,
  configuration,
  approvedAt: "2026-10-14T00:00:00.000Z",
  approvedBy: "operator",
  lastValidatedAt: null,
};
const execute = jest.fn();
const capture = {
  id: "30000000-0000-4000-8000-000000000001",
  instanceId: config.instanceId,
  kind: "capture",
  parentRunId: null,
  state: "certified",
  stage: "completed",
  progress: 100,
  version: 8,
  attempt: 1,
  configurationRevision: 1,
  createdAt: policy.approvedAt,
  startedAt: policy.approvedAt,
  completedAt: policy.approvedAt,
  durationMs: 4,
  failureCode: null,
  certificate: {
    version: 1,
    checkpointId: "30000000-0000-4000-8000-000000000001",
    certifiedAt: policy.approvedAt,
    recoveryPointAt: policy.approvedAt,
    manifestSha256: "a".repeat(64),
    repositoryGeneration: "40000000-0000-4000-8000-000000000001",
    keyId: "key",
    baseRunId: "30000000-0000-4000-8000-000000000001",
    timeline: 1,
    checkpointLsn: "0/ABC",
    sourceSystemIdentifier: "12345",
    databaseBytes: 1,
    objectBytes: 1,
    objectCount: 1,
    walBytes: 1,
    postgresqlVersion: "17.6",
    integrity: "passed",
  },
  verification: null,
  cleanup: { state: "retained", deletedAt: null },
};
beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  execute.mockImplementation(
    (_instance: string, _actor: string, action: string) =>
      Promise.resolve(
        action === "policy/validation-read"
          ? {
              configuration,
              configurationRevision: 1,
              configurationDigest: "a".repeat(64),
            }
          : action === "policy/read"
            ? policy
            : action === "run/list"
              ? { items: [], nextCursor: null }
              : action === "policy/validate"
                ? {
                    valid: false,
                    checkedAt: policy.approvedAt,
                    configurationDigest: "a".repeat(64),
                    checks: [],
                  }
                : {},
      ),
  );
  jest.mocked(loadBackupWorkerRuntime).mockResolvedValue(config as never);
  jest
    .mocked(NativeBackupWorkerControlClient)
    .mockImplementation(() => ({ execute }) as never);
  jest.mocked(MountedBackupWorkerRequests).mockImplementation(
    () =>
      ({
        capture: jest.fn().mockResolvedValue({}),
        verification: jest.fn(),
      }) as never,
  );
  jest
    .mocked(NativeBackupCaptureAdapter)
    .mockImplementation(
      () => ({ preflight: jest.fn().mockResolvedValue(undefined) }) as never,
    );
  jest.mocked(resolveBackupMounts).mockResolvedValue({} as never);
  jest
    .mocked(backupWorkerControlSource)
    .mockReturnValue(config.runtime.sources.source as never);
  jest
    .mocked(BackupWorker)
    .mockImplementation(
      () => ({ runOnce: jest.fn().mockResolvedValue(undefined) }) as never,
    );
});
afterEach(() => jest.useRealTimers());
it("stays off without opt-in and runs independent lanes only after native validation", async () => {
  jest.mocked(loadBackupWorkerRuntime).mockResolvedValueOnce(null);
  expect(await bootstrapBackupWorker({})).toBeNull();
  const worker = await bootstrapBackupWorker({});
  expect(execute.mock.calls.map((call: unknown[]) => call[2])).toContain(
    "policy/validated",
  );
  expect(execute.mock.calls.map((call: unknown[]) => call[2])).not.toContain(
    "schedule/enqueue",
  );
  await jest.advanceTimersByTimeAsync(1000);
  await worker?.stop();
});
it("permits approved scheduling while unconfigured or unsafe execution does no work", async () => {
  execute
    .mockImplementationOnce(() => Promise.resolve(null))
    .mockImplementationOnce(() =>
      Promise.resolve({
        ...policy,
        configuration: { ...configuration, schedulingEnabled: true },
      }),
    );
  const worker = await bootstrapBackupWorker({});
  expect(execute.mock.calls.map((call: unknown[]) => call[2])).toContain(
    "schedule/enqueue",
  );
  await worker?.stop();
  execute.mockResolvedValueOnce(null);
  const empty = await bootstrapBackupWorker({});
  await empty?.stop();
  const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
  execute.mockRejectedValueOnce(new Error("private"));
  const failed = await bootstrapBackupWorker({});
  expect(stderr).toHaveBeenCalledWith(
    "Backup executor operation unavailable; inspect safe run receipts\n",
  );
  await failed?.stop();
  stderr.mockRestore();
});
it("uses durable distinct scheduled occurrence UUIDs", () => {
  const a = deterministicOccurrenceId("instance:capture:1");
  expect(a).toBe(deterministicOccurrenceId("instance:capture:1"));
  expect(a).not.toBe(deterministicOccurrenceId("instance:capture:2"));
  expect(a).toMatch(
    /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
  );
});
it("automatically verifies the first certified point without silently enabling capture scheduling", async () => {
  execute.mockImplementation(
    (_i: string, _a: string, action: string, input: Record<string, unknown>) =>
      Promise.resolve(
        action === "policy/validation-read"
          ? {
              configuration,
              configurationRevision: 1,
              configurationDigest: "a".repeat(64),
            }
          : action === "policy/read"
            ? policy
            : action === "policy/validate"
              ? {
                  valid: false,
                  checkedAt: policy.approvedAt,
                  configurationDigest: "a".repeat(64),
                  checks: [],
                }
              : action === "run/list"
                ? {
                    items: input.kind === "capture" ? [capture] : [],
                    nextCursor: null,
                  }
                : {},
      ),
  );
  const worker = await bootstrapBackupWorker({});
  expect(execute).toHaveBeenCalledWith(
    config.instanceId,
    expect.any(String),
    "run/create",
    expect.objectContaining({
      kind: "verification",
      parentRunId: capture.id,
      expectedVersion: capture.version,
    }),
  );
  await worker?.stop();
});
it("leaves native mount failures for admitted jobs to report and preserves interval serialization", async () => {
  jest.mocked(MountedBackupWorkerRequests).mockImplementationOnce(
    () =>
      ({
        capture: jest.fn().mockRejectedValue(new Error("key_unavailable")),
        verification: jest.fn(),
      }) as never,
  );
  const worker = await bootstrapBackupWorker({});
  expect(execute.mock.calls.map((call: unknown[]) => call[2])).not.toContain(
    "policy/validated",
  );
  await worker?.stop();
});
it("handles independent lane errors and refuses a missing mounted restore profile", async () => {
  jest.mocked(BackupWorker).mockImplementationOnce(
    () =>
      ({
        runOnce: jest.fn().mockRejectedValue(new Error("safe failure")),
      }) as never,
  );
  jest
    .mocked(loadBackupWorkerRuntime)
    .mockResolvedValueOnce({ ...config, targetProfiles: {} } as never);
  const worker = await bootstrapBackupWorker({});
  await jest.advanceTimersByTimeAsync(1000);
  await worker?.stop();
});
it("does not enqueue an already running verification and handles clean default startup", async () => {
  execute.mockImplementation(
    (_i: string, _a: string, action: string, input: Record<string, unknown>) =>
      Promise.resolve(
        action === "policy/validation-read"
          ? {
              configuration,
              configurationRevision: 1,
              configurationDigest: "a".repeat(64),
            }
          : action === "policy/read"
            ? policy
            : action === "policy/validate"
              ? {
                  valid: false,
                  checkedAt: policy.approvedAt,
                  configurationDigest: "a".repeat(64),
                  checks: [],
                }
              : action === "run/list"
                ? {
                    items:
                      input.kind === "capture"
                        ? [capture]
                        : [
                            {
                              ...capture,
                              kind: "verification",
                              parentRunId: capture.id,
                              state: "running",
                              stage: "validating",
                              progress: 0,
                              certificate: null,
                              completedAt: null,
                            },
                          ],
                    nextCursor: null,
                  }
                : {},
      ),
  );
  const worker = await bootstrapBackupWorker();
  expect(execute.mock.calls.map((call: unknown[]) => call[2])).not.toContain(
    "run/create",
  );
  await worker?.stop();
});

it("keeps protective lanes available when durable alert reconciliation is unavailable", async () => {
  const original = execute.getMockImplementation()! as (
    ...args: unknown[]
  ) => unknown;
  execute.mockImplementation((...args: unknown[]) =>
    args[2] === "alerts/reconcile"
      ? Promise.reject(new Error("source_unavailable"))
      : original(...args),
  );
  const runOnce = jest.fn().mockResolvedValue(undefined);
  jest
    .mocked(BackupWorker)
    .mockImplementationOnce(() => ({ runOnce }) as never);
  const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
  const worker = await bootstrapBackupWorker({});
  expect(runOnce).toHaveBeenCalledWith("capture", expect.any(AbortSignal));
  expect(runOnce).toHaveBeenCalledWith("verification", expect.any(AbortSignal));
  await worker?.stop();
  stderr.mockRestore();
});
it("does not claim work while startup orphan authority is unknown", async () => {
  jest
    .mocked(reconcileStaleRecoveryTargets)
    .mockRejectedValueOnce(new Error("source_unavailable"));
  const runOnce = jest.fn().mockResolvedValue(undefined);
  jest
    .mocked(BackupWorker)
    .mockImplementationOnce(() => ({ runOnce }) as never);
  const stderr = jest.spyOn(process.stderr, "write").mockReturnValue(true);
  const worker = await bootstrapBackupWorker({});
  expect(runOnce).not.toHaveBeenCalled();
  await worker?.stop();
  stderr.mockRestore();
});
it("keeps retained certified captures eligible for scheduled drills after a newer capture is cancelled", async () => {
  const original = execute.getMockImplementation()! as (
    ...args: unknown[]
  ) => unknown;
  execute.mockImplementation((...args: unknown[]) => {
    const input = args[3] as Record<string, unknown> | undefined;
    if (args[2] === "run/list" && input?.kind === "capture")
      return Promise.resolve({
        items: [
          input.certifiedOnly === true
            ? capture
            : {
                ...capture,
                id: "50000000-0000-4000-8000-000000000001",
                state: "cancelled",
                stage: "cancelled",
                progress: 0,
                certificate: null,
              },
        ],
        nextCursor: null,
      });
    return original(...args);
  });
  const worker = await bootstrapBackupWorker({});
  expect(execute).toHaveBeenCalledWith(
    config.instanceId,
    expect.any(String),
    "run/create",
    expect.objectContaining({
      kind: "verification",
      parentRunId: capture.id,
      expectedVersion: capture.version,
    }),
  );
  expect(execute).toHaveBeenCalledWith(
    config.instanceId,
    expect.any(String),
    "run/list",
    { kind: "capture", limit: 1, certifiedOnly: true },
  );
  await worker?.stop();
});

it("deduplicates verification within an occurrence and admits the next monthly drill for the same capture", async () => {
  const period = configuration.verificationIntervalDays * 86400000;
  const started = Date.parse(capture.completedAt);
  jest.setSystemTime(started);
  let successful = false;
  const verification = {
    ...capture,
    id: "60000000-0000-4000-8000-000000000001",
    kind: "verification",
    parentRunId: capture.id,
    state: "verified",
    certificate: null,
    verification: {
      targetProfile: configuration.targetProfile,
      verifiedAt: capture.completedAt,
      integrity: "passed",
      checks: backupVerificationCheckSchema.shape.code.options.map((code) => ({
        code,
        status: "passed",
        durationMs: 1,
        failureCode: null,
      })),
      recoveryPointAgeMs: 1,
      recoveryDurationMs: 1,
      measuredProfile: configuration.targetProfile,
      databaseBytes: 1,
      objectBytes: 1,
    },
  };
  const original = execute.getMockImplementation()! as (
    ...args: unknown[]
  ) => unknown;
  execute.mockImplementation((...args: unknown[]) => {
    if (args[2] === "run/list") {
      const input = args[3] as Record<string, unknown>;
      return Promise.resolve({
        items:
          input.kind === "capture"
            ? [capture]
            : successful
              ? [verification]
              : [],
        nextCursor: null,
      });
    }
    return original(...args);
  });
  const requestKey = () => {
    const calls = execute.mock.calls as unknown as readonly unknown[][];
    const call = calls.find((args) => args[2] === "run/create");
    const input = call?.[3] as { idempotencyKey?: unknown } | undefined;
    return typeof input?.idempotencyKey === "string"
      ? input.idempotencyKey
      : undefined;
  };
  let worker = await bootstrapBackupWorker({});
  await worker?.stop();
  const first = requestKey();
  expect(first).toEqual(expect.any(String));
  successful = true;
  execute.mockClear();
  jest.setSystemTime(started + period - 1);
  worker = await bootstrapBackupWorker({});
  await worker?.stop();
  expect(requestKey()).toBeUndefined();
  execute.mockClear();
  jest.setSystemTime(started + period + 1);
  worker = await bootstrapBackupWorker({});
  await worker?.stop();
  const monthly = requestKey();
  expect(monthly).toEqual(expect.any(String));
  expect(monthly).not.toBe(first);
  execute.mockClear();
  jest.setSystemTime(started + period + 1001);
  worker = await bootstrapBackupWorker({});
  await worker?.stop();
  expect(requestKey()).toBe(monthly);
  execute.mockClear();
  jest.setSystemTime(started - 1);
  worker = await bootstrapBackupWorker({});
  await worker?.stop();
  expect(requestKey()).toBeUndefined();
});

it("authorizes capture crash cleanup only from fresh matching terminal capture receipts", async () => {
  const worker = await bootstrapBackupWorker({});
  const call = jest.mocked(reconcileStaleCaptureResources).mock.calls[0];
  expect(call).toBeDefined();
  const authorize = call![2];
  execute.mockResolvedValueOnce(capture);
  expect(await authorize(capture.id)).toBe(true);
  execute.mockResolvedValueOnce({
    ...capture,
    state: "running",
    stage: "validating",
    progress: 0,
    certificate: null,
    completedAt: null,
    durationMs: null,
  });
  expect(await authorize(capture.id)).toBe(false);
  execute.mockResolvedValueOnce({
    ...capture,
    instanceId: "70000000-0000-4000-8000-000000000001",
  });
  expect(await authorize(capture.id)).toBe(false);
  execute.mockResolvedValueOnce({
    ...capture,
    id: "70000000-0000-4000-8000-000000000001",
  });
  expect(await authorize(capture.id)).toBe(false);
  execute.mockRejectedValueOnce(new Error("source_unavailable"));
  await expect(authorize(capture.id)).rejects.toThrow("source_unavailable");
  await worker?.stop();
});

it("defers automatic verification admission while its capture lane owns a write cut", async () => {
  const original = execute.getMockImplementation()! as (
    ...args: unknown[]
  ) => unknown;
  execute.mockImplementation((...args: unknown[]) => {
    if (args[2] === "run/list")
      return Promise.resolve({
        items:
          (args[3] as Record<string, unknown>).kind === "capture"
            ? [capture]
            : [],
        nextCursor: null,
      });
    return original(...args);
  });
  let release: () => void = () => undefined;
  const pending = new Promise<void>((resolve) => {
    release = resolve;
  });
  jest.mocked(BackupWorker).mockImplementationOnce(
    () =>
      ({
        runOnce: jest
          .fn()
          .mockImplementation((kind: string) =>
            kind === "capture" ? pending : Promise.resolve(),
          ),
      }) as never,
  );
  const worker = await bootstrapBackupWorker({});
  try {
    execute.mockClear();
    await jest.advanceTimersByTimeAsync(1000);
    expect(
      execute.mock.calls.some((args: unknown[]) => args[2] === "run/create"),
    ).toBe(false);
  } finally {
    release();
    await worker?.stop();
  }
});

it("passes mounted deadlines and the exact reviewed cleanup request into their executor boundaries", async () => {
  const nativeCleanup = jest.fn().mockResolvedValue(undefined);
  jest
    .mocked(NativeBackupCleanupAdapter)
    .mockImplementationOnce(() => ({ cleanup: nativeCleanup }) as never);
  jest.mocked(loadBackupWorkerRuntime).mockResolvedValueOnce({
    ...config,
    targetProfiles: { isolated: { deadlineMs: 1200 } },
  } as never);
  const worker = await bootstrapBackupWorker({});
  try {
    const options = jest.mocked(BackupWorker).mock.calls[0]![0];
    expect(options.verificationTimeoutMs!("isolated")).toBe(1200);
    expect(options.verificationTimeoutMs!("unknown")).toBe(1);
    const cleanup = jest.mocked(BackupCleanupWorker).mock.calls[0]![0];
    const input = {
      instanceId: config.instanceId,
      runId: capture.id,
      actor: "backup-worker:fixture",
      workerId: "backup-fixture",
      expectedVersion: 1,
      reviewFingerprint: "a".repeat(64),
      idempotencyKey: "80000000-0000-4000-8000-000000000001",
      sourceAlias: "source",
      repositoryAlias: "repo",
    };
    const signal = new AbortController().signal;
    await cleanup.executor.cleanup(input, signal);
    expect(nativeCleanup).toHaveBeenCalledWith(input, signal);
  } finally {
    await worker?.stop();
  }
});
