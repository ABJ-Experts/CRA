import {
  bootstrapAuditRangeWorker,
  auditRangeWorkerFromContext,
} from "./audit-range-verify-worker";
import { SupabaseService } from "./supabase/supabase.service";
describe("range entrypoint", () => {
  it("runs once and closes context", async () => {
    const context = { get: jest.fn(), close: jest.fn() },
      runOnce = jest.fn().mockResolvedValue("idle"),
      sleep = jest.fn(),
      logger = { error: jest.fn() };
    await bootstrapAuditRangeWorker({
      argv: ["--once"],
      createContext: () => Promise.resolve(context),
      createWorker: () => ({ runOnce }),
      logger,
      sleep,
    });
    expect(runOnce).toHaveBeenCalledTimes(1);
    expect(context.close).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });
  it("sanitizes errors and preserves continuous lifecycle", async () => {
    const context = { get: jest.fn(), close: jest.fn() },
      runOnce = jest.fn().mockRejectedValue(new Error("secret bearer URL")),
      logger = { error: jest.fn() };
    await expect(
      bootstrapAuditRangeWorker({
        argv: [],
        createContext: () => Promise.resolve(context),
        createWorker: () => ({ runOnce }),
        logger,
        sleep: () => Promise.reject(new Error("stop")),
      }),
    ).rejects.toThrow("stop");
    expect(logger.error).toHaveBeenCalledWith(
      "Audit range worker cycle unavailable",
    );
    expect(context.close).toHaveBeenCalled();
  });
  it("closes after composition failure", async () => {
    const context = { get: jest.fn(), close: jest.fn() };
    await expect(
      bootstrapAuditRangeWorker({
        argv: ["--once"],
        createContext: () => Promise.resolve(context),
        createWorker: () => {
          throw new Error("composition");
        },
        logger: { error: jest.fn() },
        sleep: jest.fn(),
      }),
    ).rejects.toThrow("composition");
    expect(context.close).toHaveBeenCalled();
  });
  it("composes the installed repository", () => {
    const context = {
      get: jest.fn().mockReturnValue({ getClient: jest.fn() }),
      close: jest.fn(),
    };
    expect(auditRangeWorkerFromContext(context)).toBeDefined();
    expect(context.get).toHaveBeenCalledWith(SupabaseService);
  });
});
it.each([
  ["processed", 0],
  ["idle", 1000],
] as const)("yields %s cycles with %s milliseconds", async (outcome, delay) => {
  const sleep = jest.fn().mockRejectedValue(new Error("stop"));
  await expect(
    bootstrapAuditRangeWorker({
      argv: [],
      createContext: () =>
        Promise.resolve({ get: jest.fn(), close: jest.fn() }),
      createWorker: () => ({ runOnce: jest.fn().mockResolvedValue(outcome) }),
      logger: { error: jest.fn() },
      sleep,
    }),
  ).rejects.toThrow("stop");
  expect(sleep).toHaveBeenCalledWith(delay);
});
it("backs off after errors without exposing provider messages", async () => {
  const sleep = jest.fn().mockRejectedValue(new Error("stop")),
    logger = { error: jest.fn() };
  await expect(
    bootstrapAuditRangeWorker({
      argv: [],
      createContext: () =>
        Promise.resolve({ get: jest.fn(), close: jest.fn() }),
      createWorker: () => ({
        runOnce: jest.fn().mockRejectedValue(new Error("sensitive bearer")),
      }),
      logger,
      sleep,
    }),
  ).rejects.toThrow("stop");
  expect(sleep).toHaveBeenCalledWith(1000);
  expect(logger.error).toHaveBeenCalledWith(
    "Audit range worker cycle unavailable",
  );
});
