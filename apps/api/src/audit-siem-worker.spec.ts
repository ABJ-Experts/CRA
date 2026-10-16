import { bootstrapSiemWorker } from "./audit-siem-worker";
describe("SIEM worker bootstrap", () => {
  it("once closes context after idle", async () => {
    const close = jest.fn();
    const runOnce = jest.fn().mockResolvedValue("idle");
    await bootstrapSiemWorker({
      argv: ["--once"],
      createContext: () => Promise.resolve({ get: jest.fn(), close }),
      createWorker: () => ({ runOnce }),
      logger: { error: jest.fn() },
      sleep: jest.fn(),
    });
    expect(close).toHaveBeenCalled();
    expect(runOnce).toHaveBeenCalledTimes(1);
  });
  it("sanitizes failed cycle and closes", async () => {
    const close = jest.fn();
    const error = jest.fn();
    await bootstrapSiemWorker({
      argv: ["--once"],
      createContext: () => Promise.resolve({ get: jest.fn(), close }),
      createWorker: () => ({
        runOnce: jest.fn().mockRejectedValue(new Error("secret")),
      }),
      logger: { error },
      sleep: jest.fn(),
    });
    expect(error).toHaveBeenCalledWith("SIEM worker cycle unavailable");
    expect(close).toHaveBeenCalled();
  });
  it("continuous yields and closes on interruption", async () => {
    const close = jest.fn();
    const sleep = jest.fn().mockRejectedValue(new Error("stop"));
    await expect(
      bootstrapSiemWorker({
        argv: [],
        createContext: () => Promise.resolve({ get: jest.fn(), close }),
        createWorker: () => ({
          runOnce: jest.fn().mockResolvedValue("processed"),
        }),
        logger: { error: jest.fn() },
        sleep,
      }),
    ).rejects.toThrow("stop");
    expect(sleep).toHaveBeenCalledWith(0);
    expect(close).toHaveBeenCalled();
  });
});
