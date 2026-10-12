import {
  bootstrapReportsWorker,
  reportsWorkerFromContext,
} from "./reports-worker";
import {
  ReportsWorker,
  safeReportWorkerFailure,
} from "./reports/worker/reports-worker";

describe("scheduled report worker entry", () => {
  it("runs once and always closes the application context", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const runOnce = jest.fn().mockResolvedValue("idle");
    const sleep = jest.fn();
    await bootstrapReportsWorker({
      argv: ["--once"],
      context: () => Promise.resolve({ get: jest.fn(), close }),
      worker: () => ({ runOnce }),
      sleep,
      logger: { error: jest.fn() },
    });
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("logs only a safe failure code and closes after loop interruption", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn();
    await expect(
      bootstrapReportsWorker({
        argv: [],
        context: () => Promise.resolve({ get: jest.fn(), close }),
        worker: () => ({
          runOnce: jest
            .fn()
            .mockRejectedValue(new Error("provider private message")),
        }),
        sleep: () => Promise.reject(new Error("stopped")),
        logger: { error },
      }),
    ).rejects.toThrow("stopped");
    expect(error).toHaveBeenCalledWith(
      "Scheduled reports worker failed code=generation_failed",
    );
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("composes a source-aware worker without synthetic request identity", () => {
    expect(
      reportsWorkerFromContext({ get: jest.fn(), close: jest.fn() }),
    ).toBeInstanceOf(ReportsWorker);
    expect(safeReportWorkerFailure(null)).toBe("generation_failed");
  });
});
