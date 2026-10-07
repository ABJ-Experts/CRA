/* eslint-disable @typescript-eslint/require-await */
import {
  bootstrapAuditExportWorker,
  sleepForAuditExportWorkerCycle,
  workerFromContext,
  safeWorkerErrorCode,
} from "./audit-export-worker";

describe("audit export worker bootstrap", () => {
  it("runs once and closes the Nest application context", async () => {
    const close = jest.fn(async () => undefined);
    const runOnce = jest.fn(async () => "idle" as const);
    await bootstrapAuditExportWorker({
      argv: ["node", "worker", "--once"],
      createApplicationContext: async () => ({ get: jest.fn(), close }),
      createWorker: () => ({ runOnce }) as never,
      logger: { error: jest.fn() },
      sleep: jest.fn(),
    });
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("logs safe cycle failures and still closes", async () => {
    const close = jest.fn(async () => undefined);
    const logger = { error: jest.fn() };
    await bootstrapAuditExportWorker({
      argv: ["node", "worker", "--once"],
      createApplicationContext: async () => ({ get: jest.fn(), close }),
      createWorker: () =>
        ({
          runOnce: jest.fn(async () => {
            throw new Error("provider_unavailable");
          }),
        }) as never,
      logger,
      sleep: jest.fn(),
    });
    expect(logger.error).toHaveBeenCalledWith(
      "Audit export worker cycle failed safely code=provider_unavailable",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("exposes the worker sleep helper", async () => {
    await expect(sleepForAuditExportWorkerCycle(0)).resolves.toBeUndefined();
  });

  it("builds the concrete worker from the application context", () => {
    const worker = workerFromContext({
      get: jest.fn(() => ({})),
      close: jest.fn(),
    });
    expect(worker).toHaveProperty("runOnce");
  });

  it("sleeps between repeated cycles when not running once", async () => {
    const close = jest.fn(async () => undefined);
    await expect(
      bootstrapAuditExportWorker({
        argv: ["node", "worker"],
        createApplicationContext: async () => ({ get: jest.fn(), close }),
        createWorker: () =>
          ({ runOnce: jest.fn(async () => "idle" as const) }) as never,
        logger: { error: jest.fn() },
        sleep: jest.fn(async () => {
          throw new Error("stop loop");
        }),
      }),
    ).rejects.toThrow("stop loop");
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("logs only allowlisted worker error codes", async () => {
    expect(safeWorkerErrorCode(new Error("provider_unavailable"))).toBe(
      "provider_unavailable",
    );
    expect(
      safeWorkerErrorCode(
        new Error("https://storage.local/download?token=bad-secret"),
      ),
    ).toBe("unknown");

    const close = jest.fn(async () => undefined);
    const logger = { error: jest.fn() };
    await bootstrapAuditExportWorker({
      argv: ["node", "worker", "--once"],
      createApplicationContext: async () => ({ get: jest.fn(), close }),
      createWorker: () =>
        ({
          runOnce: jest.fn(async () => {
            throw new Error("Bearer bad-secret https://storage.local/path?q=1");
          }),
        }) as never,
      logger,
      sleep: jest.fn(),
    });
    const calls = logger.error.mock.calls as Array<readonly [unknown]>;
    const loggedValue = calls[0]?.[0];
    expect(typeof loggedValue).toBe("string");
    const logged = typeof loggedValue === "string" ? loggedValue : "";
    expect(logged).toBe("Audit export worker cycle failed safely code=unknown");
    expect(logged).not.toContain("bad-secret");
    expect(logged).not.toContain("storage.local");
    expect(logged).not.toContain("Bearer");
  });
});
