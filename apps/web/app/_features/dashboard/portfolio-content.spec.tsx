// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const hooks = vi.hoisted(() => ({
  products: vi.fn(),
  concentration: vi.fn(),
  detail: vi.fn(),
  refetch: vi.fn(),
}));
vi.mock("./portfolio.queries", () => ({
  usePortfolioProducts: hooks.products,
  usePortfolioConcentration: hooks.concentration,
  usePortfolioDetail: hooks.detail,
}));
import { PortfolioContent } from "./portfolio-content";
const id = "11111111-1111-4111-8111-111111111111";
const now = "2026-10-12T10:00:00Z";
const hidden = { state: "restricted", observedAt: null, updatedAt: null };
const available = (data: unknown) => ({
  state: "available",
  observedAt: now,
  updatedAt: now,
  data,
});
const metadata = {
  organizationId: id,
  serverNow: now,
  generatedAt: now,
  scope: { legalEntityId: null, productId: null, includeArchived: false },
  coverage: hidden,
  matchingCoverage: hidden,
  feedFreshness: hidden,
};
const base = {
  enabled: true,
  live: true,
  sessionLoading: false,
  isLoading: false,
  isError: false,
  isFetching: false,
  stale: false,
  scope: "scope",
  identityScope: "identity",
  refetch: hooks.refetch,
};
const findings = available({
  openCount: 1,
  suppressedOpenCount: 0,
  bySeverity: { critical: 0, high: 1, medium: 0, low: 0, unknown: 0 },
});
beforeEach(() => {
  hooks.products.mockReturnValue({
    ...base,
    data: {
      ...metadata,
      products: available({
        rows: [
          {
            productId: id,
            productName: "Alpha",
            archived: false,
            classification: null,
            support: { state: "missing", startsAt: null, endsAt: null },
            legalEntityId: null,
            legalEntityName: null,
            sbomCoverage: hidden,
            findings,
            readiness: hidden,
          },
        ],
        nextCursor: "next",
      }),
    },
  });
  hooks.concentration.mockReturnValue({
    ...base,
    data: {
      ...metadata,
      concentration: available({
        rows: [
          {
            packageIdentity: "pkg:npm/example",
            version: "1.0",
            componentRef: "opaque",
            productCount: 2,
            releaseCount: 3,
            findings,
          },
        ],
        nextCursor: null,
      }),
    },
  });
  hooks.detail.mockReturnValue(base);
  hooks.refetch.mockReset();
});
afterEach(cleanup);
describe("PortfolioContent", () => {
  it("preserves unapplied filters, pagination and selected component on identity refetch", () => {
    const view = render(<PortfolioContent />);
    fireEvent.click(screen.getByRole("button", { name: "Next product page" }));
    fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
    fireEvent.change(screen.getByLabelText("Product"), {
      target: { value: id },
    });
    fireEvent.click(
      screen.getByLabelText("Include archived marketed products and releases"),
    );
    hooks.products.mockReturnValue({
      ...hooks.products.mock.results.at(-1)?.value,
      scope: "refetched-scope",
    });
    view.rerender(<PortfolioContent />);
    expect(screen.getByLabelText("Product")).toHaveValue(id);
    expect(
      screen.getByLabelText("Include archived marketed products and releases"),
    ).toBeChecked();
    expect(hooks.products).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next", includeArchived: false }),
    );
    expect(
      screen.getByRole("heading", { name: "Affected products and releases" }),
    ).toBeVisible();
    expect(hooks.detail).toHaveBeenLastCalledWith(
      expect.objectContaining({ componentRef: "opaque" }),
    );
  });
  it.each(["identity", "denial"])(
    "clears sensitive draft and references on %s change",
    (change) => {
      const view = render(<PortfolioContent />);
      fireEvent.change(screen.getByLabelText("Product"), {
        target: { value: id },
      });
      fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
      hooks.products.mockReturnValue({
        ...base,
        identityScope: change === "identity" ? "other" : base.identityScope,
        enabled: change !== "denial",
      });
      view.rerender(<PortfolioContent />);
      expect(screen.getByLabelText("Product")).toHaveValue("");
      expect(
        screen.queryByRole("option", { name: "Alpha" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("heading", {
          name: "Affected products and releases",
        }),
      ).not.toBeInTheDocument();
    },
  );
  it("renders accessible comparison/concentration tables, distinct counts and protected drilldown", () => {
    render(<PortfolioContent />);
    expect(
      screen.getByRole("heading", { name: "Portfolio posture" }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Authorized product comparison" }),
    ).toBeVisible();
    expect(
      screen.getByRole("table", { name: "Shared component concentration" }),
    ).toBeVisible();
    expect(screen.getByRole("link", { name: "Alpha posture" })).toHaveAttribute(
      "href",
      `/products/${id}/posture`,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Inspect pkg:npm/example 1.0" }),
    );
    expect(hooks.detail).toHaveBeenLastCalledWith(
      expect.objectContaining({ componentRef: "opaque" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Close component details" }),
    );
    expect(
      screen.queryByRole("heading", { name: "Affected products and releases" }),
    ).not.toBeInTheDocument();
  });
  it("applies named product and archive scope with reset pagination", () => {
    render(<PortfolioContent />);
    fireEvent.change(screen.getByLabelText("Product"), {
      target: { value: id },
    });
    fireEvent.click(
      screen.getByLabelText("Include archived marketed products and releases"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Apply scope" }));
    expect(hooks.products).toHaveBeenLastCalledWith(
      expect.objectContaining({
        productId: id,
        includeArchived: true,
        cursor: undefined,
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next product page" }));
    expect(hooks.products).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "next" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Refresh portfolio" }));
    expect(hooks.products).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: undefined }),
    );
  });
  it("distinguishes demo, denied, loading, transient stale and empty states", () => {
    hooks.products.mockReturnValue({ ...base, live: false, enabled: false });
    const view = render(<PortfolioContent />);
    expect(screen.getByText(/Live backend required/)).toBeVisible();
    hooks.products.mockReturnValue({ ...base, enabled: false });
    view.rerender(<PortfolioContent />);
    expect(screen.getByText(/Portfolio access is unavailable/)).toBeVisible();
    hooks.products.mockReturnValue({ ...base, isLoading: true });
    view.rerender(<PortfolioContent />);
    expect(screen.getByText(/Loading portfolio evidence/)).toBeVisible();
    hooks.products.mockReturnValue({
      ...base,
      isError: true,
      stale: true,
      data: {
        ...metadata,
        products: available({ rows: [], nextCursor: null }),
      },
    });
    view.rerender(<PortfolioContent />);
    expect(
      screen.getByText(/Displayed portfolio evidence is stale/),
    ).toBeVisible();
    expect(screen.getByText(/No authorized products/)).toBeVisible();
  });
  it("supports named entity filtering, source failures, retry and detail loading/conflict", () => {
    const row = {
      productId: id,
      productName: "Alpha",
      archived: false,
      classification: null,
      support: { state: "missing", startsAt: null, endsAt: null },
      legalEntityId: id,
      legalEntityName: "Entity",
      sbomCoverage: hidden,
      findings,
      readiness: hidden,
    };
    hooks.products.mockReturnValue({
      ...base,
      data: {
        ...metadata,
        products: available({ rows: [row], nextCursor: null }),
      },
    });
    hooks.detail.mockReturnValue({ ...base, isLoading: true });
    const view = render(<PortfolioContent />);
    fireEvent.change(screen.getByLabelText("Legal entity"), {
      target: { value: id },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply scope" }));
    expect(hooks.products).toHaveBeenLastCalledWith(
      expect.objectContaining({ legalEntityId: id }),
    );
    fireEvent.change(screen.getByLabelText("Legal entity"), {
      target: { value: "" },
    });
    fireEvent.change(screen.getByLabelText("Product"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
    expect(screen.getByText("Loading affected releases…")).toBeVisible();
    hooks.detail.mockReturnValue({ ...base, isError: true, stale: true });
    view.rerender(<PortfolioContent />);
    expect(
      screen.getByText("Displayed affected releases are stale."),
    ).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Refresh component reference" }),
    );
    expect(hooks.refetch).toHaveBeenCalled();
    hooks.products.mockReturnValue({ ...base, isError: true });
    view.rerender(<PortfolioContent />);
    fireEvent.click(screen.getByRole("button", { name: "Retry portfolio" }));
    hooks.products.mockReturnValue({ ...base, sessionLoading: true });
    view.rerender(<PortfolioContent />);
    expect(screen.getByText("Loading portfolio access…")).toBeVisible();
  });
  it("renders permitted detail evidence and propagates component pagination", () => {
    hooks.concentration.mockReturnValue({
      ...base,
      data: {
        ...metadata,
        concentration: available({
          rows: [
            {
              packageIdentity: "pkg:npm/example",
              version: "1.0",
              componentRef: "opaque",
              productCount: 2,
              releaseCount: 3,
              findings,
            },
          ],
          nextCursor: "component-next",
        }),
      },
    });
    hooks.detail.mockReturnValue({
      ...base,
      data: {
        ...metadata,
        component: {
          packageIdentity: "pkg:npm/example",
          version: "1",
          componentRef: "opaque",
          productCount: 2,
          releaseCount: 2,
        },
        affectedReleases: hidden,
      },
    });
    render(<PortfolioContent />);
    fireEvent.click(
      screen.getByRole("button", { name: "Next component page" }),
    );
    expect(hooks.concentration).toHaveBeenLastCalledWith(
      expect.objectContaining({ cursor: "component-next" }),
    );
    fireEvent.click(screen.getByRole("button", { name: /Inspect/ }));
    expect(screen.getByText(/pkg:npm\/example · 1 · 2 distinct/)).toBeVisible();
  });
});
