// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { findingImpactApi } from "./finding-impact.api";
import { findingImpactKeys } from "./finding-impact.keys";
import { useFindingImpactSummaryQuery } from "./finding-impact.queries";

vi.mock("./finding-impact.api", () => ({
  findingImpactApi: { getProductSummary: vi.fn() },
}));

const PRODUCT_ID = "11111111-1111-4111-8111-111111111111";
const RELEASE_ID = "22222222-2222-4222-8222-222222222222";
const SUMMARY = {
  summary: {
    productId: PRODUCT_ID,
    releaseId: RELEASE_ID,
    activeImpactCount: 0,
    supersededImpactCount: 0,
    closedImpactCount: 0,
    overrideCount: 0,
    latestGraphVersion: null,
    latestEvaluatedAt: null,
    propagationState: "idle" as const,
    queuedJobCount: 0,
    inProgressJobCount: 0,
    retryingJobCount: 0,
    deadLetterJobCount: 0,
  },
};

function wrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: Readonly<{ children: ReactNode }>) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

describe("finding impact summary query", () => {
  afterEach(() => vi.clearAllMocks());

  it("uses a stable product-and-release cache key without fetching when disabled", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const { result } = renderHook(
      () =>
        useFindingImpactSummaryQuery(
          PRODUCT_ID,
          { releaseId: RELEASE_ID },
          false,
        ),
      { wrapper: wrapper(queryClient) },
    );

    await act(async () => undefined);

    expect(result.current.fetchStatus).toBe("idle");
    expect(findingImpactApi.getProductSummary).not.toHaveBeenCalled();
    expect(findingImpactKeys.productSummary(PRODUCT_ID, RELEASE_ID)).toEqual([
      "findings",
      "product-impact-summary",
      PRODUCT_ID,
      RELEASE_ID,
    ]);
  });

  it("reads the aggregate-only response through the typed gateway", async () => {
    vi.mocked(findingImpactApi.getProductSummary).mockResolvedValue(SUMMARY);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    renderHook(() => useFindingImpactSummaryQuery(PRODUCT_ID, {}, true), {
      wrapper: wrapper(queryClient),
    });

    await waitFor(() =>
      expect(findingImpactApi.getProductSummary).toHaveBeenCalledOnce(),
    );
    expect(findingImpactApi.getProductSummary).toHaveBeenCalledWith(
      PRODUCT_ID,
      {},
      expect.any(AbortSignal),
    );
  });
});
