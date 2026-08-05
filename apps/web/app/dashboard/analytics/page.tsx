"use client";

import { DonutChart, HeatmapChart, ScatterChart } from "@repo/ui/chart";
import { DeltaBadge, StatCard } from "@repo/ui/stat-card";
import { SectionCard, Stagger, StaggerItem } from "../_components/dashboard-chrome";

/**
 * Dashboard / Analytics - Pencil `cwxvd` (light), `iGM5k` (dark).
 *
 * Frame layout: a 1110x240 gradient hero, a 1110x320 row of two 547-wide
 * cards (Visitors scatter and the heat map), then a 1110x338 row of three
 * 359-wide cards (two donuts and Top Pages).
 */

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS = ["00", "04", "08", "12", "16", "20"];

/* Deterministic so the screen is identical on every load. */
const HEAT: [number, number, number][] = DAYS.flatMap((_, x) =>
  SLOTS.map(
    (_, y) =>
      [x, y, Math.round(18 + 74 * Math.abs(Math.sin(x * 1.7 + y * 0.9)))] as [
        number,
        number,
        number,
      ],
  ),
);

const SCATTER = [
  {
    name: "Organic",
    points: Array.from({ length: 14 }, (_, i) => {
      const x = 6 + i * 6.4;
      return [x, 24 + 58 * Math.abs(Math.sin(i * 0.8)), 80 + 160 * Math.abs(Math.cos(i * 0.5))] as [
        number,
        number,
        number,
      ];
    }),
  },
  {
    name: "Paid",
    points: Array.from({ length: 14 }, (_, i) => {
      const x = 9 + i * 6.1;
      return [x, 16 + 50 * Math.abs(Math.cos(i * 0.7)), 60 + 140 * Math.abs(Math.sin(i * 0.6))] as [
        number,
        number,
        number,
      ];
    }),
  },
];

const TOP_PAGES = [
  { path: "/", views: 24_812, share: 32 },
  { path: "/pricing", views: 18_204, share: 24 },
  { path: "/docs/getting-started", views: 12_961, share: 17 },
  { path: "/blog/design-tokens", views: 8_430, share: 11 },
  { path: "/changelog", views: 6_112, share: 8 },
];

export default function AnalyticsDashboardPage() {
  return (
    <div className="flex flex-col gap-6 px-6 py-6 lg:px-[30px]">
      <Stagger className="flex flex-col gap-6">
        {/* Hero. The frame uses a supplied banner image; this is the same
            composition built from tokens so it re-themes and needs no asset. */}
        <StaggerItem>
          <div className="relative flex min-h-[240px] flex-col justify-center overflow-hidden rounded-2xl p-8">
            <div
              aria-hidden="true"
              className="absolute inset-0 bg-gradient-to-br from-active-500 via-royal-purple-500 to-cyan-blue-500"
            />
            <div
              aria-hidden="true"
              className="absolute -top-16 -right-10 size-64 rounded-full bg-white/15 blur-2xl"
            />
            <div className="relative flex max-w-[422px] flex-col gap-3">
              <h2 className="text-h4 text-white">Analytics with AI &amp; Big Data</h2>
              <p className="text-subhead-regular text-white/80">
                Every number on this page is served by the mocked API and paged on the server, so
                the loading and error states are real.
              </p>
            </div>
          </div>
        </StaggerItem>

        <StaggerItem className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <StatCard label="Visitors" value={48_291} delta={<DeltaBadge value={6.42} />} />
          <StatCard label="Sessions" value={71_038} delta={<DeltaBadge value={4.18} />} />
          <StatCard
            label="Bounce rate"
            value={38.4}
            format={(n) => `${n.toFixed(1)}%`}
            delta={<DeltaBadge value={-2.06} />}
          />
          <StatCard
            label="Avg. duration"
            value={3.42}
            format={(n) => `${n.toFixed(2)}m`}
            delta={<DeltaBadge value={1.24} />}
          />
        </StaggerItem>

        <StaggerItem className="grid gap-4 xl:grid-cols-2">
          <SectionCard title="Visitors by channel">
            <ScatterChart
              ariaLabel="Sessions against conversion by channel"
              series={SCATTER}
              height={224}
            />
          </SectionCard>
          <SectionCard title="Traffic by day and hour">
            <HeatmapChart
              ariaLabel="Traffic by day and hour"
              xLabels={DAYS}
              yLabels={SLOTS}
              data={HEAT}
              height={224}
            />
          </SectionCard>
        </StaggerItem>

        <StaggerItem className="grid gap-4 xl:grid-cols-3">
          <SectionCard title="Referral links">
            <DonutChart
              ariaLabel="Sessions by referral source"
              data={[
                { name: "Search", value: 44 },
                { name: "Social", value: 26 },
                { name: "Direct", value: 18 },
                { name: "Email", value: 12 },
              ]}
              centerLabel="44%"
              centerSub="Search"
              height={220}
            />
          </SectionCard>

          <SectionCard title="Devices">
            <DonutChart
              ariaLabel="Sessions by device"
              data={[
                { name: "Desktop", value: 58 },
                { name: "Mobile", value: 31 },
                { name: "Tablet", value: 11 },
              ]}
              centerLabel="58%"
              centerSub="Desktop"
              height={220}
            />
          </SectionCard>

          <SectionCard title="Top pages">
            <ul className="flex flex-col gap-4">
              {TOP_PAGES.map((p) => (
                <li key={p.path} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="truncate text-subhead-medium text-fg">{p.path}</span>
                    <span className="shrink-0 text-caption-1-regular text-fg-muted tabular-nums">
                      {p.views.toLocaleString()}
                    </span>
                  </div>
                  {/* Plain CSS bar rather than a chart: one value per row does
                      not justify a canvas, and this stays crisp at any width. */}
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <div
                      className="h-full rounded-full bg-active-500 transition-[width] duration-500"
                      style={{ width: `${p.share}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        </StaggerItem>
      </Stagger>
    </div>
  );
}
