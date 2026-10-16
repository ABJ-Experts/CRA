// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProductOwnerSelector,
  ProductOwnerLabel,
} from "./product-owner-selector";
type OwnerFixture = {
  data?: {
    owners?: { rows: { id: string; displayName: string }[]; pageCount: number };
    selectedOwner: { id: string; displayName: string } | null;
  };
  isError?: boolean;
  isPending?: boolean;
  refetch?: () => void;
};
const state = vi.hoisted(() => ({ value: {} as OwnerFixture }));
vi.mock("./product-owner-options.queries", () => ({
  useProductOwnerOptionsQuery: () => state.value,
}));
afterEach(cleanup);
const id = "11111111-1111-4111-8111-111111111111";
describe("owner presentation", () => {
  it("shows readable selected owner and emits identifier on change", () => {
    state.value = {
      data: {
        owners: { rows: [{ id, displayName: "Alice" }], pageCount: 2 },
        selectedOwner: null,
      },
    };
    const change = vi.fn();
    render(<ProductOwnerSelector value={id} onChange={change} />);
    expect(screen.getByRole("option", { name: "Alice" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: id } });
    expect(change).toHaveBeenCalledWith(id);
    fireEvent.click(screen.getByRole("button", { name: "Next owners" }));
    expect(
      screen.getByRole("button", { name: "Previous owners" }),
    ).toBeEnabled();
  });
  it("preserves unknown selected owner on outage and offers retry", () => {
    const refetch = vi.fn();
    state.value = { isError: true, refetch };
    render(<ProductOwnerSelector value={id} onChange={vi.fn()} />);
    expect(
      screen.getByRole("option", { name: "Selected owner unavailable" }),
    ).toHaveValue(id);
    fireEvent.click(screen.getByRole("button", { name: "Retry owners" }));
    expect(refetch).toHaveBeenCalled();
  });
  it("includes a selected owner outside the page and disambiguates duplicate names", () => {
    state.value = {
      data: {
        owners: {
          rows: [
            {
              id: "22222222-2222-4222-8222-222222222222",
              displayName: "Alice",
            },
          ],
          pageCount: 2,
        },
        selectedOwner: { id, displayName: "Alice" },
      },
    };
    render(<ProductOwnerSelector value={id} onChange={vi.fn()} />);
    expect(
      screen.getAllByRole("option").map((node) => node.textContent),
    ).toContain("Alice (11111111)");
    fireEvent.click(screen.getByRole("button", { name: "Next owners" }));
    fireEvent.click(screen.getByRole("button", { name: "Previous owners" }));
    expect(
      screen.getByRole("button", { name: "Previous owners" }),
    ).toBeDisabled();
  });
  it("renders loading and empty directory with outage label", () => {
    state.value = { isPending: true };
    const { rerender } = render(
      <ProductOwnerSelector value="" onChange={vi.fn()} />,
    );
    expect(
      screen.getByRole("option", { name: "Loading owners…" }),
    ).toBeInTheDocument();
    state.value = {
      data: { owners: { rows: [], pageCount: 1 }, selectedOwner: null },
    };
    rerender(<ProductOwnerSelector value="" onChange={vi.fn()} />);
    expect(
      screen.getByText("No active members on this page."),
    ).toBeInTheDocument();
    state.value = { isError: true };
    rerender(<ProductOwnerLabel productId={id} ownerId={id} />);
    expect(
      screen.getByText("Owner temporarily unavailable"),
    ).toBeInTheDocument();
  });
  it("shows loading, empty and inactive labels without UUID", () => {
    state.value = { isPending: true };
    const { rerender } = render(
      <ProductOwnerLabel productId={id} ownerId={id} />,
    );
    expect(screen.getByText("Loading owner…")).toBeInTheDocument();
    state.value = { data: { selectedOwner: null } };
    rerender(<ProductOwnerLabel productId={id} ownerId={id} />);
    expect(
      screen.getByText("Owner unavailable or inactive"),
    ).toBeInTheDocument();
    state.value = { data: { selectedOwner: { id, displayName: "Alice" } } };
    rerender(<ProductOwnerLabel productId={id} ownerId={id} />);
    expect(screen.getByText("Alice")).toBeInTheDocument();
  });
});
