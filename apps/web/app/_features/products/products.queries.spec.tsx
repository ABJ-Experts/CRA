// @vitest-environment jsdom

import {
  QueryClient,
  QueryClientProvider,
  QueryObserver,
} from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { productsApi } from "./products.api";
import {
  useCreateProductVariantRelationshipMutation,
  useCreateSoftwareBaselineMutation,
  useCreateProductMutation,
  useAssignSoftwareBaselineMembershipMutation,
  useFinalizeReservedSecurityUpdateArtifactMutation,
  useSoftwareBaselineRevisionsQuery,
  useSupportPeriodRetentionQuery,
  useSupportAlertsQuery,
} from "./products.queries";

vi.mock("./products.api", () => ({
  productsApi: {
    createProductVariantRelationship: vi.fn(),
    createSoftwareBaseline: vi.fn(),
    create: vi.fn(),
    assignSoftwareBaselineMembership: vi.fn(),
    finalizeSecurityUpdateArtifact: vi.fn(),
    listSoftwareBaselineRevisions: vi.fn(),
    getSupportRetention: vi.fn(),
    getSupportAlerts: vi.fn(),
  },
}));

describe("product relationship queries", () => {
  afterEach(() => vi.clearAllMocks());

  it.each([
    [
      "baseline creation",
      useCreateSoftwareBaselineMutation,
      "createSoftwareBaseline",
      ["products", "baselines", "list"],
    ],
    [
      "membership assignment",
      () => useAssignSoftwareBaselineMembershipMutation("product"),
      "assignSoftwareBaselineMembership",
      ["products", "product", "baseline-memberships"],
    ],
  ] as const)(
    "completes %s after its committed response while the cache refresh is pending",
    async (_name, useWrite, apiMethod, queryKey) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      queryClient.setQueryData(queryKey, { revision: 1 });
      let finishRefresh!: (value: { revision: number }) => void;
      const refresh = vi.fn(
        () =>
          new Promise<{ revision: number }>((resolve) => {
            finishRefresh = resolve;
          }),
      );
      const observer = new QueryObserver(queryClient, {
        queryKey,
        queryFn: refresh,
        staleTime: Infinity,
      });
      const unsubscribe = observer.subscribe(() => undefined);
      vi.mocked(productsApi[apiMethod]).mockResolvedValue({} as never);
      function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
        return (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        );
      }
      const { result } = renderHook(() => useWrite(), { wrapper: Wrapper });
      let committed = false;
      const write = result.current.mutateAsync({} as never).then(() => {
        committed = true;
      });
      try {
        await act(async () => {
          await new Promise((resolve) => setTimeout(resolve, 20));
        });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(committed).toBe(true);
        expect(result.current.isPending).toBe(false);
        expect(observer.getCurrentResult().isFetching).toBe(true);
        expect(productsApi[apiMethod]).toHaveBeenCalledTimes(1);
      } finally {
        await act(async () => {
          finishRefresh({ revision: 2 });
          await write;
        });
        unsubscribe();
      }
      expect(queryClient.getQueryData(queryKey)).toEqual({ revision: 2 });
    },
  );

  it("keeps a committed baseline successful when its refresh fails and exposes the read error", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const queryKey = ["products", "baselines", "list"];
    queryClient.setQueryData(queryKey, { revision: 1 });
    const refreshError = new Error("Read temporarily unavailable");
    const observer = new QueryObserver(queryClient, {
      queryKey,
      queryFn: () => Promise.reject(refreshError),
      staleTime: Infinity,
    });
    const unsubscribe = observer.subscribe(() => undefined);
    vi.mocked(productsApi.createSoftwareBaseline).mockResolvedValue(
      {} as never,
    );
    function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }
    const { result } = renderHook(() => useCreateSoftwareBaselineMutation(), {
      wrapper: Wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({} as never);
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(observer.getCurrentResult().error).toBe(refreshError);
    expect(queryClient.getQueryData(queryKey)).toEqual({ revision: 1 });
    expect(productsApi.createSoftwareBaseline).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("preserves ordinary product creation's awaited refresh behavior", async () => {
    const queryClient = new QueryClient();
    let finishRefresh!: () => void;
    vi.spyOn(queryClient, "invalidateQueries").mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          finishRefresh = resolve;
        }),
    );
    vi.mocked(productsApi.create).mockResolvedValue({} as never);
    function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }
    const { result } = renderHook(() => useCreateProductMutation(), {
      wrapper: Wrapper,
    });
    let committed = false;
    const write = result.current.mutateAsync({} as never).then(() => {
      committed = true;
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(committed).toBe(false);
    await act(async () => {
      finishRefresh();
      await write;
    });
    expect(committed).toBe(true);
  });

  it("shares product-wide retention and alert caches across release views", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.mocked(productsApi.getSupportRetention).mockResolvedValue({} as never);
    vi.mocked(productsApi.getSupportAlerts).mockResolvedValue({} as never);
    function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }
    renderHook(
      () => {
        useSupportPeriodRetentionQuery("product", "release-a", true);
        useSupportPeriodRetentionQuery("product", "release-b", true);
        useSupportAlertsQuery("product", "release-a", true);
        useSupportAlertsQuery("product", "release-b", true);
      },
      { wrapper: Wrapper },
    );
    await act(async () => undefined);
    expect(productsApi.getSupportRetention).toHaveBeenCalledTimes(1);
    expect(productsApi.getSupportAlerts).toHaveBeenCalledTimes(1);
    expect(
      queryClient
        .getQueryCache()
        .getAll()
        .map((query) => query.queryKey),
    ).toEqual([
      ["products", "product", "retention"],
      ["products", "product", "support-alerts"],
    ]);
  });

  it("does not issue a revision request for a blank baseline identity", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }

    const { result } = renderHook(
      () => useSoftwareBaselineRevisionsQuery("", false),
      { wrapper: Wrapper },
    );

    await act(async () => undefined);

    expect(productsApi.listSoftwareBaselineRevisions).not.toHaveBeenCalled();
    expect(result.current.fetchStatus).toBe("idle");
  });

  it.each(["same", "different"])(
    "creates a variant and refreshes %s product scopes without overlapping reads",
    async (scope) => {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
      const sourceProductId = "00000000-0000-4000-8000-000000000001";
      const variantProductId =
        scope === "same"
          ? sourceProductId
          : "00000000-0000-4000-8000-000000000002";
      const input = {
        variantProductId,
      } as never;
      vi.mocked(productsApi.createProductVariantRelationship).mockResolvedValue(
        {} as never,
      );

      function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
        return (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        );
      }

      const { result } = renderHook(
        () => useCreateProductVariantRelationshipMutation(sourceProductId),
        { wrapper: Wrapper },
      );

      await act(async () => result.current.mutateAsync(input));

      expect(productsApi.createProductVariantRelationship).toHaveBeenCalledWith(
        variantProductId,
        input,
      );
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["products", sourceProductId, "variant-relationships"],
      });
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["products", variantProductId, "variant-relationships"],
      });
      const calls = invalidateQueries.mock.calls.map(
        ([filter]) => filter?.queryKey,
      );
      expect(calls).not.toContainEqual(["products"]);
      expect(
        calls.filter(
          (key) => JSON.stringify(key) === JSON.stringify(["products", "list"]),
        ),
      ).toHaveLength(1);
      expect(
        calls.filter(
          (key) =>
            JSON.stringify(key) ===
            JSON.stringify(["products", "baselines", "list"]),
        ),
      ).toHaveLength(1);
    },
  );

  it("finalizes a reserved upload and refreshes product compliance keys without a page reload", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const productId = "00000000-0000-4000-8000-000000000001";
    const artifactId = "00000000-0000-4000-8000-000000000002";
    const input = {
      expectedVersion: 1,
      idempotencyKey: "00000000-0000-4000-8000-000000000003",
    } as never;
    vi.mocked(productsApi.finalizeSecurityUpdateArtifact).mockResolvedValue(
      {} as never,
    );
    function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
      return (
        <QueryClientProvider client={queryClient}>
          {children}
        </QueryClientProvider>
      );
    }
    const { result } = renderHook(
      () => useFinalizeReservedSecurityUpdateArtifactMutation(productId),
      { wrapper: Wrapper },
    );
    await act(async () => result.current.mutateAsync({ artifactId, input }));
    expect(productsApi.finalizeSecurityUpdateArtifact).toHaveBeenCalledWith(
      productId,
      artifactId,
      input,
    );
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ["products", productId, "security-update-artifacts"],
    });
  });
});
