// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authenticatedRequestJson = vi.hoisted(() => vi.fn());

vi.mock("../../_lib/http/authenticated-request", () => ({
  authenticatedRequestJson,
}));
vi.mock("../../_providers/providers", () => ({
  useMocksReady: () => true,
}));

import { useTableQuery } from "./use-table-query";

const rowSchema = z.object({ id: z.string(), name: z.string() }).strict();
type Row = z.infer<typeof rowSchema>;

function page(pageNumber: number, name = `row-${pageNumber}`) {
  return {
    rows: [{ id: String(pageNumber), name }],
    total: 30,
    page: pageNumber,
    pageSize: 15,
    pageCount: 2,
  };
}

function requestedPage(path: string): number {
  return Number(new URL(path, "https://cra.test").searchParams.get("page"));
}

function testHarness() {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: Number.POSITIVE_INFINITY },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { client, wrapper };
}

beforeEach(() => {
  authenticatedRequestJson.mockImplementation(({ path }: { path: string }) =>
    Promise.resolve(page(requestedPage(path))),
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useTableQuery", () => {
  it("composes the endpoint, query key, schema, and abort signal", async () => {
    const { client, wrapper } = testHarness();
    const { result } = renderHook(
      () =>
        useTableQuery<Row>({
          endpoint: "/api/products",
          rowSchema,
          initialSorting: [{ id: "name", desc: true }],
          simulateError: true,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    const query = "page=1&pageSize=15&sort=name&order=desc&fail=1";
    expect(authenticatedRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        path: `/api/products?${query}`,
        schema: expect.objectContaining({ safeParse: expect.any(Function) }),
        signal: expect.any(AbortSignal),
      }),
    );
    expect(
      client.getQueryCache().find({
        queryKey: ["/api/products", query],
      }),
    ).toBeDefined();
    const request = authenticatedRequestJson.mock.calls[0]?.[0] as {
      schema: z.ZodType<unknown>;
    };
    expect(
      request.schema.safeParse({
        ...page(1),
        rows: [{ id: "1", name: "valid", extra: true }],
      }).success,
    ).toBe(false);
  });

  it("resets the page after search, sorting, and page-size changes", async () => {
    const { wrapper } = testHarness();
    const { result } = renderHook(
      () => useTableQuery<Row>({ endpoint: "/api/products", rowSchema }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);
    act(() => result.current.setSearch("chair"));
    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(4));
    act(() => result.current.setSorting([{ id: "name", desc: false }]));
    expect(result.current.page).toBe(1);

    act(() => result.current.setPage(4));
    act(() => result.current.setPageSize(25));
    expect(result.current.page).toBe(1);
    expect(result.current.pageSize).toBe(25);
  });

  it("keeps previous rows visible while the next page loads", async () => {
    let releaseSecond: ((value: ReturnType<typeof page>) => void) | undefined;
    authenticatedRequestJson.mockImplementation(({ path }: { path: string }) =>
      requestedPage(path) === 2
        ? new Promise((resolve) => {
            releaseSecond = resolve;
          })
        : Promise.resolve(page(1, "first")),
    );
    const { wrapper } = testHarness();
    const { result } = renderHook(
      () => useTableQuery<Row>({ endpoint: "/api/products", rowSchema }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.rows[0]?.name).toBe("first"));

    act(() => result.current.setPage(2));
    await waitFor(() => expect(result.current.isFetching).toBe(true));
    expect(result.current.rows[0]?.name).toBe("first");
    expect(result.current.isLoading).toBe(false);

    act(() => releaseSecond?.(page(2, "second")));
    await waitFor(() => expect(result.current.rows[0]?.name).toBe("second"));
  });

  it("propagates query cancellation through the request signal", async () => {
    let signal: AbortSignal | undefined;
    authenticatedRequestJson.mockImplementation(
      ({ signal: requestSignal }: { signal: AbortSignal }) => {
        signal = requestSignal;
        return new Promise(() => undefined);
      },
    );
    const { wrapper } = testHarness();
    const { unmount } = renderHook(
      () => useTableQuery<Row>({ endpoint: "/api/products", rowSchema }),
      { wrapper },
    );
    await waitFor(() => expect(signal).toBeDefined());

    unmount();

    await waitFor(() => expect(signal?.aborted).toBe(true));
  });

  it("surfaces request failures for the table error state", async () => {
    authenticatedRequestJson.mockRejectedValue(new Error("table unavailable"));
    const { wrapper } = testHarness();
    const { result } = renderHook(
      () => useTableQuery<Row>({ endpoint: "/api/products", rowSchema }),
      { wrapper },
    );

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.error).toBe("table unavailable");
    expect(result.current.rows).toEqual([]);
  });

  it("reconciles a server-clamped page without a refetch loop", async () => {
    authenticatedRequestJson.mockImplementation(({ path }: { path: string }) =>
      Promise.resolve(
        requestedPage(path) === 6
          ? { ...page(1), total: 1, pageCount: 1 }
          : page(1),
      ),
    );
    const { wrapper } = testHarness();
    const { result } = renderHook(
      () => useTableQuery<Row>({ endpoint: "/api/products", rowSchema }),
      { wrapper },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    act(() => result.current.setPage(6));

    await waitFor(() => expect(result.current.page).toBe(1));
    const paths = authenticatedRequestJson.mock.calls.map(
      ([options]) => (options as { path: string }).path,
    );
    expect(paths.filter((path) => requestedPage(path) === 6)).toHaveLength(1);
    expect(
      paths.filter((path) => requestedPage(path) === 1).length,
    ).toBeLessThanOrEqual(2);
  });
});
