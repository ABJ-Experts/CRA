import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const palette = {
  fg: "fg",
  fgMuted: "muted",
  fgSubtle: "subtle",
  border: "border",
  borderStrong: "strong",
  canvas: "canvas",
  surface: "surface",
  surfaceMuted: "surface-muted",
  elevated: "elevated",
  accent: "accent",
  active: "active",
  success: "success",
  danger: "danger",
  warning: "warning",
  info: "info",
  premium: "premium",
  heat1: "heat1",
  heat2: "heat2",
  heat3: "heat3",
  glowGreen: "rgb(1, 2, 3)",
  series: ["one", "two", "three"],
  heat: ["heat1", "heat2", "heat3"],
};
const options: unknown[] = [];

vi.mock("./chart", () => ({
  Chart: ({
    build,
    ariaLabel,
  }: {
    build: (p: typeof palette) => unknown;
    ariaLabel: string;
  }) => {
    options.push(build(palette));
    return <div role="img" aria-label={ariaLabel} />;
  },
}));

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
} from "./charts";

describe("typed charts", () => {
  it("builds every chart family with accessible output and supplied data", () => {
    options.length = 0;
    render(
      <>
        <Sparkline ariaLabel="Spark" data={[1, 2]} tone="success" />
        <MixedChart
          ariaLabel="Mixed"
          categories={["Jan"]}
          bars={{ name: "Sales", data: [2] }}
          area={{ name: "Trend", data: [1] }}
        />
        <StackedBarChart
          ariaLabel="Stacked"
          categories={["Jan"]}
          series={[
            { name: "A", data: [1] },
            { name: "B", data: [2] },
          ]}
        />
        <DonutChart
          ariaLabel="Donut"
          data={[
            { name: "A", value: 2 },
            { name: "B", value: 3, color: "custom" },
          ]}
          centerLabel="5"
          centerSub="Total"
        />
        <RadialBar ariaLabel="Radial" value={120} color="danger" />
        <GaugeChart ariaLabel="Gauge" value={75} label="Good" />
        <ScatterChart
          ariaLabel="Scatter"
          series={[
            {
              name: "A",
              points: [
                [1, 2, 9],
                [2, 3],
              ],
            },
          ]}
        />
        <HeatmapChart
          ariaLabel="Heat"
          xLabels={["x"]}
          yLabels={["y"]}
          data={[[0, 0, 4]]}
        />
        <CandlestickChart
          ariaLabel="Market"
          categories={["Mon"]}
          data={[[1, 2, 0, 3]]}
        />
      </>,
    );
    expect(screen.getAllByRole("img")).toHaveLength(9);
    expect(options).toHaveLength(9);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ series: expect.any(Array) }),
      ]),
    );
  });

  it("covers optional labels, computed maxima, and bubble sizing", () => {
    options.length = 0;
    render(
      <>
        <DonutChart ariaLabel="Plain donut" data={[]} />
        <GaugeChart ariaLabel="Plain gauge" value={0} />
        <HeatmapChart
          ariaLabel="Fixed heat"
          xLabels={[]}
          yLabels={[]}
          data={[]}
          max={10}
        />
        <ScatterChart
          ariaLabel="Sized scatter"
          series={[{ name: "A", points: [] }]}
        />
      </>,
    );
    const scatter = options[3] as {
      series: Array<{ symbolSize: (value: number[]) => number }>;
    };
    expect(scatter.series[0]!.symbolSize([0, 0, 16])).toBe(8);
    expect(scatter.series[0]!.symbolSize([0, 0])).toBe(10);
  });
});
