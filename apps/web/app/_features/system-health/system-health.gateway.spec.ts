import { afterEach, describe, expect, it, vi } from "vitest";
import { SystemHealthGateway } from "./system-health.gateway";
import { healthFixture, healthOrg } from "./system-health.fixture";

describe("customer health boundary", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("uses the authenticated central GET boundary and cancellation", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json(healthFixture));
    vi.stubGlobal("fetch", fetcher);
    const controller = new AbortController();
    expect(
      await new SystemHealthGateway().read(healthOrg, controller.signal),
    ).toEqual(healthFixture);
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/system/health",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        signal: controller.signal,
      }),
    );
  });
  it("rejects private fields and foreign tenant responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ ...healthFixture, privateHost: "private" }),
        ),
    );
    await expect(
      new SystemHealthGateway().read(healthOrg),
    ).rejects.toMatchObject({ kind: "invalid_response" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(healthFixture)),
    );
    await expect(
      new SystemHealthGateway().read("22222222-2222-4222-8222-222222222222"),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("propagates server authorization failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json({ message: "Forbidden" }, { status: 403 }),
        ),
    );
    await expect(
      new SystemHealthGateway().read(healthOrg),
    ).rejects.toMatchObject({ status: 403 });
  });
});
