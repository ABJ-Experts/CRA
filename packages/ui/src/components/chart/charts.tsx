"use client";

import { Chart, type ChartProps } from "./chart";
import { withAlpha, type ChartPalette } from "./chart-palette";
import type { EChartsOption } from "./echarts";

/**
 * Typed wrappers over `Chart`, one per chart in the Pencil frames.
 *
 * Each keeps the axis and grid chrome consistent so the whole app reads as
 * one system: hairline horizontal split lines in `border`, no axis line, tick
 * labels in `fgSubtle`, and category labels in `fgMuted`. That combination is
 * what the frames draw, and centralising it here stops each screen from
 * re-deriving it slightly differently.
 */

type Common = Pick<ChartProps, "height" | "className" | "ariaLabel">;

/** Shared cartesian chrome. */
function axes(p: ChartPalette, categories: string[], opts?: { yFormatter?: string }) {
  return {
    grid: { top: 16, right: 8, bottom: 24, left: 44, containLabel: false },
    xAxis: {
      type: "category" as const,
      data: categories,
      boundaryGap: true,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: p.fgSubtle, fontSize: 11, margin: 12 },
    },
    yAxis: {
      type: "value" as const,
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: {
        color: p.fgSubtle,
        fontSize: 11,
        formatter: opts?.yFormatter,
      },
      splitLine: { lineStyle: { color: p.border, width: 1 } },
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Sparkline - Crypto coin cards (h1KQRJ, 140x40)                             */
/* -------------------------------------------------------------------------- */

export interface SparklineProps extends Common {
  data: number[];
  /** Defaults to `fg`, which is what the coin cards use. */
  tone?: "fg" | "success" | "danger" | "active";
}

export function Sparkline({ data, tone = "fg", height = 40, ...rest }: SparklineProps) {
  return (
    <Chart
      {...rest}
      height={height}
      deps={[data, tone]}
      build={(p) => ({
        grid: { top: 4, right: 2, bottom: 4, left: 2 },
        xAxis: { type: "category", show: false, boundaryGap: false },
        yAxis: { type: "value", show: false, scale: true },
        tooltip: { show: false },
        series: [
          {
            type: "line",
            data,
            smooth: true,
            symbol: "none",
            lineStyle: { width: 1.5, color: p[tone] },
            areaStyle: { color: withAlpha(p[tone], 0.08) },
          },
        ],
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Mixed - Ecommerce revenue (SSqGt, 780x320): bars + a green area wash        */
/* -------------------------------------------------------------------------- */

export interface MixedChartProps extends Common {
  categories: string[];
  bars: { name: string; data: number[] };
  area: { name: string; data: number[] };
}

export function MixedChart({ categories, bars, area, ...rest }: MixedChartProps) {
  return (
    <Chart
      {...rest}
      deps={[categories, bars, area]}
      build={(p) => ({
        ...axes(p, categories),
        legend: { show: false },
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        series: [
          {
            name: area.name,
            type: "line",
            data: area.data,
            smooth: true,
            symbol: "none",
            lineStyle: { width: 2, color: p.glowGreen },
            /* The frame's wash: the glow green at 40% fading to nothing. */
            areaStyle: {
              color: {
                type: "linear",
                x: 0,
                y: 0,
                x2: 0,
                y2: 1,
                colorStops: [
                  { offset: 0, color: withAlpha(p.glowGreen, 0.4) },
                  { offset: 1, color: withAlpha(p.glowGreen, 0) },
                ],
              },
            },
          },
          {
            name: bars.name,
            type: "bar",
            data: bars.data,
            barWidth: 10,
            itemStyle: { color: p.fg, borderRadius: [4, 4, 0, 0] },
          },
        ],
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Stacked columns - Project Manager (I4RUTg, 750x320)                        */
/* -------------------------------------------------------------------------- */

export interface StackedBarChartProps extends Common {
  categories: string[];
  series: { name: string; data: number[] }[];
}

export function StackedBarChart({ categories, series, ...rest }: StackedBarChartProps) {
  return (
    <Chart
      {...rest}
      notMerge
      deps={[categories, series]}
      build={(p) => ({
        ...axes(p, categories),
        tooltip: { trigger: "axis", axisPointer: { type: "shadow" } },
        legend: {
          bottom: 0,
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { color: p.fgMuted, fontSize: 12 },
        },
        grid: { top: 16, right: 8, bottom: 48, left: 44 },
        series: series.map((s, i) => ({
          name: s.name,
          type: "bar" as const,
          stack: "total",
          data: s.data,
          barWidth: 16,
          itemStyle: {
            color: p.series[i % p.series.length],
            /* Only the top segment is rounded, which is what the frame shows. */
            borderRadius: i === series.length - 1 ? [4, 4, 0, 0] : 0,
          },
        })),
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Donut - Analytics (cwxvd, 180x180)                                         */
/* -------------------------------------------------------------------------- */

export interface DonutChartProps extends Common {
  data: { name: string; value: number; color?: string }[];
  /** Big number rendered in the hole. */
  centerLabel?: string;
  centerSub?: string;
}

export function DonutChart({
  data,
  centerLabel,
  centerSub,
  height = 180,
  ...rest
}: DonutChartProps) {
  return (
    <Chart
      {...rest}
      height={height}
      notMerge
      deps={[data, centerLabel, centerSub]}
      build={(p) => ({
        tooltip: { trigger: "item" },
        series: [
          {
            type: "pie",
            radius: ["68%", "92%"],
            avoidLabelOverlap: true,
            padAngle: 2,
            itemStyle: { borderRadius: 6 },
            label: centerLabel
              ? {
                  show: true,
                  position: "center",
                  formatter: centerSub ? `{a|${centerLabel}}\n{b|${centerSub}}` : centerLabel,
                  rich: {
                    a: { color: p.fg, fontSize: 20, fontWeight: 600, lineHeight: 26 },
                    b: { color: p.fgMuted, fontSize: 12, lineHeight: 18 },
                  },
                }
              : { show: false },
            labelLine: { show: false },
            emphasis: { scale: true, scaleSize: 4 },
            data: data.map((d, i) => ({
              name: d.name,
              value: d.value,
              itemStyle: { color: d.color ?? p.series[i % p.series.length] },
            })),
          },
        ],
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Radial bar - Project Manager progress rings (I4RUTg, 40x40)                */
/* -------------------------------------------------------------------------- */

export interface RadialBarProps extends Common {
  /** 0-100. */
  value: number;
  color?: keyof ChartPalette;
}

export function RadialBar({ value, color = "active", height = 40, ...rest }: RadialBarProps) {
  return (
    <Chart
      {...rest}
      height={height}
      deps={[value, color]}
      build={(p) => ({
        tooltip: { show: false },
        series: [
          {
            type: "pie",
            radius: ["72%", "100%"],
            silent: true,
            label: { show: false },
            labelLine: { show: false },
            data: [
              {
                value,
                itemStyle: { color: p[color] as string, borderRadius: 4 },
              },
              { value: Math.max(0, 100 - value), itemStyle: { color: p.border } },
            ],
          },
        ],
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Gauge - Project Manager performance (I4RUTg, 200x125)                      */
/* -------------------------------------------------------------------------- */

export interface GaugeChartProps extends Common {
  /** 0-100. */
  value: number;
  label?: string;
}

export function GaugeChart({ value, label, height = 160, ...rest }: GaugeChartProps) {
  return (
    <Chart
      {...rest}
      height={height}
      deps={[value, label]}
      build={(p) => ({
        series: [
          {
            type: "gauge",
            startAngle: 180,
            endAngle: 0,
            center: ["50%", "84%"],
            radius: "128%",
            min: 0,
            max: 100,
            splitNumber: 0,
            progress: { show: false },
            pointer: {
              icon: "circle",
              length: "8%",
              width: 12,
              offsetCenter: [0, "-92%"],
              itemStyle: { color: p.canvas, borderColor: p.active, borderWidth: 3 },
            },
            axisLine: {
              lineStyle: {
                width: 14,
                /* The frame's arc sweeps the five status hues. */
                color: [
                  [0.2, p.danger],
                  [0.4, p.warning],
                  [0.6, p.info],
                  [0.8, p.premium],
                  [1, p.success],
                ],
              },
            },
            axisTick: { show: false },
            splitLine: { show: false },
            axisLabel: { show: false },
            title: { show: false },
            detail: {
              valueAnimation: true,
              offsetCenter: [0, "-18%"],
              formatter: label ? `{v|${value}}\n{s|${label}}` : "{v|" + value + "}",
              rich: {
                v: { color: p.fg, fontSize: 24, fontWeight: 600, lineHeight: 30 },
                s: { color: p.fgMuted, fontSize: 12, lineHeight: 18 },
              },
            },
            data: [{ value }],
          },
        ],
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Scatter - Analytics (cwxvd, 499x224)                                       */
/* -------------------------------------------------------------------------- */

export interface ScatterChartProps extends Common {
  series: { name: string; points: [number, number, number?][] }[];
}

export function ScatterChart({ series, height = 224, ...rest }: ScatterChartProps) {
  return (
    <Chart
      {...rest}
      height={height}
      notMerge
      deps={[series]}
      build={(p) => ({
        grid: { top: 16, right: 12, bottom: 28, left: 44 },
        xAxis: {
          type: "value",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.fgSubtle, fontSize: 11 },
          splitLine: { lineStyle: { color: p.border } },
        },
        yAxis: {
          type: "value",
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.fgSubtle, fontSize: 11 },
          splitLine: { lineStyle: { color: p.border } },
        },
        tooltip: { trigger: "item" },
        legend: {
          bottom: 0,
          icon: "circle",
          itemWidth: 8,
          itemHeight: 8,
          textStyle: { color: p.fgMuted, fontSize: 12 },
        },
        series: series.map((s, i) => ({
          name: s.name,
          type: "scatter" as const,
          data: s.points,
          /* Third tuple slot drives bubble size when present. */
          symbolSize: (d: number[]) => (d[2] ? Math.max(6, Math.sqrt(d[2]) * 2) : 10),
          itemStyle: { color: withAlpha(p.series[i % p.series.length] ?? p.active, 0.75) },
        })),
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Heat map - Analytics (cwxvd, 499x224)                                      */
/* -------------------------------------------------------------------------- */

export interface HeatmapChartProps extends Common {
  xLabels: string[];
  yLabels: string[];
  /** [xIndex, yIndex, value] */
  data: [number, number, number][];
  max?: number;
}

export function HeatmapChart({
  xLabels,
  yLabels,
  data,
  max,
  height = 224,
  ...rest
}: HeatmapChartProps) {
  const ceiling = max ?? data.reduce((m, d) => Math.max(m, d[2]), 0);
  return (
    <Chart
      {...rest}
      height={height}
      notMerge
      deps={[xLabels, yLabels, data, ceiling]}
      build={(p) => ({
        grid: { top: 12, right: 12, bottom: 48, left: 56 },
        xAxis: {
          type: "category",
          data: xLabels,
          splitArea: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.fgSubtle, fontSize: 11 },
        },
        yAxis: {
          type: "category",
          data: yLabels,
          splitArea: { show: false },
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.fgSubtle, fontSize: 11 },
        },
        tooltip: { position: "top" },
        visualMap: {
          min: 0,
          max: ceiling,
          calculable: false,
          orient: "horizontal",
          left: "center",
          bottom: 0,
          itemWidth: 10,
          itemHeight: 90,
          textStyle: { color: p.fgMuted, fontSize: 11 },
          inRange: { color: p.heat },
        },
        series: [
          {
            type: "heatmap",
            data,
            itemStyle: { borderRadius: 4, borderColor: p.canvas, borderWidth: 2 },
            emphasis: { itemStyle: { borderColor: p.fg, borderWidth: 2 } },
          },
        ],
      })}
    />
  );
}

/* -------------------------------------------------------------------------- */
/* Candlestick - Crypto market graph (h1KQRJ, 1062x339)                       */
/* -------------------------------------------------------------------------- */

export interface CandlestickChartProps extends Common {
  categories: string[];
  /** [open, close, low, high] per category, ECharts' own order. */
  data: [number, number, number, number][];
}

export function CandlestickChart({
  categories,
  data,
  height = 339,
  ...rest
}: CandlestickChartProps) {
  return (
    <Chart
      {...rest}
      height={height}
      notMerge
      deps={[categories, data]}
      build={(p) => ({
        grid: { top: 16, right: 8, bottom: 28, left: 56 },
        xAxis: {
          type: "category",
          data: categories,
          boundaryGap: true,
          axisLine: { lineStyle: { color: p.border } },
          axisTick: { show: false },
          axisLabel: { color: p.fgSubtle, fontSize: 11 },
        },
        yAxis: {
          type: "value",
          scale: true,
          axisLine: { show: false },
          axisTick: { show: false },
          axisLabel: { color: p.fgSubtle, fontSize: 11 },
          splitLine: { lineStyle: { color: p.border } },
        },
        tooltip: { trigger: "axis", axisPointer: { type: "cross" } },
        series: [
          {
            type: "candlestick",
            data,
            itemStyle: {
              color: p.success,
              color0: p.danger,
              borderColor: p.success,
              borderColor0: p.danger,
              borderWidth: 1,
            },
          },
        ],
      })}
    />
  );
}

export type { EChartsOption, ChartPalette };
