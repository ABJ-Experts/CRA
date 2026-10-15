import { BackupCleanupWorker } from "./backup-cleanup-worker";
const instanceId = "20000000-0000-4000-8000-000000000001";
it("leaves unrequested backups alone and executes only the scoped reviewed claim", async () => {
  const execute = jest.fn().mockResolvedValueOnce(null);
  const cleanup = jest.fn().mockResolvedValue(undefined);
  const worker = new BackupCleanupWorker({
    instanceId,
    workerId: "worker",
    control: { execute },
    executor: { cleanup },
  });
  await worker.runOnce();
  expect(cleanup).not.toHaveBeenCalled();
  execute.mockResolvedValueOnce({
    run: { id: "30000000-0000-4000-8000-000000000001", version: 3 },
    execution: {
      configuration: { sourceAlias: "source", repositoryAlias: "repo" },
      actor: "operator",
      reviewFingerprint: "a".repeat(64),
      idempotencyKey: "40000000-0000-4000-8000-000000000001",
    },
  });
  await worker.runOnce();
  expect(cleanup).toHaveBeenCalledWith(
    {
      instanceId,
      runId: "30000000-0000-4000-8000-000000000001",
      actor: "operator",
      workerId: "worker",
      expectedVersion: 3,
      reviewFingerprint: "a".repeat(64),
      idempotencyKey: "40000000-0000-4000-8000-000000000001",
      sourceAlias: "source",
      repositoryAlias: "repo",
    },
    expect.any(AbortSignal),
  );
  execute.mockResolvedValueOnce({ run: { id: "invalid" } });
  await expect(worker.runOnce()).rejects.toThrow();
  expect(cleanup).toHaveBeenCalledTimes(1);
});
it("propagates shutdown to task-owned cleanup only", async () => {
  const signal = new AbortController().signal;
  const execute = jest.fn().mockResolvedValue({
    run: { id: "30000000-0000-4000-8000-000000000001", version: 3 },
    execution: {
      configuration: { sourceAlias: "source", repositoryAlias: "repo" },
      actor: "operator",
      reviewFingerprint: "a".repeat(64),
      idempotencyKey: "40000000-0000-4000-8000-000000000001",
    },
  });
  const cleanup = jest.fn().mockResolvedValue(undefined);
  await new BackupCleanupWorker({
    instanceId,
    workerId: "worker",
    control: { execute },
    executor: { cleanup },
  }).runOnce(signal);
  expect(cleanup).toHaveBeenCalled();
});
