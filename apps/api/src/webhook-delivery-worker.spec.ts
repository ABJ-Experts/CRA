jest.mock("./app.module", () => ({ AppModule: class FixtureModule {} }));
import { NestFactory } from "@nestjs/core";
import { Logger } from "@nestjs/common";
import { runWebhookWorker, failWebhookWorker } from "./webhook-delivery-worker";
import type { INestApplicationContext } from "@nestjs/common";
describe("webhook worker entry lifecycle", () => {
  it("uses process arguments by default and observes SIGINT", async () => {
    const tick = jest.fn().mockImplementation(() => {
      process.emit("SIGINT");
      return Promise.resolve(1);
    });
    const close = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(NestFactory, "createApplicationContext").mockResolvedValue({
      get: () => ({ tick }),
      close,
    } as unknown as INestApplicationContext);
    await runWebhookWorker();
    expect(close).toHaveBeenCalled();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
    process.exitCode = undefined;
  });
  it("runs a single bounded cycle and closes context", async () => {
    const tick = jest.fn().mockResolvedValue(1),
      close = jest.fn().mockResolvedValue(undefined);
    const app = { get: () => ({ tick }), close };
    jest
      .spyOn(NestFactory, "createApplicationContext")
      .mockResolvedValue(app as unknown as INestApplicationContext);
    const listeners = process.listenerCount("SIGTERM");
    await runWebhookWorker(["--once"]);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalledTimes(1);
    expect(process.listenerCount("SIGTERM")).toBe(listeners);
  });
  it("reports provider outage with fixed safe diagnostics", async () => {
    const tick = jest
        .fn()
        .mockRejectedValue(new Error("credential-secret-canary")),
      close = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(NestFactory, "createApplicationContext").mockResolvedValue({
      get: () => ({ tick }),
      close,
    } as unknown as INestApplicationContext);
    const log = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    await runWebhookWorker(["--once"]);
    expect(log).toHaveBeenCalledWith("Webhook delivery cycle failed safely");
    expect(JSON.stringify(log.mock.calls)).not.toContain("canary");
    expect(close).toHaveBeenCalled();
  });
  it("finishes current work and stops on SIGTERM without another cycle", async () => {
    const tick = jest.fn().mockImplementation(() => {
      process.emit("SIGTERM");
      return Promise.resolve(1);
    });
    const close = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(NestFactory, "createApplicationContext").mockResolvedValue({
      get: () => ({ tick }),
      close,
    } as unknown as INestApplicationContext);
    await runWebhookWorker([]);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(close).toHaveBeenCalled();
  });
  it("waits between cycles and obeys shutdown", async () => {
    jest.useFakeTimers();
    const tick = jest.fn().mockResolvedValue(1),
      close = jest.fn().mockResolvedValue(undefined);
    jest.spyOn(NestFactory, "createApplicationContext").mockResolvedValue({
      get: () => ({ tick }),
      close,
    } as unknown as INestApplicationContext);
    const run = runWebhookWorker([]);
    await jest.advanceTimersByTimeAsync(1);
    expect(tick).toHaveBeenCalledTimes(1);
    process.emit("SIGTERM");
    await jest.advanceTimersByTimeAsync(1000);
    await run;
    expect(close).toHaveBeenCalled();
  });
  it("fails startup with fixed logging and nonzero exit status", () => {
    const log = jest
      .spyOn(Logger.prototype, "error")
      .mockImplementation(() => undefined);
    failWebhookWorker();
    expect(log).toHaveBeenCalledWith("Webhook worker startup failed safely");
    expect(process.exitCode).toBe(1);
  });
});
