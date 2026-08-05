"use client";

import { selectionColumn, type ColumnDef } from "@repo/ui/data-table";
import { useMemo } from "react";
import { TablePage } from "../_components/table-page";
import { Plain, RowActions, Stacked, StatusTag } from "../_components/cells";
import type { Order } from "../../../../mocks/data/tables";

/** Tables / Striped Tables - Pencil `CTm6w` (light), `h6fSD2` (dark). */
export default function StripedTablesPage() {
  const columns = useMemo<ColumnDef<Order, unknown>[]>(
    () => [
      selectionColumn<Order>({ size: 44, rowLabel: (o) => `order ${o.orderNo}` }),
      {
        accessorKey: "no",
        header: "No.",
        size: 48,
        enableSorting: false,
        cell: ({ row }) => <Plain value={String(row.original.no)} muted />,
      },
      {
        accessorKey: "orderNo",
        header: "Order No & Tracking ID",
        size: 331,
        cell: ({ row }) => (
          <Stacked value={row.original.orderNo} caption={row.original.trackingId} />
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created & Source",
        size: 331,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Stacked value={row.original.createdAt} caption={row.original.source} />
            <StatusTag value={row.original.status} />
          </div>
        ),
      },
      {
        accessorKey: "quantity",
        header: "Quantity & Price",
        size: 331,
        cell: ({ row }) => (
          <Stacked value={String(row.original.quantity)} caption={row.original.price} />
        ),
      },
      {
        id: "actions",
        header: "",
        size: 24,
        enableSorting: false,
        cell: ({ row }) => <RowActions label={`Actions for order ${row.original.orderNo}`} />,
      },
    ],
    [],
  );

  return (
    <TablePage<Order>
      endpoint="/api/orders"
      variant="striped"
      ariaLabel="Orders"
      searchPlaceholder="Search orders"
      columns={columns}
      getRowId={(row) => row.id}
    />
  );
}
