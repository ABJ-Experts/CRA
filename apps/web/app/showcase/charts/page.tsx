"use client";

import {
  CandlestickChart,
  DonutChart,
  GaugeChart,
  HeatmapChart,
  MixedChart,
  RadialBar,
  ScatterChart,
  Sparkline,
  StackedBarChart,
} from "@repo/ui/chart";
import { Card, CardBody, CardHeader, CardTitle } from "@repo/ui/card";
import Link from "next/link";
import { Button } from "@repo/ui/button";
import { ThemeToggle } from "../theme-toggle";

/**
 * Every chart in the library on one page.
 *
 * Exists as the verification harness for `@repo/ui/chart`: the instance
 * lifecycle, the token-driven palette and the theme flip are all easier to
 * confirm here than spread across eight dashboards. It doubles as the
 * reference for what the template ships.
 */

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const REVENUE = [42, 58, 47, 71, 65, 88, 76, 94, 82, 101, 92, 118];
const ORDERS = [28, 39, 31, 48, 44, 59, 51, 63, 55, 68, 61, 79];

const STACKED = [
  { name: "Design", data: [12, 18, 14, 22, 19, 26] },
  { name: "Build", data: [20, 24, 28, 26, 31, 34] },
  { name: "Review", data: [8, 11, 9, 14, 12, 16] },
];

const SCATTER = [
  {
    name: "Organic",
    points: [
      [12, 42, 120],
      [22, 58, 180],
      [31, 35, 90],
      [44, 71, 240],
      [52, 55, 140],
      [61, 82, 200],
      [72, 64, 160],
      [84, 91, 260],
    ] as [number, number, number][],
  },
  {
    name: "Paid",
    points: [
      [16, 28, 100],
      [27, 44, 150],
      [38, 22, 80],
      [49, 52, 190],
      [58, 38, 110],
      [67, 61, 170],
      [78, 46, 130],
      [89, 72, 210],
    ] as [number, number, number][],
  },
];

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const SLOTS = ["00", "04", "08", "12", "16", "20"];
const HEAT: [number, number, number][] = DAYS.flatMap((_, x) =>
  SLOTS.map(
    (_, y) =>
      [x, y, Math.round(20 + 70 * Math.abs(Math.sin(x * 1.7 + y * 0.9)))] as [
        number,
        number,
        number,
      ],
  ),
);

/** [open, close, low, high] */
const CANDLES: [number, number, number, number][] = Array.from(
  { length: 40 },
  (_, i) => {
    const base = 240 + Math.sin(i / 3) * 26 + i * 1.1;
    const open = base + Math.sin(i * 2.3) * 5;
    const close = base + Math.cos(i * 1.7) * 6;
    return [
      Number(open.toFixed(2)),
      Number(close.toFixed(2)),
      Number(
        (Math.min(open, close) - 4 - Math.abs(Math.sin(i)) * 3).toFixed(2),
      ),
      Number(
        (Math.max(open, close) + 4 + Math.abs(Math.cos(i)) * 3).toFixed(2),
      ),
    ];
  },
);
const CANDLE_DAYS = CANDLES.map((_, i) => `D${i + 1}`);

const SPARK = [12, 18, 14, 22, 19, 26, 21, 30, 27, 35, 31, 42];

function Panel({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardBody>{children}</CardBody>
    </Card>
  );
}

export default function ChartsShowcasePage() {
  return (
    <div className="flex min-h-dvh flex-col gap-6 bg-canvas p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="text-h4 text-fg">Charts</h1>
          <p className="text-subhead-regular text-fg-muted">
            Every series in <code>@repo/ui/chart</code>. Flip the theme and the
            palette is re-read from the tokens, with no remount.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ThemeToggle />
          <Button asChild variant="outline" tone="grey">
            <Link href="/showcase">Back</Link>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Panel title="Mixed — bars + area wash">
          <MixedChart
            ariaLabel="Revenue by month with order volume"
            categories={MONTHS}
            bars={{ name: "Orders", data: ORDERS }}
            area={{ name: "Revenue", data: REVENUE }}
            height={320}
          />
        </Panel>

        <Panel title="Stacked columns">
          <StackedBarChart
            ariaLabel="Task hours by stage across six sprints"
            categories={["S1", "S2", "S3", "S4", "S5", "S6"]}
            series={STACKED}
            height={320}
          />
        </Panel>

        <Panel title="Candlestick">
          <CandlestickChart
            ariaLabel="Price action over forty sessions"
            categories={CANDLE_DAYS}
            data={CANDLES}
            height={320}
          />
        </Panel>

        <Panel title="Scatter">
          <ScatterChart
            ariaLabel="Sessions against conversion by channel"
            series={SCATTER}
            height={320}
          />
        </Panel>

        <Panel title="Heat map">
          <HeatmapChart
            ariaLabel="Traffic by day and hour"
            xLabels={DAYS}
            yLabels={SLOTS}
            data={HEAT}
            height={320}
          />
        </Panel>

        <Panel title="Gauge">
          <GaugeChart
            ariaLabel="Team performance this week"
            value={72}
            label="Performance"
            height={320}
          />
        </Panel>

        <Panel title="Donut">
          <div className="flex items-center justify-around gap-6">
            <DonutChart
              ariaLabel="Sessions by device"
              data={[
                { name: "Desktop", value: 58 },
                { name: "Mobile", value: 31 },
                { name: "Tablet", value: 11 },
              ]}
              centerLabel="58%"
              centerSub="Desktop"
              height={180}
              className="max-w-[180px]"
            />
            <DonutChart
              ariaLabel="Traffic by source"
              data={[
                { name: "Organic", value: 44 },
                { name: "Referral", value: 26 },
                { name: "Social", value: 18 },
                { name: "Direct", value: 12 },
              ]}
              height={180}
              className="max-w-[180px]"
            />
          </div>
        </Panel>

        <Panel title="Sparkline and radial bar">
          <div className="flex flex-col gap-6">
            <div className="grid grid-cols-3 gap-4">
              {(["fg", "success", "danger"] as const).map((tone) => (
                <div key={tone} className="flex flex-col gap-1">
                  <span className="text-caption-2-regular text-fg-subtle">
                    {tone}
                  </span>
                  <Sparkline
                    ariaLabel={`Trend, ${tone}`}
                    data={SPARK}
                    tone={tone}
                  />
                </div>
              ))}
            </div>
            <div className="flex items-center gap-6">
              {[
                { v: 82, c: "active" as const },
                { v: 64, c: "success" as const },
                { v: 41, c: "warning" as const },
                { v: 23, c: "danger" as const },
              ].map(({ v, c }) => (
                <div key={c} className="flex items-center gap-2">
                  <RadialBar
                    ariaLabel={`${v} percent complete`}
                    value={v}
                    color={c}
                    className="w-10"
                  />
                  <span className="text-caption-1-semibold text-fg-muted">
                    {v}%
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
