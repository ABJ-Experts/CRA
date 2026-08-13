// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigation = vi.hoisted(() => ({
  pathname: "/dashboard",
  replace: vi.fn(),
}));
const table = vi.hoisted(() => ({
  refetch: vi.fn(),
  setPage: vi.fn(),
  setPageSize: vi.fn(),
  setSearch: vi.fn(),
  setSorting: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));
vi.mock("./_components/dashboard-onboarding-resume", () => ({
  DashboardOnboardingResume: () => null,
}));
vi.mock("./_lib/use-table-query", () => ({
  useTableQuery: () => ({
    ...table,
    rows: [],
    sorting: [],
    page: 1,
    pageCount: 1,
    pageSize: 15,
    total: 0,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
  }),
}));
vi.mock("@repo/ui/data-table", () => ({
  DataTable: ({
    ariaLabel,
    columns,
    getRowId,
  }: {
    ariaLabel: string;
    columns: Array<{
      id?: string;
      accessorKey?: string;
      cell?: (context: {
        row: { original: Record<string, unknown> };
      }) => React.ReactNode;
    }>;
    getRowId: (row: Record<string, unknown>) => string;
  }) => {
    const original =
      ariaLabel === "Latest orders"
        ? {
            id: "order-1",
            no: 1,
            orderNo: "ORD-001",
            trackingId: "TRACK-001",
            createdAt: "9 Aug 2026",
            source: "Web",
            status: "Completed",
            quantity: 2,
            price: "$48.00",
          }
        : {
            id: "coin-1",
            no: 1,
            name: "Bitcoin",
            symbol: "BTC",
            marketCap: "$1.2T",
            price: "$64,180",
            h24: 2.4,
            d7: -1.2,
          };
    return (
      <table aria-label={ariaLabel} data-row-id={getRowId(original)}>
        <tbody>
          <tr>
            {columns.map((column, index) => (
              <td key={column.id ?? column.accessorKey ?? index}>
                {column.cell?.({ row: { original } })}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    );
  },
}));
vi.mock("@repo/ui/chart", () => {
  const Chart = ({ ariaLabel }: { ariaLabel: string }) => (
    <div role="img" aria-label={ariaLabel} />
  );
  return {
    CandlestickChart: Chart,
    DonutChart: Chart,
    GaugeChart: Chart,
    HeatmapChart: Chart,
    MixedChart: Chart,
    RadialBar: Chart,
    ScatterChart: Chart,
    Sparkline: Chart,
    StackedBarChart: Chart,
  };
});
vi.mock("../_components/sidebar/sidebar", () => ({
  Sidebar: () => <nav aria-label="Sidebar" />,
}));
vi.mock("./organization-theme-provider", () => ({
  OrganizationThemeProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="organization-theme-provider">{children}</div>
  ),
}));

import ComingSoonPage from "./[...slug]/page";
import { PageHeading, SectionCard } from "./_components/dashboard-chrome";
import { DashboardTopNav } from "./_components/dashboard-top-nav";
import AnalyticsDashboardPage from "./analytics/page";
import CryptoDashboardPage from "./crypto/page";
import DashboardLayout from "./layout";
import EcommerceDashboardPage from "./page";
import ProjectDashboardPage from "./project/page";

beforeEach(() => {
  navigation.pathname = "/dashboard";
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class IntersectionObserver {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("dashboard pages", () => {
  it.each([
    [EcommerceDashboardPage, "Revenue & Summary", "Latest orders"],
    [
      AnalyticsDashboardPage,
      "Analytics with AI & Big Data",
      "Traffic by day and hour",
    ],
    [CryptoDashboardPage, "Total balance", "Portfolio holdings"],
    [ProjectDashboardPage, "Tasks overview", "Projects"],
  ] as const)(
    "renders %s as a complete dashboard composition",
    (Page, heading, accessibleName) => {
      render(<Page />);

      expect(screen.getByText(heading)).toBeInTheDocument();
      expect(
        screen.queryByRole("img", { name: accessibleName }) ??
          screen.queryByRole("table", { name: accessibleName }) ??
          screen.queryByRole("heading", { name: accessibleName }),
      ).toBeTruthy();
    },
  );

  it("binds table cell behavior to real order and portfolio rows", () => {
    const view = render(<EcommerceDashboardPage />);
    expect(screen.getByText("ORD-001")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Actions for order ORD-001" }),
    ).toBeInTheDocument();

    view.rerender(<CryptoDashboardPage />);
    expect(screen.getAllByText("Bitcoin").length).toBeGreaterThan(0);
    expect(
      screen.getByRole("button", { name: "Actions for Bitcoin" }),
    ).toBeInTheDocument();
  });

  it("renders shared heading and card chrome with optional content", () => {
    const view = render(
      <>
        <PageHeading
          title="Orders"
          subtitle="Latest activity"
          actions={<button type="button">Export</button>}
        />
        <SectionCard title="Summary" action={<span>Updated now</span>}>
          Card body
        </SectionCard>
      </>,
    );

    expect(screen.getByRole("heading", { name: "Orders" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Export" })).toBeVisible();
    expect(screen.getByRole("heading", { name: "Summary" })).toBeVisible();

    view.rerender(
      <>
        <PageHeading title="Orders" />
        <SectionCard>Untitled body</SectionCard>
      </>,
    );
    expect(screen.queryByText("Latest activity")).not.toBeInTheDocument();
    expect(screen.getByText("Untitled body")).toBeVisible();
  });

  it.each([
    ["/dashboard", "Welcome, Robert Fox"],
    ["/dashboard/tables/striped", "Striped Tables"],
    ["/dashboard/file-manager", "File Manager"],
  ])("orients users on %s", (pathname, label) => {
    navigation.pathname = pathname;
    render(<DashboardTopNav />);

    expect(screen.getByText(label)).toBeVisible();
  });

  it("wraps page content in the dashboard shell", () => {
    render(
      <DashboardLayout>
        <p>Dashboard content</p>
      </DashboardLayout>,
    );

    expect(screen.getByRole("navigation", { name: "Sidebar" })).toBeVisible();
    expect(screen.getByRole("main")).toHaveTextContent("Dashboard content");
    expect(
      screen.getByTestId("organization-theme-provider"),
    ).toBeInTheDocument();
  });

  it("turns a catch-all slug into a readable placeholder", async () => {
    const page = await ComingSoonPage({
      params: Promise.resolve({ slug: ["file-manager", "shared-files"] }),
    });
    render(page);

    expect(
      screen.getByRole("heading", { name: "Shared Files is not designed yet" }),
    ).toBeVisible();
    expect(
      screen.getByRole("link", { name: "Go to E-commerce" }),
    ).toHaveAttribute("href", "/dashboard");
  });
});
