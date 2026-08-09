// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const query = vi.hoisted(() => ({
  useTableQuery: vi.fn(),
  refetch: vi.fn(),
  setPage: vi.fn(),
  setPageSize: vi.fn(),
  setSearch: vi.fn(),
  setSorting: vi.fn(),
}));

vi.mock("../../_lib/use-table-query", () => ({
  useTableQuery: query.useTableQuery,
}));
vi.mock("@repo/ui/data-table", () => ({
  selectionColumn: ({
    rowLabel,
  }: {
    rowLabel: (row: Record<string, unknown>) => string;
  }) => ({
    id: "selection",
    rowLabel,
  }),
  DataTable: ({
    ariaLabel,
    variant,
    columns,
    getRowId,
    onRetry,
    onRowSelectionChange,
  }: {
    ariaLabel: string;
    variant: string;
    columns: Array<{
      id?: string;
      accessorKey?: string;
      cell?: (context: {
        row: { original: Record<string, unknown> };
      }) => ReactNode;
    }>;
    getRowId: (row: Record<string, unknown>) => string;
    onRetry: () => void;
    onRowSelectionChange: (selection: Record<string, boolean>) => void;
  }) => {
    const rows: Record<string, Record<string, unknown>> = {
      Products: {
        id: "product-1",
        no: 1,
        sku: "SKU-1",
        name: "Standing desk",
        updatedAt: "9 Aug 2026",
        category: "Furniture",
        quantity: 4,
        price: "$499",
        status: "Active",
      },
      Orders: {
        id: "order-1",
        no: 1,
        orderNo: "ORD-1",
        trackingId: "TRACK-1",
        createdAt: "9 Aug 2026",
        source: "Web",
        status: "Opened",
        quantity: 2,
        price: "$42",
      },
      Customers: {
        id: "customer-1",
        no: 1,
        firstName: "Ada",
        lastName: "Lovelace",
        orders: 3,
        email: "ada@example.com",
        phone: "+1 555 0100",
        status: "Active",
      },
      Coins: {
        id: "coin-1",
        no: 1,
        name: "Bitcoin",
        symbol: "BTC",
        marketCap: "$1.2T",
        price: "$64,180",
        h1: 0.4,
        h24: 2.1,
        d7: -1.2,
        d30: 8.4,
      },
    };
    const original = rows[ariaLabel]!;
    return (
      <div
        role="table"
        aria-label={ariaLabel}
        data-variant={variant}
        data-row-id={getRowId(original)}
      >
        {columns.map((column, index) => (
          <div key={column.id ?? column.accessorKey ?? index} role="cell">
            {column.cell?.({ row: { original } })}
          </div>
        ))}
        <button type="button" onClick={onRetry}>
          Retry table
        </button>
        <button
          type="button"
          onClick={() => onRowSelectionChange({ [getRowId(original)]: true })}
        >
          Select row
        </button>
      </div>
    );
  },
}));

import BasicTablesPage from "../basic/page";
import BorderedTablesPage from "../bordered/page";
import SplittedTablesPage from "../splitted/page";
import StripedTablesPage from "../striped/page";
import { Change, Plain, RowActions, Stacked, StatusTag } from "./cells";
import { TableToolbar } from "./table-toolbar";

beforeEach(() => {
  query.useTableQuery.mockReturnValue({
    rows: [],
    search: "",
    sorting: [],
    page: 1,
    pageCount: 1,
    pageSize: 15,
    total: 0,
    isLoading: false,
    isFetching: false,
    isError: false,
    error: null,
    refetch: query.refetch,
    setPage: query.setPage,
    setPageSize: query.setPageSize,
    setSearch: query.setSearch,
    setSorting: query.setSorting,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("table components", () => {
  it("renders shared cell semantics and directional changes", () => {
    render(
      <>
        <Stacked value="Primary" caption="Secondary" />
        <Stacked value="Without caption" />
        <Plain value="Muted" muted />
        <Plain value="Normal" />
        <StatusTag value="Active" />
        <StatusTag value="Inactive" />
        <StatusTag value="Opened" />
        <StatusTag value="Closed" />
        <StatusTag value="Delivered" />
        <Change value={2.345} />
        <Change value={-1.2} />
        <RowActions label="Actions for row" />
      </>,
    );

    expect(screen.getByText("Secondary")).toHaveClass("text-fg-muted");
    expect(screen.getByText("+2.35%")).toHaveClass("text-success-fg");
    expect(screen.getByText("-1.20%")).toHaveClass("text-danger-fg");
    expect(
      screen.getByRole("button", { name: "Actions for row" }),
    ).toBeVisible();
  });

  it("debounces search, clears locally, and synchronizes external values", async () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    const view = render(
      <TableToolbar
        value="old"
        onChange={onChange}
        placeholder="Search products"
        resultCount={2}
      />,
    );
    const input = screen.getByRole("searchbox", { name: "Search products" });
    expect(screen.getByText("2 results")).toBeVisible();

    fireEvent.change(input, { target: { value: "desk" } });
    act(() => vi.advanceTimersByTime(299));
    expect(onChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onChange).toHaveBeenCalledWith("desk");

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    expect(input).toHaveValue("");
    view.rerender(
      <TableToolbar value="server" onChange={onChange} resultCount={1} />,
    );
    expect(screen.getByRole("searchbox")).toHaveValue("server");
    expect(screen.getByText("1 result")).toBeVisible();
  });

  it.each([
    [BasicTablesPage, "/api/products", "Products", "basic", "Standing desk"],
    [StripedTablesPage, "/api/orders", "Orders", "striped", "ORD-1"],
    [
      BorderedTablesPage,
      "/api/customers",
      "Customers",
      "bordered",
      "Ada Lovelace",
    ],
    [SplittedTablesPage, "/api/coins", "Coins", "splitted", "Bitcoin"],
  ] as const)(
    "wires %s through the controlled table boundary",
    async (Page, endpoint, label, variant, rowText) => {
      const user = userEvent.setup();
      render(<Page />);

      expect(query.useTableQuery).toHaveBeenCalledWith(
        expect.objectContaining({ endpoint }),
      );
      expect(screen.getByRole("table", { name: label })).toHaveAttribute(
        "data-variant",
        variant,
      );
      expect(screen.getByText(rowText)).toBeInTheDocument();

      await user.click(screen.getByRole("button", { name: "Retry table" }));
      expect(query.refetch).toHaveBeenCalled();
      await user.click(screen.getByRole("button", { name: "Select row" }));
    },
  );
});
