"use client";

import {
  DataTable,
  type ColumnDef,
  type DataTableVariant,
  type RowSelectionState,
} from "@repo/ui/data-table";
import { useState, type ReactNode } from "react";
import { useTableQuery } from "../../_lib/use-table-query";
import { TableToolbar } from "./table-toolbar";

/**
 * The chrome every Tables screen shares: breadcrumb band, search toolbar and
 * the table itself, wired to one `useTableQuery`.
 *
 * The breadcrumb trail lives in the shared TopNav, keyed off the route, so
 * it is not a prop here.
 *
 * Only the columns, endpoint and skin differ between the four frames, so
 * those are the props. Keeping the wiring here means a fix to the loading,
 * error or selection behaviour lands on all four at once.
 */

export interface TablePageProps<T> {
  endpoint: string;
  variant: DataTableVariant;
  columns: ColumnDef<T, unknown>[];
  ariaLabel: string;
  searchPlaceholder: string;
  getRowId: (row: T) => string;
  toolbarActions?: ReactNode;
}

export function TablePage<T>({
  endpoint,
  variant,
  columns,
  ariaLabel,
  searchPlaceholder,
  getRowId,
  toolbarActions,
}: TablePageProps<T>) {
  const [selection, setSelection] = useState<RowSelectionState>({});
  const t = useTableQuery<T>({ endpoint });

  return (
    <div className="flex flex-col px-6 pb-8 lg:px-[30px]">
      <TableToolbar
        value={t.search}
        onChange={t.setSearch}
        placeholder={searchPlaceholder}
        resultCount={t.total}
        actions={toolbarActions}
      />

      <DataTable
        variant={variant}
        ariaLabel={ariaLabel}
        columns={columns}
        data={t.rows}
        getRowId={getRowId}
        sorting={t.sorting}
        onSortingChange={t.setSorting}
        rowSelection={selection}
        onRowSelectionChange={setSelection}
        page={t.page}
        pageCount={t.pageCount}
        pageSize={t.pageSize}
        total={t.total}
        onPageChange={t.setPage}
        onPageSizeChange={t.setPageSize}
        isLoading={t.isLoading}
        isFetching={t.isFetching}
        error={t.isError ? t.error : undefined}
        onRetry={() => t.refetch()}
      />
    </div>
  );
}
