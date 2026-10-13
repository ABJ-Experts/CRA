// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LicensingBanner } from "./licensing-banner";
const fixtures = vi.hoisted(() => ({
  policy: { data: undefined as unknown, isError: false },
  enabled: true,
}));
vi.mock("./licensing.queries", () => ({ useLicensingQueries: () => fixtures }));
afterEach(() => {
  cleanup();
  fixtures.policy.data = undefined;
  fixtures.policy.isError = false;
});
describe("LicensingBanner", () => {
  it("stays quiet for a healthy licence", () => {
    fixtures.policy.data = {
      state: "active",
      warnings: [],
      reasons: [],
      customerWritesAllowed: true,
    };
    render(<LicensingBanner />);
    expect(screen.queryByRole("status")).toBeNull();
  });
  it("announces expiry without claiming safety operations are blocked", () => {
    fixtures.policy.data = {
      state: "expired_read_only",
      warnings: [],
      reasons: [],
      customerWritesAllowed: false,
    };
    render(<LicensingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("Expired");
    expect(
      screen.getByRole("link", { name: "Review licence" }),
    ).toHaveAttribute("href", "/organization?settings=licence");
    expect(screen.getByRole("status")).toHaveTextContent(
      "evidence export remains available",
    );
  });
  it("signals degraded policy without exposing cached details", () => {
    fixtures.policy.isError = true;
    render(<LicensingBanner />);
    expect(screen.getByRole("status")).toHaveTextContent("unavailable");
  });
});
it("does not announce a disabled or loading query", () => {
  fixtures.enabled = false;
  const view = render(<LicensingBanner />);
  expect(screen.queryByRole("status")).toBeNull();
  fixtures.enabled = true;
  view.rerender(<LicensingBanner />);
  expect(screen.queryByRole("status")).toBeNull();
});
it("shows approaching expiry with continuing writes", () => {
  fixtures.policy.data = {
    state: "active",
    warnings: ["approaching_expiry"],
    customerWritesAllowed: true,
  };
  render(<LicensingBanner />);
  expect(screen.getByRole("status")).toHaveTextContent("approaching expiry");
  expect(screen.getByRole("status")).toHaveTextContent(
    "Entitled writes remain available",
  );
});
