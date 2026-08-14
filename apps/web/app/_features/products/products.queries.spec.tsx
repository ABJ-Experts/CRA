// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { productsApi } from "./products.api";
import { useSoftwareBaselineRevisionsQuery } from "./products.queries";

vi.mock("./products.api", () => ({
  productsApi: {
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
});
