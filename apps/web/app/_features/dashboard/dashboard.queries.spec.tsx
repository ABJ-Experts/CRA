// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../_lib/http/api-client";
const state = vi.hoisted(() => ({
  session: { organization: { id: "tenant-a" }, user: { id: "user-a" } },
  permissions: { can_view_dashboards: true, can_view_products: true },
  isLoading: false,
  isError: false,
}));
const gateway = vi.hoisted(() => ({ overview: vi.fn(), posture: vi.fn() }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => state,
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: () => true }));
vi.mock("./dashboard-gateway", () => ({
  DashboardGateway: class {
    overview = gateway.overview;
    posture = gateway.posture;
  },
}));
import { revokeDashboardScope } from "./dashboard-access";
import { useDashboardQuery } from "./dashboard.queries";
let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);
beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  state.session = { organization: { id: "tenant-a" }, user: { id: "user-a" } };
  state.permissions = { can_view_dashboards: true, can_view_products: true };
  state.isLoading = false;
  state.isError = false;
  gateway.overview.mockReset().mockResolvedValue({
    organizationId: "tenant-a",
    serverNow: "2026-10-07T00:00:00Z",
  });
  gateway.posture.mockReset().mockResolvedValue({ organizationId: "tenant-a" });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllEnvs();
});
describe("dashboard scoped query", () => {
  it("reads authenticated organization evidence with cancellation and freshness", async () => {
    const { result } = renderHook(() => useDashboardQuery(), { wrapper });
    await waitFor(() =>
      expect(result.current.data?.projection.organizationId).toBe("tenant-a"),
    );
    expect(gateway.overview).toHaveBeenCalledWith(expect.any(AbortSignal));
    expect(result.current.stale).toBe(false);
  });
  it("reads product posture only with product and dashboard access", async () => {
    const { result, rerender } = renderHook(
      () => useDashboardQuery("product"),
      { wrapper },
    );
    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(gateway.posture).toHaveBeenCalledWith(
      "product",
      expect.any(AbortSignal),
    );
    state.permissions = { ...state.permissions, can_view_products: false };
    rerender();
    await waitFor(() => expect(result.current.data).toBeUndefined());
  });
  it("rejects foreign response scope", async () => {
    gateway.overview.mockResolvedValue({ organizationId: "tenant-b" });
    const { result } = renderHook(() => useDashboardQuery(), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toBeInstanceOf(ApiClientError);
  });
  it("clears old tenant evidence and aborts outstanding requests on scope change", async () => {
    const { result, rerender } = renderHook(() => useDashboardQuery(), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toBeDefined());
    const oldScope = result.current.scope;
    state.session = {
      organization: { id: "tenant-b" },
      user: { id: "user-a" },
    };
    gateway.overview.mockImplementation(() => new Promise(() => {}));
    rerender();
    expect(result.current.data).toBeUndefined();
    await waitFor(() =>
      expect(
        client.getQueriesData({ queryKey: ["dashboard", oldScope] }),
      ).toEqual([]),
    );
  });
  it("retains same-scope data on transient failure but clears definitive denials", async () => {
    const { result } = renderHook(() => useDashboardQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    gateway.overview.mockRejectedValue(
      new ApiClientError("network", "Offline"),
    );
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.stale).toBe(true));
    expect(result.current.data).toBeDefined();
    gateway.overview.mockRejectedValue(
      new ApiClientError("api", "Denied", 403),
    );
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => expect(result.current.data).toBeUndefined());
  });
  it("erases parent evidence when another dashboard page receives an authorization denial", async () => {
    const { result } = renderHook(() => useDashboardQuery(), { wrapper });
    await waitFor(() => expect(result.current.data).toBeDefined());
    act(() => revokeDashboardScope(client, result.current.scope));
    await waitFor(() => expect(result.current.enabled).toBe(false));
    expect(result.current.data).toBeUndefined();
  });
  it("gates mock, pending and errored identity", () => {
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    const { result, rerender } = renderHook(() => useDashboardQuery(), {
      wrapper,
    });
    expect(result.current.enabled).toBe(false);
    expect(result.current.live).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
    state.isLoading = true;
    rerender();
    expect(result.current.sessionLoading).toBe(true);
    state.isLoading = false;
    state.isError = true;
    rerender();
    expect(result.current.enabled).toBe(false);
    expect(gateway.overview).not.toHaveBeenCalled();
  });
});
