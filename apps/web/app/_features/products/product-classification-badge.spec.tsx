// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProductClassificationBadge } from "./product-classification-badge";
afterEach(cleanup);
it("shows explicit provisional and changed-version states", () => {
  render(
    <ProductClassificationBadge
      productVersion={2}
      latest={{
        classification: "critical",
        productVersion: 1,
        revision: 1,
        policyStatus: "engineering_provisional",
        createdAt: "2026-09-28T00:00:00Z",
      }}
    />,
  );
  expect(
    screen.getByText("Provisional: Critical · Product changed"),
  ).toBeInTheDocument();
});
it("does not claim statutory classification from missing or failed read", () => {
  const { rerender } = render(
    <ProductClassificationBadge productVersion={1} latest={null} />,
  );
  expect(screen.getByText("Not classified")).toBeInTheDocument();
  rerender(<ProductClassificationBadge productVersion={1} loading />);
  expect(screen.getByText("Loading classification…")).toBeInTheDocument();
  rerender(<ProductClassificationBadge productVersion={1} unavailable />);
  expect(screen.getByText("Classification unavailable")).toBeInTheDocument();
});
it("renders unchanged provisional summary", () => {
  render(
    <ProductClassificationBadge
      productVersion={1}
      latest={{
        classification: "default",
        productVersion: 1,
        revision: 1,
        policyStatus: "engineering_provisional",
        createdAt: "2026-09-28T00:00:00Z",
      }}
    />,
  );
  expect(screen.getByText("Provisional: Default")).toBeInTheDocument();
});
