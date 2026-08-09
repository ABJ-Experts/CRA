import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Input } from "./input";

describe("Input", () => {
  it("associates its generated label and helper text", async () => {
    const onChange = vi.fn();
    render(
      <Input
        label="Email"
        helperText="Work address"
        required
        onChange={onChange}
      />,
    );

    const input = screen.getByRole("textbox", { name: /email/i });
    expect(input).toBeRequired();
    expect(input).toHaveAccessibleDescription("Work address");
    await userEvent.type(input, "a@b.test");
    expect(onChange).toHaveBeenCalled();
  });

  it("prioritizes an error over helper text and wires validation attributes", () => {
    render(
      <Input
        id="email"
        label="Email"
        helperText="Hint"
        error="Invalid email"
      />,
    );

    const input = screen.getByLabelText("Email");
    expect(input).toHaveAttribute("aria-invalid", "true");
    expect(input).toHaveAttribute("aria-errormessage", "email-error");
    expect(input).toHaveAccessibleDescription("Invalid email");
    expect(screen.queryByText("Hint")).not.toBeInTheDocument();
  });

  it("supports hidden labels, adornments, disabled state, and custom classes", () => {
    render(
      <Input
        label="Query"
        hideLabel
        disabled
        size="xl"
        startIcon={<span>start</span>}
        endIcon={<button type="button">end</button>}
        className="custom-field"
        wrapperClassName="custom-wrapper"
      />,
    );

    const input = screen.getByLabelText("Query");
    expect(input).toBeDisabled();
    expect(input.parentElement).toHaveClass("custom-field");
    expect(input.parentElement?.parentElement).toHaveClass("custom-wrapper");
    expect(screen.getByText("start").parentElement).toHaveAttribute(
      "aria-hidden",
      "true",
    );
  });
});
