import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Checkbox } from "./checkbox";

describe("Checkbox", () => {
  it("toggles from its associated label and returns the checked payload", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        label="Remember me"
        description="For 30 days"
        onCheckedChange={onCheckedChange}
      />,
    );

    const checkbox = screen.getByRole("checkbox", { name: "Remember me" });
    expect(checkbox).toHaveAccessibleDescription("For 30 days");
    await userEvent.click(screen.getByText("Remember me"));
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
  });

  it("announces errors and renders the indeterminate state", () => {
    render(
      <Checkbox label="All rows" checked="indeterminate" error="Choose rows" />,
    );
    const checkbox = screen.getByRole("checkbox", { name: "All rows" });
    expect(checkbox).toHaveAttribute("data-state", "indeterminate");
    expect(checkbox).toHaveAttribute("aria-invalid", "true");
    expect(checkbox).toHaveAccessibleDescription("Choose rows");
  });

  it("uses the accent foreground for a selected indicator", () => {
    render(<Checkbox label="Enabled" checked />);

    const checkbox = screen.getByRole("checkbox", { name: "Enabled" });
    expect(checkbox.firstElementChild).toHaveClass("text-on-accent");
  });

  it("does not toggle while disabled and includes linked label content", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Checkbox
        label="Accept"
        link="terms"
        disabled
        onCheckedChange={onCheckedChange}
      />,
    );
    expect(
      screen.getByRole("checkbox", { name: "Accept terms" }),
    ).toBeDisabled();
    await userEvent.click(screen.getByText("Accept"));
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
