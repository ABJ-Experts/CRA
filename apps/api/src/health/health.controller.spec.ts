import { HealthController } from "./health.controller";

describe("HealthController", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("returns rounded process uptime for liveness", () => {
    jest.spyOn(process, "uptime").mockReturnValue(42.6);
    const controller = new HealthController(
      { ping: jest.fn() } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
    );

    expect(controller.liveness()).toEqual({ status: "ok", uptime: 43 });
  });

  it.each([
    [true, "ok"],
    [false, "degraded"],
  ] as const)("maps database readiness %p to %s", async (database, status) => {
    const ping = jest.fn().mockResolvedValue(database);
    const controller = new HealthController(
      { ping } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
    );

    await expect(controller.readiness()).resolves.toEqual({
      status,
      database,
      audit: database,
    });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("degrades readiness for a critical reporting deadline monitor", async () => {
    const controller = new HealthController(
      { ping: jest.fn().mockResolvedValue(true) } as never,
      { isReady: jest.fn().mockResolvedValue(false) } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
    );

    await expect(controller.readiness()).resolves.toEqual({
      status: "degraded",
      database: true,
      audit: true,
    });
  });

  it("degrades readiness when audit capture is unavailable", async () => {
    const controller = new HealthController(
      { ping: jest.fn().mockResolvedValue(true) } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
      { isReady: jest.fn().mockResolvedValue(false) } as never,
    );

    await expect(controller.readiness()).resolves.toEqual({
      status: "degraded",
      database: true,
      audit: false,
    });
  });
});

describe("public readiness transport cancellation", () => {
  it("cancels hung database IO without changing the frozen response", async () => {
    const ping = jest.fn(
      (signal?: AbortSignal) =>
        new Promise<boolean>((resolve) => {
          signal?.addEventListener("abort", () => resolve(false));
        }),
    );
    const monitor = { isReady: jest.fn() };
    const audit = { isReady: jest.fn() };
    const controller = new HealthController(
      { ping } as never,
      monitor as never,
      audit as never,
    );
    const result = controller.readiness();
    expect(ping.mock.calls[0]?.[0]).toBeInstanceOf(AbortSignal);
    await expect(result).resolves.toEqual({
      status: "degraded",
      database: false,
      audit: false,
    });
    expect(monitor.isReady).not.toHaveBeenCalled();
    expect(audit.isReady).not.toHaveBeenCalled();
  });
  it("isolates downstream transport errors", async () => {
    const controller = new HealthController(
      { ping: jest.fn().mockResolvedValue(true) } as never,
      { isReady: jest.fn().mockRejectedValue(new Error("private")) } as never,
      { isReady: jest.fn().mockResolvedValue(true) } as never,
    );
    await expect(controller.readiness()).resolves.toEqual({
      status: "degraded",
      database: true,
      audit: true,
    });
  });
});
