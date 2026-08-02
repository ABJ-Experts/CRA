"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { ensureECharts, type EChartsInstance, type EChartsOption } from "./echarts";
import { readChartPalette, type ChartPalette } from "./chart-palette";

/**
 * Chart - the single ECharts instance owner.
 *
 * Every chart in this package renders through here so that instance
 * lifecycle, theming, resizing and accessibility are solved once.
 *
 * The option is supplied as a FUNCTION of the palette rather than a literal:
 *
 * ```tsx
 * <Chart height={320} build={(p) => ({
 *   xAxis: { type: "category", data: months },
 *   yAxis: { type: "value" },
 *   series: [{ type: "bar", data: values, itemStyle: { color: p.active } }],
 * })} />
 * ```
 *
 * That inversion is what makes theming work. On a theme flip the palette is
 * re-read and `build` re-run, then the result is pushed with `setOption`.
 * The instance is never torn down, so ECharts diffs the option and animates
 * between the two palettes instead of flashing through a remount. It also
 * means there is no second, hand-maintained dark colour table anywhere.
 */

export interface ChartProps {
  /** Builds the ECharts option from the resolved palette. */
  build: (palette: ChartPalette) => EChartsOption;
  /** CSS height. ECharts needs a definite box; a bare percentage collapses. */
  height?: number | string;
  /**
   * Accessible description. A canvas is opaque to assistive tech, so charts
   * are exposed as `img` with this as the name. Pair with a visible table or
   * summary when the data itself matters.
   */
  ariaLabel: string;
  /** Replace rather than merge. Needed when series COUNT changes. */
  notMerge?: boolean;
  className?: string;
  /** Re-runs `build` when any value changes, alongside theme changes. */
  deps?: readonly unknown[];
}

export function Chart({
  build,
  height = 320,
  ariaLabel,
  notMerge = false,
  className,
  deps = [],
}: ChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<EChartsInstance | null>(null);
  /* `build` changes identity every render when written inline, which is the
   * normal call style. Held in a ref so it never re-triggers the effects. */
  const buildRef = useRef(build);
  buildRef.current = build;

  /* Bumped whenever the resolved palette could have changed. Effects key off
   * this rather than reading the palette during render, which would be a
   * hydration mismatch: the server has no DOM to probe. */
  const [themeTick, setThemeTick] = useState(0);

  /* --- instance lifecycle ------------------------------------------------ */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    /* Opts stay minimal on purpose. Passing `width`/`height` here, even as
     * "auto", stops the painter from ever creating its canvas: the instance
     * attaches and the wrapper div is sized correctly, but nothing paints and
     * nothing throws, which is a genuinely silent failure. Omitting them lets
     * ECharts measure the host, which is the behaviour that was wanted. */
    const chart = ensureECharts().init(host, undefined, { renderer: "canvas" });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(host);

    return () => {
      observer.disconnect();
      /* Dispose releases the canvas and the global resize/event handlers.
       * Skipping it leaks one canvas per mount, which is visible as steadily
       * growing memory when navigating between dashboards. */
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  /* --- react to theme changes -------------------------------------------- */
  useEffect(() => {
    const bump = () => setThemeTick((t) => t + 1);

    /* `data-theme` is what the app's own toggle writes. */
    const mo = new MutationObserver(bump);
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme", "style", "class"],
    });

    /* And the OS preference, which matters while the app is in `system`. */
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    mq.addEventListener("change", bump);

    return () => {
      mo.disconnect();
      mq.removeEventListener("change", bump);
    };
  }, []);

  /* --- option ------------------------------------------------------------ */
  useEffect(() => {
    const chart = chartRef.current;
    const host = hostRef.current;
    if (!chart || !host) return;

    const palette = readChartPalette(host);
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const option = buildRef.current(palette);

    chart.setOption(
      {
        /* Defaults every chart inherits; a `build` result overrides them
         * because setOption merges the caller's keys over these. */
        animation: !reduced,
        animationDuration: 420,
        animationEasing: "cubicOut",
        textStyle: {
          /* Inherit the app's font rather than ECharts' sans-serif stack, or
           * chart labels visibly disagree with every other label on screen. */
          fontFamily: "inherit",
          color: palette.fgMuted,
        },
        tooltip: {
          backgroundColor: palette.elevated,
          borderColor: palette.border,
          borderWidth: 1,
          padding: [8, 12],
          textStyle: { color: palette.fg, fontSize: 12 },
          extraCssText: "border-radius:12px;box-shadow:0 8px 24px rgb(0 0 0 / 0.08)",
        },
        ...(option as object),
      },
      /* No `lazyUpdate`. It defers the render to a later frame for a saving
       * that does not matter at this chart count, and it makes "did the theme
       * actually apply" untestable without knowing when ECharts flushed. */
      { notMerge }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeTick, notMerge, ...deps]);

  return (
    <div
      role="img"
      aria-label={ariaLabel}
      className={cn("relative w-full", className)}
      style={{ height }}
    >
      {/*
        ECharts injects its own <div><canvas> into `hostRef`, and React must
        never reconcile that subtree. Giving the library its own element with
        NO React children is what guarantees that.

        This is not defensive tidiness. When the host also rendered a React
        child, the first re-render after mount (a theme change bumps state)
        reconciled the host's children and tore the injected canvas back out.
        The instance stayed alive and `setOption` kept succeeding, so nothing
        threw and nothing logged; the charts simply went blank and never
        repainted again.
      */}
      <div ref={hostRef} className="size-full" />
    </div>
  );
}
