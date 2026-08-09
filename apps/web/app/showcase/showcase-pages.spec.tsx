// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const theme = vi.hoisted(() => ({
  applyTheme: vi.fn(),
  getStoredTheme: vi.fn(() => "dark" as const),
}));

vi.mock("@repo/design-system/theme", () => theme);
vi.mock("@repo/ui/chart", () => {
  const Chart = ({ className }: { className?: string }) => (
    <div role="img" aria-label="Demo chart" className={className} />
  );
  return {
    CandlestickChart: Chart,
    DonutChart: Chart,
    GaugeChart: Chart,
    HeatmapChart: Chart,
    MixedChart: Chart,
    RadialBar: Chart,
    ScatterChart: Chart,
    Sparkline: Chart,
    StackedBarChart: Chart,
  };
});

import ChartsPage from "./charts/page";
import ShowcasePage, { metadata } from "./page";

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class ResizeObserver {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class IntersectionObserver {
      observe() {
        return undefined;
      }
      unobserve() {
        return undefined;
      }
      disconnect() {
        return undefined;
      }
    },
  );
  Element.prototype.scrollIntoView = vi.fn();
  Element.prototype.hasPointerCapture = vi.fn(() => false);
  Element.prototype.setPointerCapture = vi.fn();
  Element.prototype.releasePointerCapture = vi.fn();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("showcase pages", () => {
  it("renders every design-system behavior family and its semantic headings", async () => {
    render(<ShowcasePage />);

    expect(metadata.title).toBe("Design system showcase");
    expect(
      screen.getByRole("heading", { level: 1, name: "Design system" }),
    ).toBeVisible();
    for (const name of [
      "Button / Fill",
      "Input",
      "Checkbox",
      "Switch",
      "Radio",
      "Select",
      "Combobox (searchable select)",
      "Form (Zod + React Hook Form)",
      "Alert",
      "Modal",
      "Pagination",
      "Date Picker",
      "Editor",
    ]) {
      expect(screen.getByRole("heading", { name })).toBeVisible();
    }
    await waitFor(() => expect(theme.getStoredTheme).toHaveBeenCalled());
    expect(theme.applyTheme).toHaveBeenCalledWith("dark");
  });

  it("keeps showcase controls live instead of presenting static examples", async () => {
    const user = userEvent.setup();
    render(<ShowcasePage />);

    await user.click(screen.getByRole("button", { name: "Light" }));
    expect(theme.applyTheme).toHaveBeenLastCalledWith("light");

    await user.click(
      screen.getByRole("button", { name: "Remove Ada Lovelace" }),
    );
    expect(screen.queryByText("Ada Lovelace")).not.toBeInTheDocument();

    const notificationSwitch = screen.getByTestId("sw-controlled");
    await user.click(notificationSwitch);
    expect(screen.getByText("off")).toBeVisible();

    const parentCheckbox = screen.getByTestId("cb-parent");
    await user.click(parentCheckbox);
    expect(
      screen.getAllByRole("checkbox", { checked: true }).length,
    ).toBeGreaterThan(1);
  });

  it("renders the chart catalogue with accessible navigation", () => {
    render(<ChartsPage />);

    expect(
      screen.getByRole("heading", { level: 1, name: /Charts/ }),
    ).toBeVisible();
    expect(
      screen.getAllByRole("img", { name: "Demo chart" }).length,
    ).toBeGreaterThanOrEqual(9);
    expect(screen.getByRole("link", { name: "Back" })).toHaveAttribute(
      "href",
      "/showcase",
    );
  });
});
