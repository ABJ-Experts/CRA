// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  sources: vi.fn(),
  download: vi.fn(),
  products: vi.fn(),
}));
vi.mock("./dashboard-trends.queries", () => ({
  useDashboardTrends: mocks.query,
  useDashboardTrendSources: mocks.sources,
  downloadDashboardTrends: mocks.download,
  useDashboardTrendProducts: mocks.products,
}));
vi.mock("@repo/ui/chart", () => ({
  Chart: ({
    ariaLabel,
    build,
  }: {
    ariaLabel: string;
    build: (p: unknown) => unknown;
  }) => {
    build({
      fg: "black",
      fgMuted: "grey",
      active: "blue",
      success: "green",
      border: "grey",
    });
    return <div role="img" aria-label={ariaLabel} />;
  },
}));
import { DashboardTrendsPanel } from "./dashboard-trends-panel";
afterEach(cleanup);
beforeEach(() => {
  mocks.products.mockReturnValue({});
  mocks.download.mockReset().mockResolvedValue(undefined);
});
const bucket = {
  start: "2026-10-01T00:00:00Z",
  end: "2026-10-02T00:00:00Z",
  opened: 0,
  closed: 2,
  reopened: 1,
  value: null,
  sampleCount: 0,
  excludedCount: 0,
  numerator: null,
  denominator: null,
  sourceCount: 0,
  partial: false,
};
const series = {
  state: "available",
  reason: null,
  unit: "count",
  buckets: [bucket],
  baselineAt: "2026-10-01T00:00:00Z",
};
const data = {
  generatedAt: new Date().toISOString(),
  datasetToken: "token",
  policyVersion: "m14-02-v1",
  datasetRevision: "rev",
  baselineAt: series.baselineAt,
  filters: { timezone: "UTC" },
  series: {
    activity: series,
    triage: { ...series, unit: "hours" },
    remediation: { ...series, unit: "days" },
    sbomCoverage: { ...series, unit: "percent" },
    readiness: { ...series, unit: "percent" },
  },
};
describe("trend charts and equivalent tables", () => {
  it("distinguishes in-range SBOM observations from the eligible release denominator", () => {
    mocks.query.mockReturnValue({ data });
    mocks.sources.mockReturnValue({});
    render(<DashboardTrendsPanel scope="scope" enabled />);
    const table = screen.getByRole("table", {
      name: "SBOM release coverage values",
    });
    expect(
      within(table).getByRole("columnheader", { name: "Observations" }),
    ).toBeVisible();
    expect(
      within(table).getByRole("columnheader", { name: "Denominator" }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("columnheader", { name: "Sources" }),
    ).toHaveLength(4);
    expect(
      screen.getByText(/Coverage carries forward only from recorded history/),
    ).toBeVisible();
  });
  it("labels carried coverage context at its actual earlier observation date", () => {
    const observedAt = "2026-09-25T12:00:00Z";
    mocks.query.mockReturnValue({ data });
    mocks.sources.mockReturnValue({
      data: {
        items: [
          {
            id: "carried-fact",
            factKind: "carried_coverage_context",
            effectiveAt: observedAt,
            recordedAt: observedAt,
            provenance: "source_capture",
            href: "/products/a",
          },
        ],
        nextCursor: null,
      },
    });
    render(<DashboardTrendsPanel scope="scope" enabled />);
    fireEvent.click(
      screen.getByRole("button", {
        name: "View sbom release coverage sources",
      }),
    );
    const actualDate = new Intl.DateTimeFormat(undefined, {
      timeZone: "UTC",
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(observedAt));
    expect(
      screen.getByText(`carried coverage context · ${actualDate}`),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Open source record" }),
    ).toHaveAttribute("href", "/products/a");
  });
  it("renders five visible labeled tables with zero distinct from unavailable", () => {
    mocks.query.mockReturnValue({ data, refetch: vi.fn() });
    mocks.sources.mockReturnValue({});
    render(
      <DashboardTrendsPanel
        scope="scope"
        enabled
        productId="11111111-1111-4111-8111-111111111111"
      />,
    );
    expect(screen.getAllByRole("table")).toHaveLength(5);
    expect(screen.getAllByText("Unavailable").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("columnheader", { name: "Reopened" }),
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Export displayed dataset (CSV)" }),
    ).toBeEnabled();
  });
  it("keeps range inputs after failure and offers explicit refresh", () => {
    mocks.query.mockReturnValue({ isError: true, refetch: vi.fn() });
    mocks.sources.mockReturnValue({});
    render(<DashboardTrendsPanel scope="scope" enabled />);
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2026-01-01" },
    });
    expect(screen.getByLabelText("From date")).toHaveValue("2026-01-01");
    expect(screen.getByRole("alert")).toHaveTextContent("unavailable");
  });
  it("withholds the panel when dashboard identity is unavailable", () => {
    mocks.query.mockReturnValue({});
    mocks.sources.mockReturnValue({});
    render(<DashboardTrendsPanel scope="scope" enabled={false} />);
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

it("applies validated filters, searches authorized products and handles export failures", async () => {
  const refetch = vi.fn();
  mocks.query.mockReturnValue({ data, refetch, exportDataset: mocks.download });
  mocks.sources.mockReturnValue({});
  mocks.products.mockReturnValue({
    data: {
      products: {
        rows: [{ id: "11111111-1111-4111-8111-111111111111", name: "Router" }],
      },
    },
  });
  render(<DashboardTrendsPanel scope="scope" enabled canSelectProduct />);
  fireEvent.change(screen.getByLabelText("Find product"), {
    target: { value: "router" },
  });
  fireEvent.change(screen.getByLabelText("Product cohort"), {
    target: { value: "11111111-1111-4111-8111-111111111111" },
  });
  fireEvent.change(screen.getByLabelText("From date"), {
    target: { value: "2026-10-01" },
  });
  fireEvent.change(screen.getByLabelText("To date"), {
    target: { value: "2026-10-08" },
  });
  fireEvent.change(screen.getByLabelText("Timezone"), {
    target: { value: "invalid" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply trend filters" }));
  expect(screen.getByRole("alert")).toHaveTextContent("IANA");
  fireEvent.change(screen.getByLabelText("Timezone"), {
    target: { value: "UTC" },
  });
  fireEvent.change(screen.getByLabelText("Time bucket"), {
    target: { value: "week" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Apply trend filters" }));
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Apply trend filters" }));
  expect(refetch).toHaveBeenCalled();
  mocks.download.mockRejectedValueOnce(new Error("expired"));
  fireEvent.click(
    screen.getByRole("button", { name: "Export displayed dataset (CSV)" }),
  );
  await screen.findByText(/Export unavailable/);
});
it("opens contributor evidence, pages it and closes stale drawers", () => {
  mocks.query.mockReturnValue({ data, refetch: vi.fn() });
  mocks.sources.mockReturnValue({
    data: {
      items: [
        {
          id: "fact",
          factKind: "first_triage",
          effectiveAt: bucket.start,
          recordedAt: bucket.start,
          provenance: "source",
          href: "/products/a",
        },
      ],
      nextCursor: "next",
    },
  });
  const { rerender } = render(<DashboardTrendsPanel scope="scope" enabled />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  );
  expect(
    screen.getByRole("link", { name: "Open source record" }),
  ).toHaveAttribute("href", "/products/a");
  fireEvent.click(screen.getByRole("button", { name: "Next source page" }));
  fireEvent.click(screen.getByRole("button", { name: "Close source records" }));
  expect(
    screen.queryByRole("link", { name: "Open source record" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  );
  mocks.query.mockReturnValue({ data: { ...data, datasetToken: "fresh" } });
  rerender(<DashboardTrendsPanel scope="scope" enabled />);
  expect(
    screen.queryByRole("link", { name: "Open source record" }),
  ).not.toBeInTheDocument();
});
it("keeps capped source rows and explains why continuation is unavailable", () => {
  mocks.query.mockReturnValue({ data });
  mocks.sources.mockReturnValue({
    data: {
      items: [
        {
          id: "fact",
          factKind: "first_triage",
          effectiveAt: bucket.start,
          recordedAt: bucket.start,
          provenance: "source",
          href: "/products/a",
        },
      ],
      nextCursor: null,
      continuationUnavailable: "source_page_limit",
    },
  });
  render(<DashboardTrendsPanel scope="scope" enabled />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  );
  expect(screen.getByRole("status")).toHaveTextContent(
    "More source records exist. Narrow the date range to continue.",
  );
  expect(
    screen.getByRole("link", { name: "Open source record" }),
  ).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "Next source page" }),
  ).not.toBeInTheDocument();
});
it("pauses fresh datasets only while an unexpired source view is open and clears it on scope changes", () => {
  mocks.query.mockReturnValue({ data, refetch: vi.fn() });
  mocks.sources.mockReturnValue({ data: { items: [], nextCursor: null } });
  const { rerender } = render(<DashboardTrendsPanel scope="scope" enabled />);
  expect(mocks.query.mock.lastCall?.[3]).toBe(false);
  fireEvent.click(
    screen.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  );
  expect(mocks.query.mock.lastCall?.[3]).toBe(true);
  expect(
    screen.getByRole("region", {
      name: "Findings opened and closed source records",
    }),
  ).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Close source records" }));
  expect(mocks.query.mock.lastCall?.[3]).toBe(false);
  fireEvent.click(
    screen.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  );
  rerender(<DashboardTrendsPanel scope="other-scope" enabled />);
  expect(mocks.query.mock.lastCall?.[3]).toBe(false);
  expect(
    screen.queryByRole("region", {
      name: "Findings opened and closed source records",
    }),
  ).not.toBeInTheDocument();
});
it("drops the source view when its dataset expires", () => {
  vi.useFakeTimers();
  mocks.query.mockReturnValue({ data, refetch: vi.fn() });
  mocks.sources.mockReturnValue({ data: { items: [], nextCursor: null } });
  const { rerender } = render(<DashboardTrendsPanel scope="scope" enabled />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  );
  vi.setSystemTime(new Date(Date.parse(data.generatedAt) + 15 * 60 * 1000));
  rerender(<DashboardTrendsPanel scope="scope" enabled />);
  expect(mocks.query.mock.lastCall?.[3]).toBe(false);
  expect(
    screen.queryByRole("region", {
      name: "Findings opened and closed source records",
    }),
  ).not.toBeInTheDocument();
  vi.useRealTimers();
});
it("labels sparse or restricted series and expired datasets without offering stale export", () => {
  mocks.query.mockReturnValue({
    data: {
      ...data,
      generatedAt: "2020-01-01T00:00:00Z",
      series: {
        ...data.series,
        activity: {
          ...series,
          state: "restricted",
          reason: "Source permission required",
          buckets: [],
          baselineAt: null,
        },
        triage: { ...series, state: "unavailable", buckets: [] },
      },
    },
    isLoading: true,
  });
  mocks.sources.mockReturnValue({});
  mocks.products.mockReturnValue({ isError: true });
  render(<DashboardTrendsPanel scope="scope" enabled canSelectProduct />);
  expect(screen.getByText("Source access restricted.")).toBeVisible();
  expect(screen.getByText(/Dataset expired/)).toBeVisible();
  expect(
    screen.getByRole("button", { name: "Export displayed dataset (CSV)" }),
  ).toBeDisabled();
});
it("shows source loading, failure and empty provenance states", () => {
  mocks.query.mockReturnValue({ data });
  mocks.sources.mockReturnValue({ isLoading: true, isError: true });
  const { rerender } = render(<DashboardTrendsPanel scope="scope" enabled />);
  fireEvent.click(
    screen.getByRole("button", {
      name: "View findings opened and closed sources",
    }),
  );
  expect(screen.getByText("Loading contributing facts…")).toBeVisible();
  expect(screen.getByRole("alert")).toHaveTextContent(
    "Source records unavailable",
  );
  mocks.sources.mockReturnValue({ data: { items: [], nextCursor: null } });
  rerender(<DashboardTrendsPanel scope="scope" enabled />);
  expect(screen.getByText(/No contributing records/)).toBeVisible();
});

it("renders partial bucket status from pinned server facts", () => {
  mocks.query.mockReturnValue({
    data: {
      ...data,
      series: {
        ...data.series,
        activity: { ...series, buckets: [{ ...bucket, partial: true }] },
      },
    },
  });
  mocks.sources.mockReturnValue({});
  render(<DashboardTrendsPanel scope="scope" enabled />);
  expect(screen.getByRole("rowheader", { name: /partial/ })).toBeVisible();
});

it("never presents provider reason identifiers or unrecognized messages as UI copy", () => {
  mocks.query.mockReturnValue({
    data: {
      ...data,
      series: {
        ...data.series,
        triage: {
          ...series,
          state: "unavailable",
          reason: "select_product",
          buckets: [],
        },
        remediation: {
          ...series,
          state: "unavailable",
          reason: "unrecognized_private_text",
          buckets: [],
        },
      },
    },
  });
  mocks.sources.mockReturnValue({});
  render(<DashboardTrendsPanel scope="scope" enabled />);
  expect(
    screen.getByText(
      "Select a product to view its duration and readiness history.",
    ),
  ).toBeVisible();
  expect(screen.queryByText("select_product")).not.toBeInTheDocument();
  expect(
    screen.queryByText("unrecognized_private_text"),
  ).not.toBeInTheDocument();
  expect(
    screen.getByText("Historical observations unavailable."),
  ).toBeVisible();
});
it("supports explicit horizontal keyboard scrolling across browser engines", () => {
  mocks.query.mockReturnValue({ data });
  mocks.sources.mockReturnValue({});
  render(<DashboardTrendsPanel scope="scope" enabled />);
  const area = screen.getByRole("region", {
    name: "Findings opened and closed table scroll area",
  });
  const scrollBy = vi.fn();
  Object.defineProperties(area, {
    scrollWidth: { value: 1000, configurable: true },
    clientWidth: { value: 300, configurable: true },
    scrollBy: { value: scrollBy },
  });
  fireEvent.keyDown(area, { key: "ArrowRight" });
  expect(scrollBy).toHaveBeenCalledWith({ left: 96, behavior: "auto" });
  fireEvent.keyDown(area, { key: "ArrowLeft" });
  expect(scrollBy).toHaveBeenLastCalledWith({ left: -96, behavior: "auto" });
  fireEvent.keyDown(area, { key: "Tab" });
  fireEvent.keyDown(area, { key: "ArrowRight", altKey: true });
  expect(scrollBy).toHaveBeenCalledTimes(2);
  Object.defineProperty(area, "scrollWidth", { value: 100 });
  fireEvent.keyDown(area, { key: "ArrowRight" });
  expect(scrollBy).toHaveBeenCalledTimes(2);
});
