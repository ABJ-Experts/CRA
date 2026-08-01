/**
 * Theme switching for the `light-dark()` token layer.
 *
 * Every colour token in `styles.css` is a `light-dark()` value resolved
 * through `color-scheme`, and `color-scheme` is driven by `data-theme` on
 * <html>. Setting that attribute directly *almost* works, and that is the
 * trap: elements carrying a CSS transition on an affected property keep the
 * pre-flip colour indefinitely instead of animating to the new one. The page
 * ends up half-switched until a hover or reflow forces a recompute.
 *
 * `applyTheme` closes that hole by suppressing transitions for exactly one
 * frame around the change. Prefer it over touching `data-theme` by hand.
 */

export type Theme = "light" | "dark" | "system";

const THEME_ATTR = "data-theme";
const SWITCHING_ATTR = "data-theme-switching";

/**
 * Set the colour theme on the document.
 *
 * `"system"` removes the attribute, falling back to the OS preference.
 * Safe to call during SSR: it no-ops when there is no document.
 */
export function applyTheme(theme: Theme, doc: Document | undefined = globalThis.document): void {
  if (!doc) return;

  const root = doc.documentElement;

  root.setAttribute(SWITCHING_ATTR, "");

  if (theme === "system") root.removeAttribute(THEME_ATTR);
  else root.setAttribute(THEME_ATTR, theme);

  const view = doc.defaultView;
  if (!view) {
    root.removeAttribute(SWITCHING_ATTR);
    return;
  }

  // Force a synchronous style recalculation while transitions are still
  // suppressed. This is the load-bearing line: it is what makes the browser
  // commit the newly resolved `light-dark()` colours. Merely waiting a frame
  // is not enough - the transition would still be re-enabled with the old
  // value as its start point, and then never advance.
  void view.getComputedStyle(root).color;

  // 1ms rather than rAF: rAF does not fire in a background tab, and a theme
  // change absolutely can happen there (an OS-level switch, another tab
  // writing to storage). The recalc above has already landed, so there is
  // nothing left to wait for.
  view.setTimeout(() => root.removeAttribute(SWITCHING_ATTR), 1);
}

/** The theme currently applied to the document, or `"system"` if unset. */
export function getTheme(doc: Document | undefined = globalThis.document): Theme {
  const value = doc?.documentElement.getAttribute(THEME_ATTR);
  return value === "light" || value === "dark" ? value : "system";
}

/** Resolves `"system"` to what the OS is actually asking for right now. */
export function resolveTheme(
  theme: Theme,
  win: Window | undefined = globalThis.window
): "light" | "dark" {
  if (theme !== "system") return theme;
  return win?.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
