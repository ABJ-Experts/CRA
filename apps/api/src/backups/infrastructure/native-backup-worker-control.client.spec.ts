import { NativeBackupWorkerControlClient } from "./native-backup-worker-control.client";
const instanceId = "20000000-0000-4000-8000-000000000001";
const source = {
  databaseContainer: "backup_source",
  databaseName: "postgres",
  databaseUser: "postgres",
};
it("keeps executor control on a narrow native connection independent of the pooled API", async () => {
  const run = jest
    .fn()
    .mockResolvedValue(
      JSON.stringify({ outcome: "ok", result: { version: 1 } }),
    );
  const client = new NativeBackupWorkerControlClient(instanceId, source, {
    run,
  } as never);
  await expect(
    client.execute(instanceId, "backup-worker:worker", "run/heartbeat", {
      runId: instanceId,
      workerId: "worker",
      expectedVersion: 1,
    }),
  ).resolves.toEqual({ version: 1 });
  expect(run).toHaveBeenCalledWith(
    "docker",
    expect.arrayContaining(["exec", "-i", "backup_source", "psql"]),
    expect.any(AbortSignal),
    expect.stringContaining("SET LOCAL ROLE cra_backup_control"),
    1024 * 1024,
  );
});
it("bounds and escapes input, rejects another instance, and preserves only closed outcomes", async () => {
  const run = jest.fn().mockResolvedValue(JSON.stringify({ outcome: "empty" }));
  const client = new NativeBackupWorkerControlClient(instanceId, source, {
    run,
  } as never);
  await expect(
    client.execute(instanceId, "backup-worker:worker", "run/claim"),
  ).resolves.toBeNull();
  await expect(
    client.execute(
      "30000000-0000-4000-8000-000000000001",
      "backup-worker:worker",
      "policy/read",
    ),
  ).rejects.toThrow("configuration_invalid");
  await expect(
    client.execute(instanceId, "actor'; select secret;--", "policy/read"),
  ).rejects.toThrow("configuration_invalid");
  await expect(
    client.execute(instanceId, "worker", "policy/read", {
      large: "x".repeat(65536),
    }),
  ).rejects.toThrow("configuration_invalid");
  await client.execute(instanceId, "worker", "policy/read", {
    candidate: "'; select secret;--",
  });
  expect((run.mock.calls[1] as unknown[])[3]).toEqual(
    expect.stringContaining("''; select secret;--"),
  );
  for (const [outcome, code] of [
    ["conflict", "lease_lost"],
    ["blocked", "retention_authority_unavailable"],
    ["not_found", "authorization_changed"],
    ["invalid", "configuration_invalid"],
    ["unknown", "source_unavailable"],
  ]) {
    run.mockResolvedValueOnce(
      JSON.stringify({ outcome, result: { token: "canary" } }),
    );
    await expect(
      client.execute(instanceId, "worker", "run/read"),
    ).rejects.toThrow(code);
  }
  run.mockResolvedValueOnce("raw-secret-canary");
  await expect(
    client.execute(instanceId, "worker", "run/read"),
  ).rejects.toThrow("source_unavailable");
  run.mockRejectedValueOnce(new Error("raw-secret-canary"));
  await expect(
    client.execute(instanceId, "worker", "run/read"),
  ).rejects.not.toThrow("canary");
  run.mockResolvedValueOnce(
    JSON.stringify({
      outcome: "ok",
      result: { id: "run" },
      execution: { configuration: {} },
    }),
  );
  await expect(
    client.execute(instanceId, "worker", "run/claim"),
  ).resolves.toEqual({ run: { id: "run" }, execution: { configuration: {} } });
  const abort = new AbortController();
  abort.abort();
  run.mockRejectedValueOnce(new Error("aborted"));
  await expect(
    client.execute(instanceId, "worker", "run/cancel", {}, abort.signal),
  ).rejects.toThrow("source_unavailable");
});
it("requires an explicit mounted source when more than one is available", () => {
  const { backupWorkerControlSource } = jest.requireActual<
    typeof import("./native-backup-worker-control.client")
  >("./native-backup-worker-control.client");
  const runtime = { sources: { one: source, two: source } } as never;
  expect(() => backupWorkerControlSource(runtime)).toThrow(
    "configuration_invalid",
  );
  expect(() => backupWorkerControlSource(runtime, "missing")).toThrow(
    "configuration_invalid",
  );
  expect(backupWorkerControlSource(runtime, "two")).toEqual(source);
  expect(
    backupWorkerControlSource({ sources: { one: source } } as never),
  ).toEqual(source);
  expect(
    () =>
      new NativeBackupWorkerControlClient(instanceId, {
        ...source,
        databaseContainer: "bad;exec",
      }),
  ).toThrow();
});
