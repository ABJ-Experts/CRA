// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { auditRangeGateway } from "./audit-range.api";
import { useAuditRangeJob } from "./audit-range.queries";
vi.mock("./audit-range.api", () => ({
  auditRangeGateway: { status: vi.fn() },
}));
const client = new QueryClient({
  defaultOptions: { queries: { retry: false, gcTime: 0 } },
});
function wrapper({ children }: { children: ReactNode }) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
afterEach(() => {
  cleanup();
  client.clear();
  vi.clearAllMocks();
});
describe("range polling", () => {
  it("retains logical read UUID on a failed retry and partitions tenant cache", async () => {
    vi.mocked(auditRangeGateway.status)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ id: "job", status: "completed" } as never);
    const { result, rerender } = renderHook(
      ({ org }) => useAuditRangeJob(org, "job", true),
      { wrapper, initialProps: { org: "org1" } },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));
    await act(async () => {
      await result.current.refetch();
    });
    const calls = vi.mocked(auditRangeGateway.status).mock.calls;
    expect(calls[0]?.[1]).toEqual(calls[1]?.[1]);
    rerender({ org: "org2" });
    await waitFor(() =>
      expect(auditRangeGateway.status).toHaveBeenCalledTimes(3),
    );
    expect(
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.queryKey[1]),
    ).toContain("org2");
  });
  it("does not fetch without job or organization", () => {
    renderHook(() => useAuditRangeJob(null, null, true), { wrapper });
    expect(auditRangeGateway.status).not.toHaveBeenCalled();
  });
  it.each(["queued", "processing"] as const)(
    "polls %s and stops on final result",
    async (status) => {
      vi.mocked(auditRangeGateway.status).mockResolvedValue({
        id: "job",
        status,
      } as never);
      const { result } = renderHook(
        () => useAuditRangeJob("org", "job", true),
        { wrapper },
      );
      await waitFor(() => expect(result.current.isSuccess).toBe(true));
      const interval = client.getQueryCache().getAll()[0]?.options as {
        refetchInterval?: (query: unknown) => number | false;
      };
      const intervalValue = interval?.refetchInterval;
      expect(typeof intervalValue).toBe("function");
      if (typeof intervalValue === "function")
        expect(intervalValue(client.getQueryCache().getAll()[0]!)).toBe(2000);
    },
  );
});
