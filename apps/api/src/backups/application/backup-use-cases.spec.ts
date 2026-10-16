import { BackupUseCases } from "./backup-use-cases";
const instanceId = "20000000-0000-4000-8000-000000000001";
const identity = {
  fingerprint256: "AA",
  revision: "r1",
  principalId: "10000000-0000-4000-8000-000000000001",
  instanceIds: [instanceId],
  tenantScopes: [],
  backupScopes: [{ instanceId, actions: ["backups.view" as const] }],
};
it("checks identity and local instance before invoking control, preserving payload", async () => {
  const execute = jest.fn().mockResolvedValue({ value: true });
  const service = new BackupUseCases(instanceId, { execute });
  await expect(
    service.execute(identity, instanceId, "policy/read", "backups.view"),
  ).resolves.toEqual({ value: true });
  expect(execute).toHaveBeenCalledWith(
    instanceId,
    identity.principalId,
    "policy/read",
    {},
  );
  expect(() =>
    service.execute(identity, instanceId, "run/create", "backups.run"),
  ).toThrow();
  expect(execute).toHaveBeenCalledTimes(1);
});
it("allows verification cancellation only through verification authority and capture cancellation only through run authority", async () => {
  const row = {
    id: instanceId,
    instanceId,
    kind: "verification",
    parentRunId: instanceId,
    state: "running",
    stage: "restoring",
    progress: 20,
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
  const execute = jest
    .fn()
    .mockResolvedValueOnce(row)
    .mockResolvedValueOnce({ safe: true });
  const service = new BackupUseCases(instanceId, { execute });
  const verifier = {
    ...identity,
    backupScopes: [{ instanceId, actions: ["backups.verify" as const] }],
  };
  await expect(
    service.execute(verifier, instanceId, "run/cancel", "backups.run", {
      runId: instanceId,
    }),
  ).resolves.toEqual({ safe: true });
  const runner = {
    ...identity,
    backupScopes: [{ instanceId, actions: ["backups.run" as const] }],
  };
  execute.mockResolvedValueOnce(row);
  await expect(
    service.execute(runner, instanceId, "run/cancel", "backups.run", {
      runId: instanceId,
    }),
  ).rejects.toThrow("Backup scope unavailable");
  expect(() =>
    service.execute(identity, instanceId, "run/cancel", "backups.run", {
      runId: instanceId,
    }),
  ).toThrow("Backup scope unavailable");
  execute
    .mockResolvedValueOnce({ ...row, kind: "capture", parentRunId: null })
    .mockResolvedValueOnce({ cancelled: true });
  await expect(
    service.execute(runner, instanceId, "run/cancel", "backups.run", {
      runId: instanceId,
    }),
  ).resolves.toEqual({ cancelled: true });
});
