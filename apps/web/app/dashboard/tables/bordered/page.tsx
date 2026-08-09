"use client";

import { Avatar } from "@repo/ui/avatar";
import { selectionColumn, type ColumnDef } from "@repo/ui/data-table";
import { useMemo } from "react";
import { TablePage } from "../_components/table-page";
import { Plain, RowActions, Stacked, StatusTag } from "../_components/cells";
import type { Customer } from "../../../../mocks/data/tables";

/** Tables / Bordered Tables - Pencil `O5lpFJ` (light), `SsGnE` (dark). */
export default function BorderedTablesPage() {
  const columns = useMemo<ColumnDef<Customer, unknown>[]>(
    () => [
      selectionColumn<Customer>({
        size: 44,
        rowLabel: (c) => `${c.firstName} ${c.lastName}`,
      }),
      {
        accessorKey: "no",
        header: "No.",
        size: 48,
        enableSorting: false,
        cell: ({ row }) => <Plain value={String(row.original.no)} muted />,
      },
      {
        accessorKey: "firstName",
        header: "Customer",
        size: 297,
        cell: ({ row }) => (
          <div className="flex min-w-0 items-center gap-3">
            <Avatar
              size="sm"
              fallback={`${row.original.firstName[0] ?? ""}${row.original.lastName[0] ?? ""}`}
            />
            <Stacked
              value={`${row.original.firstName} ${row.original.lastName}`}
              caption={`${row.original.orders} orders`}
            />
          </div>
        ),
      },
      {
        accessorKey: "email",
        header: "Email & Phone",
        size: 297,
        cell: ({ row }) => (
          <Stacked value={row.original.email} caption={row.original.phone} />
        ),
      },
      {
        accessorKey: "status",
        header: "Status",
        size: 297,
        cell: ({ row }) => <StatusTag value={row.original.status} />,
      },
      {
        id: "actions",
        header: "",
        size: 128,
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions
            label={`Actions for ${row.original.firstName} ${row.original.lastName}`}
          />
        ),
      },
    ],
    [],
  );

  return (
    <TablePage<Customer>
      endpoint="/api/customers"
      variant="bordered"
      ariaLabel="Customers"
      searchPlaceholder="Search customers"
      columns={columns}
      getRowId={(row) => row.id}
    />
  );
}
