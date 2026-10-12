import {
  bootstrapExportsWorker,
  exportsWorkerFromContext,
} from "./exports-worker";
import {
  ExportWorker,
  safeExportWorkerFailure,
} from "./exports/worker/export-worker";
describe("filtered export worker entry", () => {
  it("runs once and always closes the application context", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const runOnce = jest.fn().mockResolvedValue("idle");
    const sleep = jest.fn();
    await bootstrapExportsWorker({
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
  it("redacts cycle failures and closes on loop cancellation", async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const error = jest.fn();
    await expect(
      bootstrapExportsWorker({
        argv: [],
        context: () => Promise.resolve({ get: jest.fn(), close }),
        worker: () => ({
          runOnce: jest.fn().mockRejectedValue(new Error("password secret")),
        }),
        sleep: () => Promise.reject(new Error("stopped")),
        logger: { error },
      }),
    ).rejects.toThrow("stopped");
    expect(error).toHaveBeenCalledWith(
      "Filtered export worker failed code=generation_failed",
    );
    expect(close).toHaveBeenCalled();
  });
  it("composes the worker with the current Supabase service", () => {
    expect(
      exportsWorkerFromContext({ get: jest.fn(), close: jest.fn() }),
    ).toBeInstanceOf(ExportWorker);
    expect(safeExportWorkerFailure(null)).toBe("generation_failed");
    expect(safeExportWorkerFailure(new Error("access_changed"))).toBe(
      "access_changed",
    );
  });
});
