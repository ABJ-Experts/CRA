"use client";

import { selectionColumn, type ColumnDef } from "@repo/ui/data-table";
import { useMemo } from "react";
import { TablePage } from "../_components/table-page";
import { Plain, RowActions, Stacked, StatusTag } from "../_components/cells";
import type { Product } from "../../../../mocks/data/tables";

/**
 * Tables / Basic Tables - Pencil `EaMnQ` (light), `P1lJO` (dark).
 *
 * 48px rows with a hairline between them, seven columns, and the products
 * dataset the frame draws.
 */
export default function BasicTablesPage() {
  const columns = useMemo<ColumnDef<Product, unknown>[]>(
    () => [
      selectionColumn<Product>({ size: 40, rowLabel: (p) => p.name }),
      {
        accessorKey: "no",
        header: "No.",
        size: 48,
        enableSorting: false,
        cell: ({ row }) => <Plain value={String(row.original.no)} muted />,
      },
      {
        accessorKey: "sku",
        header: "SKU",
        size: 120,
        cell: ({ row }) => <Plain value={row.original.sku} />,
      },
      {
        accessorKey: "name",
        header: "Product Name",
        size: 279,
        cell: ({ row }) => <Stacked value={row.original.name} />,
      },
      {
        accessorKey: "updatedAt",
        header: "Last Update & Category",
        size: 279,
        cell: ({ row }) => (
          <Stacked value={row.original.updatedAt} caption={row.original.category} />
        ),
      },
      {
        accessorKey: "quantity",
        header: "Quantity & Price",
        size: 279,
        cell: ({ row }) => (
          <div className="flex items-center gap-3">
            <Stacked value={String(row.original.quantity)} caption={row.original.price} />
            <StatusTag value={row.original.status} />
          </div>
        ),
      },
      {
        id: "actions",
        header: "",
        size: 64,
        enableSorting: false,
        cell: ({ row }) => <RowActions label={`Actions for ${row.original.name}`} />,
      },
    ],
    [],
  );

  return (
    <TablePage<Product>
      endpoint="/api/products"
      variant="basic"
      ariaLabel="Products"
      searchPlaceholder="Search products"
      columns={columns}
      getRowId={(row) => row.id}
    />
  );
}
