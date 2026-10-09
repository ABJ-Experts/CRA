import {
  bootstrapSupplierEvidenceReminderWorker,
  sleepForSupplierEvidenceReminderWorkerCycle,
} from "./supplier-evidence-reminder-worker";

describe("bootstrapSupplierEvidenceReminderWorker", () => {
  it("runs one safe worker cycle and closes the Nest context", async () => {
    const worker = { runOnce: jest.fn().mockResolvedValue(undefined) };
    const close = jest.fn().mockResolvedValue(undefined);

    await bootstrapSupplierEvidenceReminderWorker({
      argv: ["node", "worker", "--once"],
      logger: { error: jest.fn() },
      sleep: jest.fn().mockResolvedValue(undefined),
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close }),
      createWorker: () => worker as never,
    });

    expect(worker.runOnce).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed cycle retryable and closes its context", async () => {
    const logger = { error: jest.fn() };
    const close = jest.fn().mockResolvedValue(undefined);

    await bootstrapSupplierEvidenceReminderWorker({
      argv: ["node", "worker", "--once"],
      logger,
      sleep: jest.fn().mockResolvedValue(undefined),
      createApplicationContext: () =>
        Promise.resolve({ get: jest.fn(), close }),
      createWorker: () =>
        ({ runOnce: jest.fn().mockRejectedValue(new Error("queue")) }) as never,
    });

    expect(logger.error).toHaveBeenCalledWith(
      "Supplier evidence reminder worker cycle failed safely",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("uses a timer-backed delay for repeat cycles", async () => {
    jest.useFakeTimers();
    try {
      const promise = sleepForSupplierEvidenceReminderWorkerCycle(30_000);
      await jest.advanceTimersByTimeAsync(30_000);
      await expect(promise).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it("closes the context when a repeat-cycle delay fails", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const sleepFailure = new Error("timer unavailable");

    await expect(
      bootstrapSupplierEvidenceReminderWorker({
        argv: ["node", "worker"],
        logger: { error: jest.fn() },
        sleep: jest.fn().mockRejectedValue(sleepFailure),
        createApplicationContext: () =>
          Promise.resolve({ get: jest.fn(), close }),
        createWorker: () =>
          ({ runOnce: jest.fn().mockResolvedValue(undefined) }) as never,
      }),
    ).rejects.toBe(sleepFailure);

    expect(close).toHaveBeenCalledTimes(1);
  });
});
