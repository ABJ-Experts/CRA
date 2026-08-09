"use client";

import { CandlestickChart, Sparkline } from "@repo/ui/chart";
import { DataTable, type ColumnDef } from "@repo/ui/data-table";
import { DeltaBadge } from "@repo/ui/stat-card";
import { Button } from "@repo/ui/button";
import { cn } from "@repo/ui/cn";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { useMemo } from "react";
import {
  SectionCard,
  Stagger,
  StaggerItem,
} from "../_components/dashboard-chrome";
import { useTableQuery } from "../_lib/use-table-query";
import {
  Change,
  Plain,
  RowActions,
  Stacked,
} from "../tables/_components/cells";
import { coinSchema, type Coin } from "../../../mocks/data/table-schemas";

/**
 * Dashboard / Crypto - Pencil `h1KQRJ` (light), `bE9bL` (dark).
 *
 * The tallest frame at 1440x1938, so it scrolls. Layout: a 1110x436 row of
 * three 359-wide cards, the 1110x480 Market Graph holding the 1062x339
 * candlestick, a 1110x226 Feature Coin strip of six 172-wide cards, then
 * My Portfolio at 1110x636.
 */

/* Deterministic OHLC so the chart is identical on every load.
 * ECharts' candlestick order is [open, close, low, high]. */
const CANDLES: [number, number, number, number][] = Array.from(
  { length: 48 },
  (_, i) => {
    const base = 236 + Math.sin(i / 3.2) * 28 + i * 0.9;
    const open = base + Math.sin(i * 2.3) * 5;
    const close = base + Math.cos(i * 1.7) * 6;
    const low = Math.min(open, close) - 3 - Math.abs(Math.sin(i)) * 4;
    const high = Math.max(open, close) + 3 + Math.abs(Math.cos(i)) * 4;
    return [
      Number(open.toFixed(2)),
      Number(close.toFixed(2)),
      Number(low.toFixed(2)),
      Number(high.toFixed(2)),
    ];
  },
);
const SESSIONS = CANDLES.map((_, i) => `S${i + 1}`);

const spark = (seed: number) =>
  Array.from(
    { length: 18 },
    (_, i) => 40 + 22 * Math.sin(i * 0.6 + seed) + i * 0.8,
  );

/* Transcribed from the frame's Feature Coin strip. */
const FEATURED = [
  { name: "Bitcoin", symbol: "BTC", price: "$162.24", change: 0.32 },
  { name: "Ethereum", symbol: "ETH", price: "$745.70", change: 1.77 },
  { name: "Binance", symbol: "BNB", price: "$211.68", change: -8.12 },
  { name: "Shiba Inu", symbol: "SHIB", price: "$262.73", change: 6.43 },
  { name: "Solana", symbol: "SOL", price: "$619.03", change: 3.19 },
  { name: "Cardano", symbol: "ADA", price: "$559.77", change: -8.69 },
];

const ACTIVITY = [
  {
    kind: "in" as const,
    label: "Received BTC",
    meta: "From 1MwvM5j6J1bkvry",
    amount: "+0.0421 BTC",
  },
  {
    kind: "out" as const,
    label: "Sent ETH",
    meta: "To BrQv91mWzywzmvzg",
    amount: "-1.204 ETH",
  },
  {
    kind: "in" as const,
    label: "Received SOL",
    meta: "Staking reward",
    amount: "+12.90 SOL",
  },
  {
    kind: "out" as const,
    label: "Sent BNB",
    meta: "To 3FZbgi29cpjq2Gj",
    amount: "-0.640 BNB",
  },
];

export default function CryptoDashboardPage() {
  const t = useTableQuery<Coin>({
    endpoint: "/api/coins",
    rowSchema: coinSchema,
    initialPageSize: 8,
  });

  const columns = useMemo<ColumnDef<Coin, unknown>[]>(
    () => [
      {
        accessorKey: "no",
        header: "No.",
        size: 48,
        enableSorting: false,
        cell: ({ row }) => <Plain value={String(row.original.no)} muted />,
      },
      {
        accessorKey: "name",
        header: "Coin",
        cell: ({ row }) => (
          <Stacked value={row.original.name} caption={row.original.symbol} />
        ),
      },
      {
        accessorKey: "marketCap",
        header: "Market Cap & Price",
        cell: ({ row }) => (
          <Stacked
            value={row.original.marketCap}
            caption={row.original.price}
          />
        ),
      },
      {
        accessorKey: "h24",
        header: "24h",
        cell: ({ row }) => <Change value={row.original.h24} />,
      },
      {
        accessorKey: "d7",
        header: "7d",
        cell: ({ row }) => <Change value={row.original.d7} />,
      },
      {
        id: "actions",
        header: "",
        size: 64,
        enableSorting: false,
        cell: ({ row }) => (
          <RowActions label={`Actions for ${row.original.name}`} />
        ),
      },
    ],
    [],
  );

  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <Stagger className="flex flex-col gap-6">
        <StaggerItem className="grid gap-4 xl:grid-cols-3">
          <SectionCard title="Total balance">
            <div className="flex flex-col gap-4">
              <div className="flex items-end gap-3">
                <span className="text-h3 text-fg tabular-nums">$48,291.20</span>
                <DeltaBadge value={4.62} />
              </div>
              <Sparkline
                ariaLabel="Balance trend"
                data={spark(0.4)}
                tone="success"
                height={56}
              />
              <div className="flex gap-3">
                <Button size="sm" className="flex-1">
                  Buy
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  tone="grey"
                  className="flex-1"
                >
                  Sell
                </Button>
              </div>
            </div>
          </SectionCard>

          <SectionCard title="Recent activity">
            <ul className="flex flex-col gap-3">
              {ACTIVITY.map((a) => (
                <li key={a.label} className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex size-9 shrink-0 items-center justify-center rounded-xl",
                      a.kind === "in"
                        ? "bg-success-surface text-success-fg"
                        : "bg-danger-surface text-danger-fg",
                    )}
                  >
                    {a.kind === "in" ? (
                      <ArrowDownLeft aria-hidden="true" className="size-4" />
                    ) : (
                      <ArrowUpRight aria-hidden="true" className="size-4" />
                    )}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-subhead-medium text-fg">
                      {a.label}
                    </span>
                    <span className="truncate text-caption-2-regular text-fg-muted">
                      {a.meta}
                    </span>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-caption-1-semibold tabular-nums",
                      a.kind === "in" ? "text-success-fg" : "text-danger-fg",
                    )}
                  >
                    {a.amount}
                  </span>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard title="Buy &amp; sell crypto">
            <div className="flex flex-col gap-4">
              {FEATURED.slice(0, 4).map((c) => (
                <div key={c.symbol} className="flex items-center gap-3">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-surface text-caption-2-semibold text-fg-muted">
                    {c.symbol.slice(0, 3)}
                  </span>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-subhead-medium text-fg">
                      {c.name}
                    </span>
                    <span className="truncate text-caption-2-regular text-fg-muted">
                      {c.symbol}
                    </span>
                  </div>
                  <div className="flex shrink-0 flex-col items-end">
                    <span className="text-subhead-medium text-fg tabular-nums">
                      {c.price}
                    </span>
                    <Change value={c.change} />
                  </div>
                </div>
              ))}
            </div>
          </SectionCard>
        </StaggerItem>

        <StaggerItem>
          <SectionCard
            title="Market graph"
            action={
              <span className="text-caption-1-regular text-fg-muted">
                BTC / USD
              </span>
            }
          >
            <CandlestickChart
              ariaLabel="Bitcoin price action over forty-eight sessions"
              categories={SESSIONS}
              data={CANDLES}
              height={339}
            />
          </SectionCard>
        </StaggerItem>

        <StaggerItem className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          {FEATURED.map((c, i) => (
            <SectionCard key={c.symbol} bodyClassName="flex flex-col gap-3">
              <div className="flex flex-col">
                <span className="truncate text-subhead-semibold text-fg">
                  {c.name}
                </span>
                <span className="text-caption-2-regular text-fg-muted">
                  {c.symbol}
                </span>
              </div>
              <Sparkline
                ariaLabel={`${c.name} trend`}
                data={spark(i)}
                tone={c.change >= 0 ? "success" : "danger"}
                height={48}
              />
              <div className="flex items-center justify-between gap-2">
                <span className="text-subhead-medium text-fg tabular-nums">
                  {c.price}
                </span>
                <Change value={c.change} />
              </div>
            </SectionCard>
          ))}
        </StaggerItem>

        <StaggerItem>
          <SectionCard title="My portfolio" bodyClassName="pt-0">
            <DataTable
              variant="basic"
              ariaLabel="Portfolio holdings"
              columns={columns}
              data={t.rows}
              getRowId={(row) => row.id}
              sorting={t.sorting}
              onSortingChange={t.setSorting}
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
              skeletonRows={8}
            />
          </SectionCard>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
