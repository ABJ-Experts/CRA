// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useWebhookCommand,
  useWebhookQueries,
  webhookKey,
} from "./webhooks.queries";
import { endpoint, delivery, page } from "./test/webhook-fixtures";
const state = vi.hoisted(() => ({ orgId: "org-one" as string | undefined }));
vi.mock("../../_providers/session-provider", () => ({
  useSession: () => ({ session: { organization: { id: state.orgId } } }),
}));
const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  catalogue: vi.fn(),
  deliveries: vi.fn(),
  detail: vi.fn(),
  products: vi.fn(),
}));
vi.mock("./webhooks.api", () => ({ webhooksApi: mocks }));
vi.mock("../products/products.api", () => ({
  productsApi: { list: mocks.products },
}));
let client: QueryClient;
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
beforeEach(() => {
  state.orgId = "org-one";
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mocks.list.mockResolvedValue({ endpoints: page([endpoint]) });
  mocks.get.mockResolvedValue({ endpoint });
  mocks.catalogue.mockResolvedValue({ eventTypes: [] });
  mocks.deliveries.mockResolvedValue({ deliveries: page([delivery]) });
  mocks.detail.mockResolvedValue({ detail: { delivery, attempts: page([]) } });
  mocks.products.mockResolvedValue({ products: page([]) });
});
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});
describe("organization-scoped webhook queries", () => {
  it("scopes all requests and never uses previous-tenant product placeholders", async () => {
    const hook = renderHook(
      () => useWebhookQueries(endpoint.id, delivery.id, 2, 3, 4, true, 5),
      { wrapper },
    );
    await waitFor(() =>
      expect(hook.result.current.detail.isSuccess).toBe(true),
    );
    expect(mocks.list).toHaveBeenCalledWith(
      { page: 2, pageSize: 15 },
      expect.any(AbortSignal),
    );
    expect(mocks.products).toHaveBeenCalledWith(
      { page: 5, pageSize: 25 },
      expect.any(AbortSignal),
    );
    expect(
      client
        .getQueryCache()
        .getAll()
        .every((query) => query.queryKey[1] === "org-one"),
    ).toBe(true);
    mocks.products.mockReturnValue(new Promise(() => {}));
    state.orgId = "org-two";
    hook.rerender();
    expect(hook.result.current.products.data).toBeUndefined();
    expect(webhookKey("org-two", "products", 5)).not.toEqual(
      webhookKey("org-one", "products", 5),
    );
  });
  it("does not dispatch without membership, visibility, or a selected endpoint", async () => {
    state.orgId = undefined;
    const hook = renderHook(() => useWebhookQueries("", "", 1, 1, 1, true, 1), {
      wrapper,
    });
    expect(mocks.list).not.toHaveBeenCalled();
    state.orgId = "org-one";
    hook.rerender();
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    expect(mocks.deliveries).not.toHaveBeenCalled();
    expect(mocks.detail).not.toHaveBeenCalled();
  });
});
describe("webhook commands bypass completed mutation caches", () => {
  it("invalidates only the captured tenant and retains no plaintext mutation variables", async () => {
    const hook = renderHook(useWebhookCommand, { wrapper });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await act(async () => {
      await expect(
        hook.result.current.run(async () => ({
          secretCanary: "temporary request",
        })),
      ).resolves.toEqual({ secretCanary: "temporary request" });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: webhookKey("org-one"),
    });
    expect(client.getMutationCache().getAll()).toEqual([]);
    expect(hook.result.current.pending).toBe(false);
  });
  it("rejects results arriving after an organization switch", async () => {
    const hook = renderHook(useWebhookCommand, { wrapper });
    let finish!: (value: string) => void;
    const request = new Promise<string>((resolve) => {
      finish = resolve;
    });
    let result!: Promise<string>;
    act(() => {
      result = hook.result.current.run(() => request);
    });
    const assertion = expect(result).rejects.toThrow("Organization changed");
    state.orgId = "org-two";
    hook.rerender();
    await act(async () => {
      finish("old tenant result");
      await assertion;
    });
    expect(client.getMutationCache().getAll()).toEqual([]);
  });
  it("rejects stale dispatch, duplicate clicks, and unmounted completions", async () => {
    state.orgId = undefined;
    const noOrg = renderHook(useWebhookCommand, { wrapper });
    await expect(noOrg.result.current.run(vi.fn())).rejects.toThrow(
      "Organization changed",
    );
    noOrg.unmount();
    state.orgId = "org-one";
    const hook = renderHook(useWebhookCommand, { wrapper });
    const stale = hook.result.current.run;
    state.orgId = "org-two";
    hook.rerender();
    await expect(stale(vi.fn())).rejects.toThrow("Organization changed");
    let finish!: () => void;
    let result!: Promise<void>;
    act(() => {
      result = hook.result.current.run(
        () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
      );
    });
    await expect(hook.result.current.run(vi.fn())).rejects.toThrow("Wait for");
    const assertion = expect(result).rejects.toThrow("Organization changed");
    hook.unmount();
    finish();
    await assertion;
  });
  it("rejects a tenant switch during invalidation", async () => {
    const hook = renderHook(useWebhookCommand, { wrapper });
    let complete!: () => void;
    vi.spyOn(client, "invalidateQueries").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          complete = resolve;
        }),
    );
    let result!: Promise<string>;
    act(() => {
      result = hook.result.current.run(async () => "done");
    });
    const assertion = expect(result).rejects.toThrow("Organization changed");
    await waitFor(() => expect(complete).toBeDefined());
    state.orgId = "org-two";
    hook.rerender();
    await act(async () => {
      complete();
      await assertion;
    });
  });
  it("clears pending on failed transport without publishing stale success", async () => {
    const hook = renderHook(useWebhookCommand, { wrapper });
    await act(async () => {
      await expect(
        hook.result.current.run(async () => {
          throw new Error("offline");
        }),
      ).rejects.toThrow("offline");
    });
    expect(hook.result.current.pending).toBe(false);
  });
});
