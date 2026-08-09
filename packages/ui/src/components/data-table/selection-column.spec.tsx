import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { selectionColumn } from "./selection-column";

describe("selectionColumn", () => {
  it("maps partial page selection to an indeterminate header", async () => {
    const toggle = vi.fn();
    const column = selectionColumn<{ name: string }>();
    const Header = column.header as (props: unknown) => React.ReactNode;
    render(
      <>
        {Header({
          table: {
            getIsAllPageRowsSelected: () => false,
            getIsSomePageRowsSelected: () => true,
            toggleAllPageRowsSelected: toggle,
          },
        })}
      </>,
    );
    const checkbox = screen.getByRole("checkbox", {
      name: "Select all rows on this page",
    });
    expect(checkbox).toHaveAttribute("data-state", "indeterminate");
    await userEvent.click(checkbox);
    expect(toggle).toHaveBeenCalledWith(true);
  });

  it("labels and disables an unavailable row", () => {
    const column = selectionColumn<{ name: string }>({
      size: 40,
      rowLabel: (row) => row.name,
    });
    const Cell = column.cell as (props: unknown) => React.ReactNode;
    render(
      <>
        {Cell({
          row: {
            original: { name: "Ada" },
            getIsSelected: () => false,
            getCanSelect: () => false,
            toggleSelected: vi.fn(),
          },
        })}
      </>,
    );
    expect(screen.getByRole("checkbox", { name: "Select Ada" })).toBeDisabled();
    expect(column.size).toBe(40);
  });
});
