// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DashboardProjection } from "./dashboard.queries";
import { ApiClientError } from "../../_lib/http/api-client";
const gateway = vi.hoisted(() => ({
  obligations: vi.fn(),
  readiness: vi.fn(),
  ingestion: vi.fn(),
}));
const query = vi.hoisted(() => ({
  result: {
    isError: false,
    isLoading: false,
    isFetching: false,
    data: undefined as unknown,
    error: undefined as unknown,
    refetch: vi.fn(),
  },
  options: undefined as unknown,
  cancelQueries: vi.fn(),
  setQueryData: vi.fn(),
  invalidateQueries: vi.fn(),
  removeQueries: vi.fn(),
}));
vi.mock("./dashboard-gateway", () => ({
  DashboardGateway: class {
    obligations = gateway.obligations;
    readiness = gateway.readiness;
    ingestion = gateway.ingestion;
  },
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: (options: unknown) => {
    query.options = options;
    return query.result;
  },
  useQueryClient: () => query,
}));
vi.mock("./dashboard-sections", () => ({
  DashboardObligations: () => <p>Obligation records</p>,
  DashboardReadiness: () => <p>Readiness records</p>,
  DashboardIngestion: () => <p>Ingestion records</p>,
}));
import { DashboardPagedList } from "./dashboard-pages";
const section = {
  state: "available",
  observedAt: null,
  updatedAt: null,
  data: { rows: [], nextCursor: "next" },
};
const initial = {
  organizationId: "tenant",
  obligations: section,
  readiness: section,
  ingestion: section,
} as unknown as DashboardProjection;
const currentOptions = () =>
  query.options as {
    enabled: boolean;
    queryFn: (options: { signal: AbortSignal }) => Promise<unknown>;
  };
beforeEach(() => {
  query.result = {
    isError: false,
    isLoading: false,
    isFetching: false,
    data: undefined,
    error: undefined,
    refetch: vi.fn(),
  };
  Object.values(gateway).forEach((fn) =>
    fn.mockReset().mockResolvedValue({ organizationId: "tenant" }),
  );
});
afterEach(cleanup);
describe("dashboard bounded paging", () => {
  it.each(["obligations", "readiness", "ingestion"] as const)(
    "pages authorized %s and restores initial page",
    async (kind) => {
      render(
        <DashboardPagedList
          kind={kind}
          initial={initial}
          scope="scope"
          productId="product"
          now={0}
        />,
      );
      expect(currentOptions().enabled).toBe(false);
      fireEvent.click(screen.getByRole("button", { name: `Next ${kind}` }));
      expect(currentOptions().enabled).toBe(true);
      const signal = new AbortController().signal;
      await currentOptions().queryFn({ signal });
      expect(gateway[kind]).toHaveBeenCalledWith(
        expect.objectContaining({ productId: "product", cursor: "next" }),
        signal,
      );
      query.result.data = { organizationId: "tenant", [kind]: section };
      fireEvent.click(screen.getByRole("button", { name: `Previous ${kind}` }));
      expect(currentOptions().enabled).toBe(false);
    },
  );
  it("keeps posture history cursors bound to history filters", async () => {
    render(
      <DashboardPagedList
        kind="obligations"
        initial={initial}
        scope="scope"
        productId="product"
        now={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next obligations" }));
    await currentOptions().queryFn({ signal: new AbortController().signal });
    expect(gateway.obligations).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "history", cursor: "next" }),
      expect.any(AbortSignal),
    );
    fireEvent.click(screen.getByRole("button", { name: "Show active stages" }));
    await currentOptions().queryFn({ signal: new AbortController().signal });
    expect(gateway.obligations).toHaveBeenLastCalledWith(
      expect.objectContaining({ state: "active", cursor: undefined }),
      expect.any(AbortSignal),
    );
  });
  it("revokes all dashboard evidence when a child page loses access", async () => {
    render(
      <DashboardPagedList
        kind="readiness"
        initial={initial}
        scope="scope"
        now={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next readiness" }));
    gateway.readiness.mockRejectedValue(
      new ApiClientError("api", "Denied", 403),
    );
    await expect(
      currentOptions().queryFn({ signal: new AbortController().signal }),
    ).rejects.toThrow("Denied");
    expect(query.setQueryData).toHaveBeenCalledWith(
      ["dashboard-access", "scope"],
      true,
    );
    expect(query.removeQueries).toHaveBeenCalledWith({
      queryKey: ["dashboard", "scope"],
    });
  });
  it("supports history and rejects foreign organization pages", async () => {
    render(
      <DashboardPagedList
        kind="obligations"
        initial={initial}
        scope="scope"
        now={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Show stage history" }));
    await currentOptions().queryFn({ signal: new AbortController().signal });
    expect(gateway.obligations).toHaveBeenCalledWith(
      expect.objectContaining({ state: "history" }),
      expect.any(AbortSignal),
    );
    gateway.obligations.mockResolvedValue({ organizationId: "foreign" });
    await expect(
      currentOptions().queryFn({ signal: new AbortController().signal }),
    ).rejects.toThrow("scope changed");
    fireEvent.click(screen.getByRole("button", { name: "Show active stages" }));
    expect(currentOptions().enabled).toBe(false);
  });
  it.each(["obligations", "readiness", "ingestion"] as const)(
    "renders parsed %s page",
    (kind) => {
      query.result.data = { organizationId: "tenant", [kind]: section };
      render(
        <DashboardPagedList
          kind={kind}
          initial={initial}
          scope="scope"
          now={0}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: `Next ${kind}` }));
      expect(
        screen.getByText(
          kind === "obligations"
            ? "Obligation records"
            : kind === "readiness"
              ? "Readiness records"
              : "Ingestion records",
        ),
      ).toBeVisible();
    },
  );
  it("shows loading and retained stale pages only for transient errors", () => {
    query.result.isLoading = true;
    const { rerender } = render(
      <DashboardPagedList
        kind="readiness"
        initial={initial}
        scope="scope"
        now={0}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Next readiness" }));
    expect(screen.getByRole("status")).toHaveTextContent("Loading more");
    query.result.isLoading = false;
    query.result.isError = true;
    query.result.error = new ApiClientError("network", "Offline");
    query.result.data = { organizationId: "tenant", readiness: section };
    rerender(
      <DashboardPagedList
        kind="readiness"
        initial={initial}
        scope="scope"
        now={0}
      />,
    );
    expect(screen.getByText(/records are stale/)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Retry list" }));
    expect(query.result.refetch).toHaveBeenCalled();
    query.result.error = new ApiClientError("api", "Denied", 403);
    rerender(
      <DashboardPagedList
        kind="readiness"
        initial={initial}
        scope="scope"
        now={0}
      />,
    );
    expect(screen.queryByText("Readiness records")).not.toBeInTheDocument();
    expect(screen.getByText(/records are unavailable/)).toBeVisible();
  });
});
