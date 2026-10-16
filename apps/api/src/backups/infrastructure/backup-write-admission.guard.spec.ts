import { BackupWriteAdmissionGuard } from "./backup-write-admission.guard";
const instanceId = "20000000-0000-4000-8000-000000000001";
const context = (method = "POST") =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({ method }),
      getResponse: () => ({ setHeader: jest.fn() }),
    }),
  }) as never;
it("pauses new unsafe requests while leaving reads and the native fence authoritative", async () => {
  const abortSignal = jest.fn().mockResolvedValue({
    data: {
      configured: true,
      paused: true,
      until: new Date(Date.now() + 5000).toISOString(),
    },
    error: null,
  });
  const rpc = jest.fn().mockReturnValue({ abortSignal });
  const guard = new BackupWriteAdmissionGuard(
    { admin: () => ({ rpc }) } as never,
    { get: () => instanceId } as never,
  );
  await expect(guard.canActivate(context("GET"))).resolves.toBe(true);
  expect(rpc).not.toHaveBeenCalled();
  await expect(guard.canActivate(context())).rejects.toThrow(
    "Writes are temporarily paused for a certified backup",
  );
  await expect(guard.canActivate(context())).rejects.toThrow();
  expect(rpc).toHaveBeenCalledTimes(1);
});
it("fails closed on unknown configured authority and remains compatible without instance enrollment", async () => {
  const absent = new BackupWriteAdmissionGuard(
    {} as never,
    { get: () => undefined } as never,
  );
  await expect(absent.canActivate(context())).resolves.toBe(true);
  const rpc = jest.fn().mockReturnValue({
    abortSignal: () => Promise.resolve({ error: { password: "canary" } }),
  });
  const guard = new BackupWriteAdmissionGuard(
    { admin: () => ({ rpc }) } as never,
    { get: () => instanceId } as never,
  );
  await expect(guard.canActivate(context())).rejects.toThrow(
    "Backup write admission unavailable",
  );
  rpc.mockReturnValueOnce({
    abortSignal: () =>
      Promise.resolve({
        data: { configured: true, paused: false, until: null },
        error: null,
      }),
  });
  await expect(guard.canActivate(context())).resolves.toBe(true);
});
it("does not extend the server deadline while an admission response is in flight", async () => {
  jest.useFakeTimers();
  const started = Date.now();
  const rpc = jest.fn().mockReturnValue({
    abortSignal: () => {
      jest.setSystemTime(started + 150);
      return Promise.resolve({
        data: {
          configured: true,
          paused: true,
          until: new Date(started + 100).toISOString(),
        },
        error: null,
      });
    },
  });
  const guard = new BackupWriteAdmissionGuard(
    { admin: () => ({ rpc }) } as never,
    { get: () => instanceId } as never,
  );
  try {
    await expect(guard.canActivate(context())).resolves.toBe(true);
  } finally {
    jest.useRealTimers();
  }
});
