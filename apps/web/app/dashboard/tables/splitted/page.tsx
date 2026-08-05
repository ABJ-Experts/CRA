"use client";

import type { ColumnDef } from "@repo/ui/data-table";
import { useMemo } from "react";
import { TablePage } from "../_components/table-page";
import { Change, Plain, RowActions, Stacked } from "../_components/cells";
import type { Coin } from "../../../../mocks/data/tables";

/**
 * Tables / Splitted Tables - Pencil `A6MS4` (light), `dPVHC` (dark).
 *
 * The only frame with 64px rows and no checkbox column: each row is its own
 * bordered card, so a selection control would have nothing to align to.
 */
export default function SplittedTablesPage() {
  const columns = useMemo<ColumnDef<Coin, unknown>[]>(
    () => [
      {
        accessorKey: "no",
        header: "No.",
        size: 64,
        enableSorting: false,
        cell: ({ row }) => <Plain value={String(row.original.no)} muted />,
      },
      {
        accessorKey: "name",
        header: "Name",
        size: 317,
        cell: ({ row }) => <Stacked value={row.original.name} caption={row.original.symbol} />,
      },
      {
        accessorKey: "marketCap",
        header: "Market Cap & Price",
        size: 317,
        cell: ({ row }) => <Stacked value={row.original.marketCap} caption={row.original.price} />,
      },
      {
        accessorKey: "h24",
        header: "Change",
        size: 317,
        cell: ({ row }) => (
          <div className="flex items-center gap-4">
            {(
              [
                ["1h", row.original.h1],
                ["24h", row.original.h24],
                ["7d", row.original.d7],
                ["30d", row.original.d30],
              ] as const
            ).map(([label, value]) => (
              <div key={label} className="flex min-w-0 flex-col">
                <span className="text-caption-2-regular text-fg-subtle">{label}</span>
                <Change value={value} />
              </div>
            ))}
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
    <TablePage<Coin>
      endpoint="/api/coins"
      variant="splitted"
      ariaLabel="Coins"
      searchPlaceholder="Search coins"
      columns={columns}
      getRowId={(row) => row.id}
    />
  );
}
