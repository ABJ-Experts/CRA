/**
 * The tree-shaken ECharts build.
 *
 * `echarts` ships ~1MB if imported wholesale. Importing `echarts/core` and
 * registering only the series and components the designs actually use keeps
 * that to the subset below. Every chart in this package goes through this
 * module, so the registration happens exactly once.
 *
 * The list is driven by the Pencil frames:
 *
 *   BarChart          Stacked (I4RUTg) and Mixed (SSqGt) columns
 *   LineChart         sparklines (h1KQRJ) and the Mixed chart's area series
 *   PieChart          Donut (cwxvd) and the 40px Radialbar rings (I4RUTg)
 *   ScatterChart      Scatter (cwxvd)
 *   HeatmapChart      Heat Map (cwxvd)
 *   CandlestickChart  Market Graph (h1KQRJ)
 *   GaugeChart        Performance (I4RUTg)
 *
 * If a new frame needs a series that is not here, ECharts fails at runtime
 * with "series.type should be one of ..." rather than silently drawing
 * nothing, so the failure is loud.
 *
 * REGISTRATION IS A FUNCTION, NOT A TOP-LEVEL SIDE EFFECT. Writing
 * `echarts.use([...])` at module scope reads correctly and is what the docs
 * show, but this package sets `"sideEffects": false`, which tells the bundler
 * every module here is free of observable effects. A bare `use([...])` whose
 * return value is discarded is then legal to drop, and it WAS dropped: the
 * module still evaluated far enough to export `echarts`, so `init` existed,
 * but no renderer had been registered and it threw
 *
 *   Renderer 'undefined' is not imported. Please import it first.
 *
 * which crashed the renderer rather than surfacing as a React error. Putting
 * the call behind a function that callers invoke makes it live code the
 * bundler cannot prove is dead, so the fix holds regardless of how
 * `sideEffects` is configured later.
 */

import * as echarts from "echarts/core";
import {
  BarChart,
  CandlestickChart,
  GaugeChart,
  HeatmapChart,
  LineChart,
  PieChart,
  ScatterChart,
} from "echarts/charts";
import {
  DatasetComponent,
  GraphicComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  TitleComponent,
  TooltipComponent,
  TransformComponent,
  VisualMapComponent,
} from "echarts/components";
import { LabelLayout, UniversalTransition } from "echarts/features";
import { CanvasRenderer } from "echarts/renderers";

let registered = false;

/**
 * Registers the ECharts subset once and returns the namespace.
 *
 * Call this instead of importing `echarts` directly; `init` throws if the
 * renderer has not been registered yet.
 */
export function ensureECharts(): typeof echarts {
  if (registered) return echarts;
  registered = true;

  echarts.use([
    BarChart,
    LineChart,
    PieChart,
    ScatterChart,
    HeatmapChart,
    CandlestickChart,
    GaugeChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    TitleComponent,
    DatasetComponent,
    TransformComponent,
    VisualMapComponent,
    MarkLineComponent,
    GraphicComponent,
    LabelLayout,
    UniversalTransition,
    CanvasRenderer,
  ]);

  return echarts;
}

export { echarts };

/**
 * Loosely typed on purpose. `ComposeOption` gives a precise union but forces
 * every call site to list its own series types, which turns each chart's
 * option literal into a type-assembly exercise for no runtime benefit. The
 * charts in this package are built by small typed wrappers, so the option
 * objects are already constrained by those wrappers' props.
 */
export type EChartsOption = Parameters<echarts.ECharts["setOption"]>[0];
export type EChartsInstance = echarts.ECharts;
