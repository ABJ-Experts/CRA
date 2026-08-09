// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyTheme,
  getStoredTheme,
  getTheme,
  resolveTheme,
  THEME_STORAGE_KEY,
  themeScript,
} from "./theme";

describe("theme", () => {
  afterEach(() => {
    document.documentElement.removeAttribute("data-theme");
    document.documentElement.removeAttribute("data-theme-switching");
    localStorage.clear();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("publishes a pre-paint script using the shared storage key", () => {
    expect(themeScript).toContain(THEME_STORAGE_KEY);
    expect(themeScript).toContain('t === "light" || t === "dark"');
  });

  it("reads valid preferences and rejects unknown stored values", () => {
    expect(getStoredTheme()).toBe("system");
    localStorage.setItem(THEME_STORAGE_KEY, "dark");
    expect(getStoredTheme()).toBe("dark");
    localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(getStoredTheme()).toBe("system");
  });

  it("applies and persists a theme while transitions are suppressed", () => {
    vi.useFakeTimers();

    applyTheme("dark", document);

    expect(getTheme(document)).toBe("dark");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
    expect(document.documentElement.hasAttribute("data-theme-switching")).toBe(
      true,
    );
    vi.runAllTimers();
    expect(document.documentElement.hasAttribute("data-theme-switching")).toBe(
      false,
    );
  });

  it("removes an explicit preference for system mode", () => {
    localStorage.setItem(THEME_STORAGE_KEY, "light");
    document.documentElement.setAttribute("data-theme", "light");

    applyTheme("system", document);

    expect(getTheme(document)).toBe("system");
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBeNull();
  });

  it("resolves system mode from the media query and preserves explicit themes", () => {
    const matchMedia = vi.fn(() => ({
      matches: true,
    })) as unknown as Window["matchMedia"];
    const win = { matchMedia } as Window;

    expect(resolveTheme("system", win)).toBe("dark");
    expect(resolveTheme("light", win)).toBe("light");
    expect(matchMedia).toHaveBeenCalledOnce();
  });
});
