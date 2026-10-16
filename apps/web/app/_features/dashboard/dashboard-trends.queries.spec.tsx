// @vitest-environment jsdom
import { cleanup, renderHook, waitFor, act } from "@testing-library/react";
import {
  QueryClient,
  QueryClientProvider,
  focusManager,
} from "@tanstack/react-query";
import type { ReactNode } from "react";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
const mock = vi.hoisted(() => ({
  trends: vi.fn(),
  trendSources: vi.fn(),
  trendExport: vi.fn(),
  list: vi.fn(),
}));
vi.mock("./dashboard-gateway", () => ({
  DashboardGateway: class {
    trends = mock.trends;
    trendSources = mock.trendSources;
    trendExport = mock.trendExport;
  },
}));
vi.mock("../products/products.api", () => ({
  productsApi: { list: mock.list },
}));
import {
  useDashboardTrends,
  useDashboardTrendSources,
  useDashboardTrendProducts,
  downloadDashboardTrends,
} from "./dashboard-trends.queries";
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
const filters = {
  from: "2026-10-01",
  to: "2026-10-08",
  timezone: "UTC",
  bucket: "day" as const,
};
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.resetAllMocks();
  mock.trends.mockResolvedValue({
    organizationId: "org",
    datasetToken: "token",
  });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  focusManager.setFocused(undefined);
});
describe("trend scoped query lifecycle", () => {
  it("pauses fresh dataset polling while retaining periodic pinned-source authorization and window focus checks", async () => {
    mock.trendSources.mockResolvedValue({ items: [], nextCursor: null });
    vi.useFakeTimers();
    const hooks = renderHook(
      ({ paused }) => ({
        trends: useDashboardTrends(filters, '["org"]', true, paused),
        sources: useDashboardTrendSources(
          "token",
          "activity",
          "cursor",
          '["org"]',
          true,
        ),
      }),
      { wrapper, initialProps: { paused: true } },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(hooks.result.current.sources.isSuccess).toBe(true);
    expect(hooks.result.current.trends.isSuccess).toBe(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(mock.trends).toHaveBeenCalledTimes(1);
    expect(mock.trendSources).toHaveBeenCalledTimes(2);
    hooks.rerender({ paused: false });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(mock.trends).toHaveBeenCalledTimes(2);
    expect(mock.trendSources).toHaveBeenCalledTimes(3);
    await act(async () => {
      focusManager.setFocused(false);
      focusManager.setFocused(true);
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(mock.trends).toHaveBeenCalledTimes(3);
    expect(mock.trendSources).toHaveBeenCalledTimes(4);
    mock.trendSources.mockRejectedValue(
      new ApiClientError("api", "revoked", 403),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_001);
    });
    expect(hooks.result.current.sources.data).toBeUndefined();
    expect(client.getQueryData(["dashboard-access", '["org"]'])).toBe(true);
  });
  it("fetches pinned facts and removes departed tenant cache", async () => {
    const { result, rerender } = renderHook(
      ({ scope, enabled }) => useDashboardTrends(filters, scope, enabled),
      { wrapper, initialProps: { scope: '["org"]', enabled: true } },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(mock.trends).toHaveBeenCalledWith(filters, expect.any(AbortSignal));
    rerender({ scope: '["other"]', enabled: false });
    expect(result.current.data).toBeUndefined();
    await waitFor(() =>
      expect(
        client.getQueriesData({ queryKey: ["dashboard", '["org"]'] }),
      ).toEqual([]),
    );
  });
  it("rejects foreign scope and definite denials without retaining data", async () => {
    mock.trends.mockResolvedValue({ organizationId: "foreign" });
    const { result } = renderHook(
      () => useDashboardTrends(filters, '["org"]', true),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    mock.trends.mockRejectedValue(new ApiClientError("api", "denied", 403));
    await act(() => result.current.refetch());
    expect(client.getQueryData(["dashboard-access", '["org"]'])).toBe(true);
  });
  it("authorizes source paging and product choices within the same scoped cache", async () => {
    mock.trendSources.mockResolvedValue({ items: [] });
    mock.list.mockResolvedValue({ products: { rows: [] } });
    const source = renderHook(
      () =>
        useDashboardTrendSources(
          "token",
          "activity",
          "cursor",
          '["org"]',
          true,
        ),
      { wrapper },
    );
    const product = renderHook(
      () => useDashboardTrendProducts('["org"]', true, " needle "),
      { wrapper },
    );
    await waitFor(() => expect(source.result.current.isSuccess).toBe(true));
    await waitFor(() => expect(product.result.current.isSuccess).toBe(true));
    expect(mock.trendSources).toHaveBeenCalledWith(
      { datasetToken: "token", metric: "activity", cursor: "cursor" },
      expect.any(AbortSignal),
    );
    expect(mock.list).toHaveBeenCalledWith(
      { page: 1, pageSize: 100, q: "needle" },
      expect.any(AbortSignal),
    );
  });
  it("downloads CSV only after successful authorization and releases its URL", async () => {
    mock.trendExport.mockResolvedValue("metric,value\na,0");
    const create = vi.fn().mockReturnValue("blob:export"),
      revoke = vi.fn();
    vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: revoke });
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    await downloadDashboardTrends("token");
    expect(click).toHaveBeenCalled();
    await waitFor(() => expect(revoke).toHaveBeenCalledWith("blob:export"));
    mock.trendExport.mockRejectedValue(
      new ApiClientError("api", "denied", 403),
    );
    const { result } = renderHook(
      () => useDashboardTrends(filters, '["org"]', false),
      { wrapper },
    );
    await expect(result.current.exportDataset("token")).rejects.toThrow(
      "denied",
    );
    expect(client.getQueryData(["dashboard-access", '["org"]'])).toBe(true);
  });
});
it("does not download a CSV completed after its scope was canceled", async () => {
  mock.trendExport.mockResolvedValue("csv");
  const controller = new AbortController();
  controller.abort();
  await expect(
    downloadDashboardTrends("token", controller.signal),
  ).rejects.toMatchObject({ name: "AbortError" });
});
