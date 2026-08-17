// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { productsApi } from "./products.api";
import {
  useCreateProductVariantRelationshipMutation,
  useSoftwareBaselineRevisionsQuery,
} from "./products.queries";

vi.mock("./products.api", () => ({
  productsApi: {
    createProductVariantRelationship: vi.fn(),
    listSoftwareBaselineRevisions: vi.fn(),
  },
}));

describe("product relationship queries", () => {
  afterEach(() => vi.clearAllMocks());

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

  it("creates a variant through its selected product and refreshes both sides", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidateQueries = vi.spyOn(queryClient, "invalidateQueries");
    const sourceProductId = "00000000-0000-4000-8000-000000000001";
    const variantProductId = "00000000-0000-4000-8000-000000000002";
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
  });
});
