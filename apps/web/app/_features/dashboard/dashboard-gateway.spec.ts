import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DashboardGateway } from "./dashboard-gateway";
const transport = vi.fn();
const gateway = new DashboardGateway(transport);
beforeEach(() => transport.mockReset());
afterEach(() => vi.unstubAllGlobals());
describe("DashboardGateway", () => {
  it("uses authenticated versioned GETs and propagates cancellation", async () => {
    const signal = new AbortController().signal;
    await gateway.overview(signal);
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/api/v1/dashboard/overview", signal }),
    );
    await gateway.posture("11111111-1111-4111-8111-111111111111", signal);
    expect(transport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/api/v1/dashboard/products/11111111-1111-4111-8111-111111111111/posture",
        signal,
      }),
    );
    await gateway.obligations({ state: "history", limit: 30 }, signal);
    expect(transport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/api/v1/dashboard/obligations?limit=30&state=history",
        signal,
      }),
    );
    await gateway.readiness({}, signal);
    expect(transport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/api/v1/dashboard/readiness?limit=20",
        signal,
      }),
    );
    await gateway.ingestion({ cursor: "opaque", limit: 100 }, signal);
    expect(transport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        path: "/api/v1/dashboard/ingestion?cursor=opaque&limit=100",
        signal,
      }),
    );
  });
  it("refreshes GET401 and parses the retried dashboard response", async () => {
    const timestamp = "2026-10-07T12:00:00Z";
    const hidden = { state: "restricted", observedAt: null, updatedAt: null };
    const projection = {
      organizationId: "11111111-1111-4111-8111-111111111111",
      serverNow: timestamp,
      generatedAt: timestamp,
      products: hidden,
      findings: hidden,
      obligations: hidden,
      readiness: hidden,
      sbomCoverage: hidden,
      ingestion: hidden,
      feedFreshness: hidden,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Session expired" }), {
          status: 401,
        }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(projection), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetcher);
    await expect(new DashboardGateway().overview()).resolves.toEqual(
      projection,
    );
    expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
      "/api/v1/dashboard/overview",
      "/api/v1/auth/refresh",
      "/api/v1/dashboard/overview",
    ]);
  });
  it("rejects malformed paths and queries before transport", () => {
    expect(() => gateway.posture("../foreign")).toThrow();
    expect(() => gateway.readiness({ limit: 101 })).toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
