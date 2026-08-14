// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import ProductsPage from "./page";

const view = vi.hoisted(() => ({
  state: "loading" as "loading" | "empty" | "error" | "ready" | "forbidden",
}));

vi.mock("./products-registry-content", () => ({
  ProductsRegistryContent: () => (
    <div data-state={view.state}>{view.state}</div>
  ),
}));

describe("ProductsPage", () => {
  afterEach(cleanup);

  it("mounts the production registry surface instead of the dashboard mock table", () => {
    view.state = "ready";
    render(<ProductsPage />);

    expect(screen.getByText("ready")).toBeInTheDocument();
  });
});
