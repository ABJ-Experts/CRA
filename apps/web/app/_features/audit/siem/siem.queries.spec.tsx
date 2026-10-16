// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PropsWithChildren } from "react";
import { AuditSiemGateway } from "./siem.api";
import { useSiemCommand, useSiemQueries } from "./siem.queries";
describe("SIEM command lifecycle", () => {
  it("retains no credentials as cached mutation variables", async () => {
    const { result } = renderHook(() => useSiemCommand());
    await act(async () => {
      await result.current.run(() => Promise.resolve("accepted"));
    });
    expect(result.current.pending).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current).not.toHaveProperty("variables");
  });
  it("reports sanitized error without retaining provider content", async () => {
    const { result } = renderHook(() => useSiemCommand());
    await act(async () => {
      await result.current.run(() =>
        Promise.reject(new Error("sensitive bearer")),
      );
    });
    await waitFor(() =>
      expect(result.current.error).toBe(
        "SIEM action failed. Check permissions and current status, then retry.",
      ),
    );
  });
});
it("scopes all read keys to organization and runs bounded polling queries", async () => {
  vi.spyOn(AuditSiemGateway.prototype, "list").mockResolvedValue({ items: [] });
  vi.spyOn(AuditSiemGateway.prototype, "catalogue").mockResolvedValue({
    version: 1,
    eventClasses: [],
    formats: ["json"],
    transports: ["https"],
  });
  const deliveries = vi
    .spyOn(AuditSiemGateway.prototype, "deliveries")
    .mockResolvedValue({ items: [], nextCursor: null });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const { result, rerender, unmount } = renderHook(
    ({ selected, enabled }) =>
      useSiemQueries("org", selected, undefined, enabled),
    { initialProps: { selected: "", enabled: true }, wrapper },
  );
  await waitFor(() => expect(result.current.list.isSuccess).toBe(true));
  expect(deliveries).not.toHaveBeenCalled();
  rerender({ selected: "11111111-1111-4111-8111-111111111111", enabled: true });
  await waitFor(() => expect(result.current.deliveries.isSuccess).toBe(true));
  expect(
    client
      .getQueryCache()
      .findAll()
      .every((query) => query.queryKey[1] === "org"),
  ).toBe(true);
  rerender({ selected: "", enabled: false });
  unmount();
  client.clear();
  vi.restoreAllMocks();
});
it("does not update command state after tenant-bound unmount", async () => {
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise((_, failure) => {
    reject = failure;
  });
  const { result, unmount } = renderHook(() => useSiemCommand());
  let operation: Promise<unknown>;
  act(() => {
    operation = result.current.run(() => promise);
  });
  unmount();
  reject(new Error("private provider"));
  await operation!;
});
