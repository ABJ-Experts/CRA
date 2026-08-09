import { afterEach, describe, expect, it, vi } from "vitest";

import { readChartPalette, withAlpha } from "./chart-palette";

describe("chart palette", () => {
  afterEach(() => vi.restoreAllMocks());

  it("reads themed values inside the host document and removes its probe", () => {
    const computed = vi
      .spyOn(window, "getComputedStyle")
      .mockImplementation(
        (element) =>
          ({
            color: element instanceof HTMLElement ? "rgb(1, 2, 3)" : "",
          }) as CSSStyleDeclaration,
      );
    const host = document.createElement("div");
    document.body.appendChild(host);

    const palette = readChartPalette(host);

    expect(palette.fg).toBe("rgb(1, 2, 3)");
    expect(palette.series).toHaveLength(6);
    expect(palette.heat).toEqual([
      "rgb(1, 2, 3)",
      "rgb(1, 2, 3)",
      "rgb(1, 2, 3)",
    ]);
    expect(computed).toHaveBeenCalled();
    expect(
      document.body.querySelector('[aria-hidden="true"]'),
    ).not.toBeInTheDocument();
  });

  it("falls back for transparent unresolved tokens", () => {
    vi.spyOn(window, "getComputedStyle").mockReturnValue({
      color: "rgba(0, 0, 0, 0)",
    } as CSSStyleDeclaration);
    expect(readChartPalette().active).toBe("#595fe5");
  });

  it.each([
    ["rgb(10, 20, 30)", 0.5, "rgba(10, 20, 30, 0.5)"],
    ["rgba(10, 20, 30, 1)", 0.25, "rgba(10, 20, 30, 0.25)"],
    ["currentColor", 0.5, "currentColor"],
  ] as const)("applies alpha to %s", (color, alpha, expected) => {
    expect(withAlpha(color, alpha)).toBe(expected);
  });
});
