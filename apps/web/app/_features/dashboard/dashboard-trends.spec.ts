import { describe, expect, it, vi } from "vitest";
import { DashboardGateway } from "./dashboard-gateway";
import {
  defaultTrendFilters,
  trendReason,
  trendValue,
  trendDate,
} from "./dashboard-trends-policy";

describe("reproducible trend boundary", () => {
  it("defaults to thirty UTC calendar days without local DST arithmetic", () => {
    expect(defaultTrendFilters(new Date("2028-03-01T01:00:00Z"))).toEqual({
      from: "2028-02-01",
      to: "2028-03-01",
      timezone: "UTC",
      bucket: "day",
    });
  });
  it("distinguishes unavailable from actual zero and formats units", () => {
    expect(trendValue(null)).toBe("Unavailable");
    expect(trendValue(0)).toBe("0");
    expect(trendValue(12.345)).toBe("12.35");
    expect(trendDate("2028-03-01T00:00:00Z", "UTC")).toContain("2028");
  });
  it("parses trend filters before authenticated GET transport", async () => {
    const transport = vi.fn();
    const gateway = new DashboardGateway(transport);
    await gateway.trends({
      from: "2024-02-01",
      to: "2024-03-01",
      timezone: "UTC",
      bucket: "day",
    });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("/api/v1/dashboard/trends?"),
      }),
    );
    expect(() =>
      gateway.trends({
        from: "2024-02-01",
        to: "2024-03-01",
        timezone: "invalid",
      }),
    ).toThrow();
  });
  it("pins source queries to the encrypted dataset and bounds paging", async () => {
    const transport = vi.fn();
    const gateway = new DashboardGateway(transport);
    await gateway.trendSources({ datasetToken: "opaque", metric: "activity" });
    expect(transport).toHaveBeenCalledWith(
      expect.objectContaining({
        path: expect.stringContaining("datasetToken=opaque"),
      }),
    );
    expect(() =>
      gateway.trendSources({
        datasetToken: "opaque",
        metric: "activity",
        limit: 101,
      }),
    ).toThrow();
  });
});

it("translates known reason codes and sanitizes unknown reasons", () => {
  expect(trendReason("select_product")).toBe(
    "Select a product to view its duration and readiness history.",
  );
  expect(trendReason("history_unavailable")).toBe(
    "Historical capture has not started for this source. Earlier observations are unavailable.",
  );
  expect(trendReason("source_permission_required")).toBe(
    "You do not have access to the source records for this metric.",
  );
  expect(trendReason("snapshot_source_permission_required")).toBe(
    "Some historical snapshot sources are restricted for your account.",
  );
  expect(trendReason("unexpected_backend_secret")).toBe(
    "Historical observations unavailable.",
  );
  expect(trendReason(null)).toBeNull();
});
it("exports the pinned token through authenticated bounded CSV transport", async () => {
  const fetcher = vi
    .fn()
    .mockResolvedValue(
      new Response("metric,value\nactivity,0", {
        headers: { "content-type": "text/csv;charset=utf-8" },
      }),
    );
  vi.stubGlobal("fetch", fetcher);
  try {
    await expect(new DashboardGateway().trendExport("opaque")).resolves.toBe(
      "metric,value\nactivity,0",
    );
    expect(fetcher).toHaveBeenCalledWith(
      "/api/v1/dashboard/trends/export?datasetToken=opaque",
      expect.objectContaining({
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
      }),
    );
  } finally {
    vi.unstubAllGlobals();
  }
});
