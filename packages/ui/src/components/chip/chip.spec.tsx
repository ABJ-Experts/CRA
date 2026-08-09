import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Chip } from "./chip";

describe("Chip", () => {
  it("renders an avatar and removes the named selection", async () => {
    const onRemove = vi.fn();
    render(
      <Chip
        avatar={<span>A</span>}
        onRemove={onRemove}
        removeLabel="Remove Ada"
      >
        Ada Lovelace
      </Chip>,
    );
    expect(screen.getByText("A")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Remove Ada" }));
    expect(onRemove).toHaveBeenCalledOnce();
  });

  it("renders read-only and disabled states", () => {
    const { rerender } = render(<Chip>Fixed</Chip>);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    rerender(
      <Chip disabled onRemove={() => undefined}>
        Disabled
      </Chip>,
    );
    expect(screen.getByRole("button", { name: "Remove" })).toBeDisabled();
    expect(screen.getByText("Disabled").parentElement).toHaveAttribute(
      "data-disabled",
      "true",
    );
  });
});
