"use client";

import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type RowSelectionState,
  type SortingState,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";
import { Pagination } from "../pagination";
import {
  tableCellVariants,
  tableHeadVariants,
  tableRowVariants,
  type DataTableVariant,
} from "./data-table.variants";

/**
 * DataTable - the table body shared by all four Tables screens.
 *
 * Wraps TanStack Table and renders REAL table semantics (`table`/`thead`/
 * `th`/`td`) rather than a grid of divs, so row and column relationships,
 * sort state and the selection summary are all exposed to assistive tech for
 * free. The `splitted` skin still works because `border-separate` gives each
 * row its own box without leaving table layout.
 *
 * Everything stateful is CONTROLLED and server-driven by default: sorting,
 * pagination and selection are props. The four screens all page against
 * mocked endpoints, so the table must never hold a private copy of the page
 * or sort that could disagree with the query key.
 *
 * ```tsx
 * <DataTable
 *   variant="striped"
 *   columns={columns}
 *   data={rows}
 *   page={page} pageCount={pageCount} total={total}
 *   onPageChange={setPage}
 * />
 * ```
 */

export interface DataTableProps<T> {
  columns: ColumnDef<T, unknown>[];
  data: T[];
  variant?: DataTableVariant;

  /** Accessible name. Required: a bare table announces only "table". */
  ariaLabel: string;

  /* --- sorting (server-side by default) --------------------------------- */
  sorting?: SortingState;
  onSortingChange?: OnChangeFn<SortingState>;

  /* --- selection --------------------------------------------------------- */
  rowSelection?: RowSelectionState;
  onRowSelectionChange?: OnChangeFn<RowSelectionState>;
  /** Stable id per row. Without it selection is keyed by index, which points
   *  at a different record after paging or sorting. */
  getRowId?: (row: T, index: number) => string;

  /* --- pagination -------------------------------------------------------- */
  page?: number;
  pageCount?: number;
  pageSize?: number;
  total?: number;
  onPageChange?: (page: number) => void;
  onPageSizeChange?: (size: number) => void;
  pageSizeOptions?: number[];

  /* --- status ------------------------------------------------------------ */
  /** First load. Renders skeleton rows so the layout does not jump. */
  isLoading?: boolean;
  /** A refetch behind existing data. Dims rather than replacing them. */
  isFetching?: boolean;
  error?: ReactNode;
  onRetry?: () => void;
  emptyState?: ReactNode;
  /** Skeleton row count while loading. */
  skeletonRows?: number;

  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  variant = "basic",
  ariaLabel,
  sorting,
  onSortingChange,
  rowSelection,
  onRowSelectionChange,
  getRowId,
  page,
  pageCount,
  pageSize,
  total,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions,
  isLoading = false,
  isFetching = false,
  error,
  onRetry,
  emptyState,
  skeletonRows = 10,
  className,
}: DataTableProps<T>) {
  const table = useReactTable({
    data,
    columns,
    getCoreRowModel: getCoreRowModel(),
    /* Sorting and pagination happen on the server; the table must not also
     * sort or slice locally or the two would fight and the visible page would
     * disagree with the row count in the pager. */
    manualSorting: true,
    manualPagination: true,
    enableRowSelection: Boolean(onRowSelectionChange),
    state: {
      ...(sorting ? { sorting } : {}),
      ...(rowSelection ? { rowSelection } : {}),
    },
    onSortingChange,
    onRowSelectionChange,
    getRowId,
  });

  const colCount = table.getAllLeafColumns().length;
  const showPager = page != null && pageCount != null && onPageChange != null;
  const isEmpty = !isLoading && !error && data.length === 0;

  return (
    <div className={cn("flex w-full flex-col", className)}>
      {/* The table can be wider than the column below `lg`; it scrolls in its
          own box so the PAGE never scrolls sideways. */}
      <div className="w-full overflow-x-auto">
        <table
          aria-label={ariaLabel}
          aria-busy={isLoading || isFetching || undefined}
          className={cn(
            "w-full min-w-[720px] caption-bottom",
            variant === "splitted"
              ? "border-separate border-spacing-y-2"
              : "border-collapse"
          )}
        >
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const canSort = header.column.getCanSort();
                  const dir = header.column.getIsSorted();
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      style={{ width: header.getSize() ? header.getSize() : undefined }}
                      /* Native sort semantics, so a screen reader announces
                       * the current order instead of just a clickable label. */
                      aria-sort={
                        !canSort
                          ? undefined
                          : dir === "asc"
                            ? "ascending"
                            : dir === "desc"
                              ? "descending"
                              : "none"
                      }
                      className={tableHeadVariants({ variant, sortable: canSort })}
                    >
                      {header.isPlaceholder ? null : canSort ? (
                        <button
                          type="button"
                          onClick={header.column.getToggleSortingHandler()}
                          className={cn(
                            "flex items-center gap-1.5 text-caption-1-semibold",
                            "outline-none focus-visible:ring-2 focus-visible:ring-active-500",
                            "rounded-sm transition-colors hover:text-fg"
                          )}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {dir === "asc" ? (
                            <ArrowUp aria-hidden="true" className="size-3.5" />
                          ) : dir === "desc" ? (
                            <ArrowDown aria-hidden="true" className="size-3.5" />
                          ) : (
                            <ChevronsUpDown aria-hidden="true" className="size-3.5 opacity-50" />
                          )}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>

          <tbody className={cn(isFetching && !isLoading && "opacity-60 transition-opacity")}>
            {isLoading
              ? Array.from({ length: skeletonRows }, (_, r) => (
                  <tr key={`sk-${r}`} className={tableRowVariants({ variant })}>
                    {Array.from({ length: colCount }, (_, c) => (
                      <td key={c} className={tableCellVariants({ variant })}>
                        <div className="h-3 w-full max-w-[120px] animate-pulse rounded-full bg-surface-muted" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    data-state={row.getIsSelected() ? "selected" : undefined}
                    className={tableRowVariants({
                      variant,
                      selected: row.getIsSelected(),
                    })}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className={tableCellVariants({ variant })}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}

            {error ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <div
                    role="alert"
                    className="flex flex-col items-center gap-3 px-6 py-14 text-center"
                  >
                    <p className="text-subhead-medium text-fg">Could not load this table</p>
                    <p className="text-caption-1-regular text-fg-muted">{error}</p>
                    {onRetry ? (
                      <button
                        type="button"
                        onClick={onRetry}
                        className={cn(
                          "rounded-xl border border-border px-4 py-2",
                          "text-caption-1-semibold text-fg-muted transition-colors",
                          "hover:bg-surface hover:text-fg",
                          "outline-none focus-visible:ring-2 focus-visible:ring-active-500"
                        )}
                      >
                        Try again
                      </button>
                    ) : null}
                  </div>
                </td>
              </tr>
            ) : null}

            {isEmpty ? (
              <tr>
                <td colSpan={colCount} className="p-0">
                  <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                    {emptyState ?? (
                      <>
                        <p className="text-subhead-medium text-fg">Nothing to show</p>
                        <p className="text-caption-1-regular text-fg-muted">
                          Try clearing the search or filters.
                        </p>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>

      {showPager ? (
        <Pagination
          page={page}
          pageCount={pageCount}
          onPageChange={onPageChange}
          pageSize={pageSize}
          pageSizeOptions={pageSizeOptions}
          onPageSizeChange={onPageSizeChange}
          total={total}
        />
      ) : null}
    </div>
  );
}
