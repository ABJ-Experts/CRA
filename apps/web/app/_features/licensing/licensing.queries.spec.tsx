// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { useLicensingQueries } from "./licensing.queries";
import { ApiClientError } from "../../_lib/http/api-client";
const fixture = vi.hoisted(() => ({
  session: { organization: { id: "tenant" }, user: { id: "user" } },
  permissions: { can_view_licensing: true, can_manage_licensing: true },
  isLoading: false,
  isError: false,
  ready: true,
  policy: vi.fn(),
  current: vi.fn(),
  history: vi.fn(),
  activate: vi.fn(),
}));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => fixture,
}));
vi.mock("../../_providers/providers", () => ({
  useMocksReady: () => fixture.ready,
}));
vi.mock("./licensing-gateway", () => ({
  LicensingGateway: class {
    policy = fixture.policy;
    current = fixture.current;
    history = fixture.history;
    activate = fixture.activate;
  },
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  fixture.ready = true;
  fixture.permissions = {
    can_view_licensing: true,
    can_manage_licensing: true,
  };
});
function setup() {
  vi.stubEnv("NEXT_PUBLIC_ENABLE_MOCKS", "false");
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, ...renderHook(() => useLicensingQueries(), { wrapper }) };
}
describe("licensing queries", () => {
  it("scopes every request and invalidates after activation", async () => {
    fixture.policy.mockResolvedValue({ state: "active" });
    fixture.current.mockResolvedValue({ version: 1 });
    fixture.history.mockResolvedValue({ items: [] });
    fixture.activate.mockResolvedValue({ version: 2 });
    const { result, client, unmount } = setup();
    await waitFor(() =>
      expect(result.current.current.data).toEqual({ version: 1 }),
    );
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((q) => q.queryKey[1]?.toString().includes("tenant")),
    ).toBe(true);
    await act(() =>
      result.current.activation.mutateAsync({
        artifact: "a.b.c",
        expectedVersion: 1,
        idempotencyKey: "key",
      }),
    );
    expect(fixture.activate).toHaveBeenCalledTimes(1);
    unmount();
    await waitFor(() =>
      expect(client.getQueryCache().getAll()).toHaveLength(0),
    );
  });
  it("disables all requests with mocks or unavailable identity", () => {
    fixture.ready = false;
    const { result } = setup();
    expect(result.current.enabled).toBe(false);
    expect(fixture.policy).not.toHaveBeenCalled();
  });
  it("keeps minimal policy available without management grants", async () => {
    fixture.permissions = {
      can_view_licensing: false,
      can_manage_licensing: false,
    };
    fixture.policy.mockResolvedValue({ state: "grace" });
    const { result } = setup();
    await waitFor(() =>
      expect(result.current.policy.data).toEqual({ state: "grace" }),
    );
    expect(fixture.current).not.toHaveBeenCalled();
    expect(fixture.history).not.toHaveBeenCalled();
    expect(result.current.canManage).toBe(false);
  });
  it("drops cached management data after revocation", async () => {
    fixture.policy.mockRejectedValue(
      new ApiClientError("api", "Revoked", 403),
    );
    fixture.current.mockResolvedValue({ version: 1 });
    fixture.history.mockResolvedValue({ items: [] });
    const { result } = setup();
    await waitFor(() => expect(result.current.revoked).toBe(true));
    expect(result.current.current.data).toBeUndefined();
    expect(result.current.history.data).toBeUndefined();
    expect(result.current.canManage).toBe(false);
  });
});
