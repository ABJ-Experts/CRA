import type { ColumnDef } from "@tanstack/react-table";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DataTable } from "./data-table";
import { selectionColumn } from "./selection-column";

interface Person {
  id: string;
  name: string;
}
const columns: ColumnDef<Person, unknown>[] = [
  selectionColumn<Person>({ rowLabel: (row) => row.name }),
  { accessorKey: "name", header: "Name", enableSorting: true },
];
const rows = [
  { id: "1", name: "Ada" },
  { id: "2", name: "Grace" },
];

describe("DataTable", () => {
  it("renders semantic rows, controlled selection, sorting, and pagination", async () => {
    const onSortingChange = vi.fn();
    const onSelection = vi.fn();
    const onPageChange = vi.fn();
    render(
      <DataTable
        ariaLabel="Members"
        columns={columns}
        data={rows}
        getRowId={(row) => row.id}
        sorting={[]}
        onSortingChange={onSortingChange}
        rowSelection={{ "1": true }}
        onRowSelectionChange={onSelection}
        page={1}
        pageCount={2}
        onPageChange={onPageChange}
        variant="striped"
      />,
    );
    expect(screen.getByRole("table", { name: "Members" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Select Ada" })).toBeChecked();
    await userEvent.click(screen.getByRole("button", { name: /name/i }));
    expect(onSortingChange).toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("checkbox", { name: "Select Grace" }),
    );
    expect(onSelection).toHaveBeenCalled();
    await userEvent.click(
      screen.getAllByRole("button", { name: "Next page" })[0]!,
    );
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("renders loading and background-fetching states", () => {
    const { rerender } = render(
      <DataTable
        ariaLabel="Loading"
        columns={columns}
        data={[]}
        isLoading
        skeletonRows={2}
      />,
    );
    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
    expect(screen.getAllByRole("row")).toHaveLength(3);
    rerender(
      <DataTable
        ariaLabel="Refreshing"
        columns={columns}
        data={rows}
        isFetching
      />,
    );
    expect(screen.getByRole("table").querySelector("tbody")).toHaveClass(
      "opacity-60",
    );
  });

  it("shows retryable errors and empty states", async () => {
    const onRetry = vi.fn();
    const { rerender } = render(
      <DataTable
        ariaLabel="Failed"
        columns={columns}
        data={[]}
        error="Network unavailable"
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Network unavailable");
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(
      <DataTable
        ariaLabel="Empty"
        columns={columns}
        data={[]}
        emptyState={<p>No members</p>}
      />,
    );
    expect(screen.getByText("No members")).toBeInTheDocument();
  });
});
