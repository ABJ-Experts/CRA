// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const query = vi.hoisted(() => ({
  useDashboardQuery: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("./dashboard.queries", () => query);
vi.mock("../../dashboard/_components/dashboard-onboarding-resume", () => ({
  DashboardOnboardingResume: () => (
    <div data-testid="onboarding-resume">Resume onboarding</div>
  ),
}));
vi.mock("./dashboard-pages", () => ({
  DashboardPagedList: ({ kind }: { kind: string }) => <div>{kind} page</div>,
}));
import { DashboardContent } from "./dashboard-content";
const hidden = { state: "restricted", observedAt: null, updatedAt: null };
const timestamp = "2026-10-07T12:00:00Z";
const productId = "11111111-1111-4111-8111-111111111111";
const base = {
  live: true,
  enabled: true,
  isFetching: false,
  isLoading: false,
  isError: false,
  sessionLoading: false,
  stale: false,
  scope: "scope",
  refetch: query.refetch,
};
const projection = {
  organizationId: productId,
  serverNow: timestamp,
  generatedAt: timestamp,
  products: hidden,
  findings: hidden,
  obligations: hidden,
  readiness: hidden,
  sbomCoverage: hidden,
  ingestion: hidden,
  feedFreshness: hidden,
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
beforeEach(() => {
  query.useDashboardQuery.mockReturnValue(base);
  query.refetch.mockReset();
});
describe("CRA dashboard page", () => {
  it("places the countdown before onboarding and product summaries", () => {
    query.useDashboardQuery.mockReturnValue({
      ...base,
      data: {
        projection: {
          ...projection,
          products: {
            state: "available",
            observedAt: timestamp,
            updatedAt: timestamp,
            data: { activeProducts: 3, archivedProducts: 1, totalProducts: 4 },
          },
        },
        receivedAt: 0,
      },
    });
    render(<DashboardContent />);
    const countdown = screen.getByTestId("dashboard-countdown");
    for (const element of [
      screen.getByTestId("onboarding-resume"),
      screen.getByText("3 active products"),
    ]) {
      expect(
        countdown.compareDocumentPosition(element) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }
  });

  it("requires live records instead of showing demo commerce figures", () => {
    query.useDashboardQuery.mockReturnValue({
      ...base,
      live: false,
      enabled: false,
    });
    render(<DashboardContent />);
    expect(
      screen.getByRole("heading", { name: "CRA dashboard" }),
    ).toBeVisible();
    expect(screen.getByText("Live backend required")).toBeVisible();
    expect(screen.queryByText("Total revenue")).not.toBeInTheDocument();
  });
  it("shows access/loading/failure states without old evidence", () => {
    for (const state of [
      { sessionLoading: true, enabled: false },
      { enabled: false },
      { isLoading: true },
      { isError: true },
    ]) {
      query.useDashboardQuery.mockReturnValue({ ...base, ...state });
      render(<DashboardContent />);
      expect(
        screen.queryByTestId("dashboard-countdown"),
      ).not.toBeInTheDocument();
      cleanup();
    }
  });
  it("renders hierarchy refresh controls source freshness and stale banner", () => {
    query.useDashboardQuery.mockReturnValue({
      ...base,
      stale: true,
      isError: true,
      data: {
        projection: {
          ...projection,
          products: {
            state: "available",
            observedAt: timestamp,
            updatedAt: timestamp,
            data: { activeProducts: 3, archivedProducts: 1, totalProducts: 4 },
          },
          ingestion: { ...hidden, state: "unavailable" },
        },
        receivedAt: 0,
      },
    });
    render(<DashboardContent />);
    expect(screen.getByTestId("dashboard-countdown")).toBeVisible();
    expect(screen.getByText(/Displayed evidence is stale/)).toBeVisible();
    expect(screen.getByText(/Some sources are unavailable/)).toBeVisible();
    expect(screen.getByText("3 active products")).toBeVisible();
    expect(screen.getByText(/Times shown in/)).toBeVisible();
    fireEvent.click(screen.getByTestId("dashboard-refresh"));
    expect(query.refetch).toHaveBeenCalled();
  });
  it("renders product-specific support posture and neutral missing classification", () => {
    const sections = Object.fromEntries(
      Object.entries(projection).filter(([key]) => key !== "products"),
    );
    query.useDashboardQuery.mockReturnValue({
      ...base,
      data: {
        projection: {
          ...sections,
          product: {
            productId,
            productName: "Hub",
            archived: false,
            classification: null,
            support: {
              state: "active",
              endsAt: timestamp,
              startsAt: timestamp,
            },
          },
        },
        receivedAt: 0,
      },
    });
    const { rerender } = render(<DashboardContent productId={productId} />);
    expect(screen.getByTestId("dashboard-posture")).toBeVisible();
    expect(
      screen
        .getByTestId("dashboard-countdown")
        .compareDocumentPosition(screen.getByRole("heading", { name: "Hub" })) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.getByText(/Classification not recorded/)).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Back to product" }),
    ).toHaveAttribute("href", `/products/${productId}`);
    query.useDashboardQuery.mockReturnValue({
      ...base,
      data: {
        projection: {
          ...sections,
          product: {
            productId,
            productName: "Hub",
            archived: true,
            classification: "default",
            support: { state: "missing", endsAt: null, startsAt: null },
          },
        },
        receivedAt: 0,
      },
    });
    rerender(<DashboardContent productId={productId} />);
    expect(screen.getByText(/Archived product/)).toBeVisible();
  });
  it("updates elapsed display only while visible and cleans up clock listeners", () => {
    vi.useFakeTimers();
    query.useDashboardQuery.mockReturnValue({
      ...base,
      data: { projection, receivedAt: 0 },
    });
    const { unmount } = render(<DashboardContent />);
    fireEvent(document, new Event("visibilitychange"));
    vi.advanceTimersByTime(1000);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    vi.advanceTimersByTime(1000);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
