"use client";

import { MixedChart } from "@repo/ui/chart";
import { DataTable, type ColumnDef } from "@repo/ui/data-table";
import { DeltaBadge, StatCard } from "@repo/ui/stat-card";
import { useMemo } from "react";
import { SectionCard, Stagger, StaggerItem } from "./_components/dashboard-chrome";
import { useTableQuery } from "./_lib/use-table-query";
import { Plain, RowActions, Stacked, StatusTag } from "./tables/_components/cells";
import type { Order } from "../../mocks/data/tables";

/**
 * Dashboard / E-commerce - Pencil `SSqGt` (light), `qe2KR` (dark).
 *
 * Frame layout: a five-tile Total row (1110x104), a Revenue & Summary block
 * (1110x400) holding the mixed bar-and-area chart, then Latest Orders
 * (1110x384).
 */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const REVENUE = [42, 58, 47, 71, 65, 88, 76, 94, 82, 101, 92, 118];
const ORDERS = [28, 39, 31, 48, 44, 59, 51, 63, 55, 68, 61, 79];

/* Values transcribed from the frame's Total row. */
const TOTALS = [
  {
    label: "Total revenue",
    value: 902.008,
    format: (n: number) => `$${n.toFixed(3)}K`,
    delta: 8.24,
  },
  { label: "Total profit", value: 61.108, format: (n: number) => `$${n.toFixed(3)}K`, delta: 3.11 },
  { label: "Total orders", value: 12029, delta: 5.4 },
  { label: "Total customers", value: 8292, delta: 2.18 },
  { label: "Total products", value: 1209, delta: -1.2 },
];

export default function EcommerceDashboardPage() {
  const t = useTableQuery<Order>({ endpoint: "/api/orders", initialPageSize: 5 });

  const columns = useMemo<ColumnDef<Order, unknown>[]>(
    () => [
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
        cell: ({ row }) => (
          <Stacked value={row.original.orderNo} caption={row.original.trackingId} />
        ),
      },
      {
        accessorKey: "createdAt",
        header: "Created & Source",
        cell: ({ row }) => <Stacked value={row.original.createdAt} caption={row.original.source} />,
      },
      {
        accessorKey: "status",
        header: "Status",
        cell: ({ row }) => <StatusTag value={row.original.status} />,
      },
      {
        accessorKey: "quantity",
        header: "Quantity & Price",
        cell: ({ row }) => (
          <Stacked value={String(row.original.quantity)} caption={row.original.price} />
        ),
      },
      {
        id: "actions",
        header: "",
        size: 64,
        enableSorting: false,
        cell: ({ row }) => <RowActions label={`Actions for order ${row.original.orderNo}`} />,
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <Stagger className="flex flex-col gap-6">
        <StaggerItem className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {TOTALS.map((s) => (
            <StatCard
              key={s.label}
              label={s.label}
              value={s.value}
              format={s.format}
              delta={<DeltaBadge value={s.delta} />}
            />
          ))}
        </StaggerItem>

        <StaggerItem>
          <SectionCard title="Revenue & Summary">
            <MixedChart
              ariaLabel="Revenue and order volume by month"
              categories={MONTHS}
              bars={{ name: "Orders", data: ORDERS }}
              area={{ name: "Revenue", data: REVENUE }}
              height={320}
            />
          </SectionCard>
        </StaggerItem>

        <StaggerItem>
          <SectionCard title="Latest Orders" bodyClassName="pt-0">
            <DataTable
              variant="basic"
              ariaLabel="Latest orders"
              columns={columns}
              data={t.rows}
              getRowId={(row) => row.id}
              sorting={t.sorting}
              onSortingChange={t.setSorting}
              isLoading={t.isLoading}
              isFetching={t.isFetching}
              error={t.isError ? t.error : undefined}
              onRetry={() => t.refetch()}
              skeletonRows={5}
            />
          </SectionCard>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
