// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  ready: vi.fn(),
  products: vi.fn(),
  concentration: vi.fn(),
  detail: vi.fn(),
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: mocks.session,
}));
vi.mock("../../_providers/providers", () => ({ useMocksReady: mocks.ready }));
vi.mock("./portfolio-gateway", () => ({
  PortfolioGateway: class {
    products = mocks.products;
    concentration = mocks.concentration;
    detail = mocks.detail;
  },
}));
import {
  usePortfolioProducts,
  usePortfolioConcentration,
  usePortfolioDetail,
} from "./portfolio.queries";
import { ApiClientError } from "../../_lib/http/api-client";
import { sessionKeys } from "../session/session.keys";
const state = (org = "org", allowed = true) => ({
  session: { organization: { id: org }, user: { id: "actor" } },
  permissions: { can_view_dashboards: allowed, can_view_products: allowed },
  isLoading: false,
  isError: false,
});
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.session.mockReturnValue(state());
  mocks.ready.mockReturnValue(true);
  for (const transport of [mocks.products, mocks.concentration, mocks.detail])
    transport.mockReset().mockResolvedValue({ organizationId: "org" });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.unstubAllEnvs();
});
describe("portfolio query authorization lifecycle", () => {
  it("keeps the interaction identity stable on identity refetch while replacing query evidence", async () => {
    client.setQueryData(sessionKeys.identity, {}, { updatedAt: 1 });
    const hook = renderHook(() => usePortfolioProducts({}), { wrapper });
    await waitFor(() => expect(hook.result.current.data).toBeDefined());
    const original = hook.result.current;
    act(() => client.setQueryData(sessionKeys.identity, {}, { updatedAt: 2 }));
    hook.rerender();
    expect(hook.result.current.scope).not.toBe(original.scope);
    expect(hook.result.current.identityScope).toBe(original.identityScope);
    expect(hook.result.current.identityScope).toBeDefined();
    expect(
      client.getQueriesData({ queryKey: ["dashboard", original.scope] }),
    ).toEqual([]);
    await waitFor(() => expect(mocks.products).toHaveBeenCalledTimes(2));
    mocks.session.mockReturnValue(state("second"));
    hook.rerender();
    expect(hook.result.current.identityScope).not.toBe(original.identityScope);
    mocks.session.mockReturnValue({
      ...state(),
      session: { organization: { id: "org" }, user: { id: "other-actor" } },
    });
    hook.rerender();
    expect(hook.result.current.identityScope).not.toBe(original.identityScope);
    mocks.session.mockReturnValue({
      ...state(),
      permissions: { ...state().permissions, can_view_sboms: false },
    });
    hook.rerender();
    expect(hook.result.current.identityScope).not.toBe(original.identityScope);
  });
  it("uses cancellable reads for all three endpoints and removes evidence on unmount", async () => {
    const products = renderHook(() => usePortfolioProducts({}), { wrapper });
    const concentration = renderHook(() => usePortfolioConcentration({}), {
      wrapper,
    });
    const detail = renderHook(
      () => usePortfolioDetail({ componentRef: "opaque" }),
      { wrapper },
    );
    await waitFor(() =>
      expect(products.result.current.data).toEqual({ organizationId: "org" }),
    );
    await waitFor(() =>
      expect(concentration.result.current.data).toBeDefined(),
    );
    await waitFor(() => expect(detail.result.current.data).toBeDefined());
    expect(mocks.products).toHaveBeenCalledWith({}, expect.any(AbortSignal));
    products.unmount();
    concentration.unmount();
    detail.unmount();
    expect(client.getQueriesData({ queryKey: ["dashboard"] })).toEqual([]);
  });
  it("erases the complete scope after definite denial, preserving another organization", async () => {
    mocks.products.mockRejectedValue(new ApiClientError("api", "Denied", 403));
    client.setQueryData(["dashboard", "other", "overview"], { marker: true });
    const hook = renderHook(() => usePortfolioProducts({}), { wrapper });
    await waitFor(() => expect(hook.result.current.enabled).toBe(false));
    expect(hook.result.current.data).toBeUndefined();
    expect(client.getQueryData(["dashboard", "other", "overview"])).toEqual({
      marker: true,
    });
  });
  it("rejects foreign response scope and disables unauthorized or mock sessions", async () => {
    mocks.products.mockResolvedValue({ organizationId: "foreign" });
    const hook = renderHook(() => usePortfolioProducts({}), { wrapper });
    await waitFor(() => expect(hook.result.current.isError).toBe(true));
    expect(hook.result.current.data).toBeUndefined();
    mocks.session.mockReturnValue(state("org", false));
    hook.rerender();
    expect(hook.result.current.enabled).toBe(false);
    vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "true");
    hook.rerender();
    expect(hook.result.current.live).toBe(false);
  });
  it("cancels pending requests and changes cache scope on organization switch", async () => {
    let aborted = false;
    mocks.products.mockImplementation(
      (_filters, signal: AbortSignal) =>
        new Promise((_resolve, reject) =>
          signal.addEventListener("abort", () => {
            aborted = true;
            reject(new DOMException("Aborted", "AbortError"));
          }),
        ),
    );
    const hook = renderHook(() => usePortfolioProducts({}), { wrapper });
    await waitFor(() => expect(mocks.products).toHaveBeenCalledTimes(1));
    const original = hook.result.current.scope;
    mocks.session.mockReturnValue(state("second"));
    hook.rerender();
    expect(hook.result.current.scope).not.toBe(original);
    expect(hook.result.current.data).toBeUndefined();
    await waitFor(() => expect(aborted).toBe(true));
  });
});
