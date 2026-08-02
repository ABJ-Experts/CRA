/**
 * Persistence for the sidebar's collapsed state.
 *
 * Mirrors the theme's approach in `@repo/design-system/theme`, and for the
 * same reason: the rail is 270px expanded and 66px collapsed, so a user who
 * collapsed it sees the wide rail render and then snap narrow on hydration.
 * That is a 204px layout jump on every single page load, and it shifts every
 * chart and table beside it.
 *
 * The blocking script sets a `data-sidebar` attribute on <html> before first
 * paint. CSS keys off that attribute for the initial width, so the correct
 * layout is painted immediately; React then reads the same value on mount so
 * its state agrees with what is already on screen.
 */

export const SIDEBAR_STORAGE_KEY = "cra-sidebar";
export const SIDEBAR_ATTR = "data-sidebar";

export const sidebarScript = `
try {
  var s = localStorage.getItem(${JSON.stringify(SIDEBAR_STORAGE_KEY)});
  if (s === "collapsed") {
    document.documentElement.setAttribute("${SIDEBAR_ATTR}", "collapsed");
  }
} catch (e) {}
`.trim();

export function getStoredCollapsed(): boolean {
  try {
    return globalThis.localStorage?.getItem(SIDEBAR_STORAGE_KEY) === "collapsed";
  } catch {
    /* Storage can throw in private modes and sandboxed frames. Defaulting to
     * expanded is the safer miss: a too-wide rail is usable, a rail stuck
     * collapsed with no labels is not. */
    return false;
  }
}

export function storeCollapsed(collapsed: boolean) {
  try {
    globalThis.localStorage?.setItem(
      SIDEBAR_STORAGE_KEY,
      collapsed ? "collapsed" : "expanded"
    );
  } catch {
    /* Non-fatal: the rail still works, it just will not be remembered. */
  }
  const root = globalThis.document?.documentElement;
  if (!root) return;
  if (collapsed) root.setAttribute(SIDEBAR_ATTR, "collapsed");
  else root.removeAttribute(SIDEBAR_ATTR);
}
