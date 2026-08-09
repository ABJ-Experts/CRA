import { render, screen } from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const chart = {
  setOption: vi.fn(),
  resize: vi.fn(),
  dispose: vi.fn(),
};
const init = vi.fn(() => chart);

vi.mock("./echarts", () => ({ ensureECharts: () => ({ init }) }));
vi.mock("./chart-palette", () => ({
  readChartPalette: () => ({
    fg: "fg",
    fgMuted: "muted",
    border: "border",
    elevated: "elevated",
  }),
}));

import { Chart } from "./chart";

describe("Chart", () => {
  afterEach(() => vi.clearAllMocks());

  it("owns one accessible chart instance and applies defaults", () => {
    const build = vi.fn(() => ({ series: [{ type: "bar", data: [1] }] }));
    const { unmount } = render(
      <Chart
        ariaLabel="Revenue by month"
        height="20rem"
        build={build}
        notMerge
      />,
    );

    expect(screen.getByRole("img", { name: "Revenue by month" })).toHaveStyle({
      height: "20rem",
    });
    expect(init).toHaveBeenCalledWith(expect.any(HTMLElement), undefined, {
      renderer: "canvas",
    });
    expect(chart.setOption).toHaveBeenCalledWith(
      expect.objectContaining({
        animation: true,
        series: [{ type: "bar", data: [1] }],
      }),
      { notMerge: true },
    );

    unmount();
    expect(chart.dispose).toHaveBeenCalledOnce();
  });

  it("rebuilds when observed theme attributes change", () => {
    const build = vi.fn(() => ({}));
    render(<Chart ariaLabel="Theme chart" build={build} deps={[1]} />);
    act(() => document.documentElement.setAttribute("data-theme", "dark"));
    expect(build).toHaveBeenCalled();
  });
});
