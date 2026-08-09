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
    vi.unstubAllGlobals();
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

  it("falls back to system mode when storage access is denied", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });

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

  it("still switches the document when storage writes fail", () => {
    vi.useFakeTimers();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage is disabled", "SecurityError");
    });

    applyTheme("light", document);

    expect(getTheme(document)).toBe("light");
    expect(document.documentElement.hasAttribute("data-theme-switching")).toBe(
      true,
    );
    vi.runAllTimers();
    expect(document.documentElement.hasAttribute("data-theme-switching")).toBe(
      false,
    );
  });

  it("is safe without a browser document or attached window", () => {
    const detachedDocument = document.implementation.createHTMLDocument();

    expect(() => applyTheme("dark", undefined)).not.toThrow();
    applyTheme("dark", detachedDocument);

    expect(getTheme(detachedDocument)).toBe("dark");
    expect(
      detachedDocument.documentElement.hasAttribute("data-theme-switching"),
    ).toBe(false);
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

  it("uses light as the server-side system fallback", () => {
    vi.stubGlobal("window", undefined);

    expect(resolveTheme("system")).toBe("light");
  });
});
