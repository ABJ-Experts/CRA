/**
 * Bridges the CSS token layer into ECharts.
 *
 * ECharts takes concrete colour strings, so the themed tokens have to be read
 * out of CSS at runtime. That is done with a probe: one hidden element per
 * token carrying `color: var(--token)`, read back as a computed `rgb(...)`.
 *
 * Reading `getPropertyValue("--color-fg")` off the root would also work
 * against the CURRENT build, which emits a concrete per-theme hex (verified:
 * `#1b1d1f` under `data-theme="light"`, `#fff` under `dark`). The probe is
 * used anyway because it resolves the value whatever form the variable takes.
 * If any token is ever authored as `light-dark(a, b)` — the form used
 * throughout styles.css and preserved verbatim under `@theme inline` — a raw
 * `getPropertyValue` returns the unresolved function text, which ECharts
 * cannot parse and silently renders black. The probe cannot regress that way,
 * and it costs one flush per theme change.
 *
 * Either way the browser resolves against the live `color-scheme`, so the
 * same code yields the light or dark palette with no branch here.
 */

/** Tokens the charts need, in the order the probe reads them. */
const TOKENS = {
  fg: "--color-fg",
  fgMuted: "--color-fg-muted",
  fgSubtle: "--color-fg-subtle",
  border: "--color-border",
  borderStrong: "--color-border-strong",
  canvas: "--color-canvas",
  surface: "--color-surface",
  surfaceMuted: "--color-surface-muted",
  elevated: "--color-elevated",
  accent: "--color-accent",
  active: "--color-active-500",
  success: "--color-success",
  danger: "--color-danger",
  warning: "--color-warning",
  info: "--color-info",
  premium: "--color-premium",
  /* Heat Map (cwxvd) ramps across the cyan-blue steps rather than an opacity
   * fade, so all three are read instead of being derived. */
  heat1: "--color-cyan-blue-200",
  heat2: "--color-cyan-blue-300",
  heat3: "--color-cyan-blue-500",
  /* The Mixed chart's area wash. See the note on this token in styles.css:
   * it is the stop behind `--ds-gradient-glow-origin-green`, deliberately a
   * more saturated green than `success`. */
  glowGreen: "--color-glow-origin-green",
} as const;

export type ChartPalette = { [K in keyof typeof TOKENS]: string } & {
  /** Categorical order, matching the series colours used across the frames. */
  series: string[];
  /** Heat Map ramp, light to dark. */
  heat: string[];
};

/** Used before mount and during SSR, where there is no document to probe. */
const FALLBACK: ChartPalette = {
  fg: "#1b1d1f",
  fgMuted: "#727880",
  fgSubtle: "#9da2a7",
  border: "#eeeeee",
  borderStrong: "#c6c8cb",
  canvas: "#ffffff",
  surface: "#f5f5f5",
  surfaceMuted: "#eeeeee",
  elevated: "#ffffff",
  accent: "#4a50d6",
  active: "#595fe5",
  success: "#7dc066",
  danger: "#e5646c",
  warning: "#f3935d",
  info: "#59b4d1",
  premium: "#9e57e5",
  heat1: "#d1f1ff",
  heat2: "#a9ddf5",
  heat3: "#59b4d1",
  glowGreen: "#40c76e",
  series: ["#595fe5", "#7dc066", "#f3935d", "#59b4d1", "#9e57e5", "#e5646c"],
  heat: ["#d1f1ff", "#a9ddf5", "#59b4d1"],
};

const KEYS = Object.keys(TOKENS) as (keyof typeof TOKENS)[];

export function readChartPalette(host?: Element | null): ChartPalette {
  if (typeof document === "undefined") return FALLBACK;

  /* Probes must live inside the themed subtree so they inherit `color-scheme`;
   * `document.body` always is. `visibility: hidden` rather than
   * `display: none`, because a display-none element still computes `color`
   * but skipping layout entirely has bitten this pattern before in older
   * engines. It is 1px and out of flow, so it cannot affect the page. */
  const anchor = host?.ownerDocument?.body ?? document.body;
  if (!anchor) return FALLBACK;

  const probe = document.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText =
    "position:absolute;left:-9999px;top:0;width:1px;height:1px;" +
    "visibility:hidden;pointer-events:none;contain:strict";

  const cells = KEYS.map((key) => {
    const cell = document.createElement("span");
    cell.style.color = `var(${TOKENS[key]})`;
    probe.appendChild(cell);
    return cell;
  });

  anchor.appendChild(probe);

  const out = {} as Record<keyof typeof TOKENS, string>;
  try {
    KEYS.forEach((key, i) => {
      const cell = cells[i];
      const value = cell ? getComputedStyle(cell).color : "";
      /* An unknown token computes to the initial colour rather than throwing.
       * Falling back keeps one missing token from turning a whole chart black. */
      out[key] = value && value !== "rgba(0, 0, 0, 0)" ? value : FALLBACK[key];
    });
  } finally {
    probe.remove();
  }

  return {
    ...out,
    series: [out.active, out.success, out.warning, out.info, out.premium, out.danger],
    heat: [out.heat1, out.heat2, out.heat3],
  };
}

/**
 * `rgb(r, g, b)` -> `rgba(r, g, b, alpha)`.
 *
 * The probe always returns rgb/rgba, never hex, so gradients and washes are
 * built from that form instead of hand-written hex with an alpha suffix.
 */
export function withAlpha(color: string, alpha: number): string {
  const nums = color.match(/-?[\d.]+/g);
  if (!nums || nums.length < 3) return color;
  return `rgba(${nums[0]}, ${nums[1]}, ${nums[2]}, ${alpha})`;
}
