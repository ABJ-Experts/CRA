import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("motion/react", () => ({
  motion: { div: "div" },
  useInView: vi.fn(() => true),
  useReducedMotion: vi.fn(() => true),
}));

import { DeltaBadge, StatCard } from "./stat-card";

describe("StatCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders the final numeric value for reduced motion", () => {
    render(
      <StatCard
        label="Revenue"
        value={1250}
        format={(value) => `$${value.toFixed(0)}`}
        delta={<DeltaBadge value={2.5} />}
        icon={<span>chart</span>}
      />,
    );
    expect(screen.getByText("$1250")).toBeInTheDocument();
    expect(screen.getByText("+2.50%")).toHaveClass("text-success-fg");
    expect(screen.getByText("chart")).toBeInTheDocument();
  });

  it("renders static content and negative custom-suffix changes", () => {
    render(
      <StatCard
        label="Status"
        display="Healthy"
        delta={<DeltaBadge value={-1} suffix=" pts" />}
      />,
    );
    expect(screen.getByText("Healthy")).toBeInTheDocument();
    expect(screen.getByText("-1.00 pts")).toHaveClass("text-danger-fg");
  });
});
