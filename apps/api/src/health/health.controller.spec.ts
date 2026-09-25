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
    );

    await expect(controller.readiness()).resolves.toEqual({ status, database });
    expect(ping).toHaveBeenCalledTimes(1);
  });

  it("degrades readiness for a critical reporting deadline monitor", async () => {
    const controller = new HealthController(
      { ping: jest.fn().mockResolvedValue(true) } as never,
      { isReady: jest.fn().mockResolvedValue(false) } as never,
    );

    await expect(controller.readiness()).resolves.toEqual({
      status: "degraded",
      database: true,
    });
  });
});
