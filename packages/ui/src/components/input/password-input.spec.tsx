import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { PasswordInput } from "./password-input";

describe("PasswordInput", () => {
  it("reveals and hides an uncontrolled password accessibly", async () => {
    const onVisibleChange = vi.fn();
    render(
      <PasswordInput
        id="password"
        label="Password"
        onVisibleChange={onVisibleChange}
      />,
    );

    const input = screen.getByLabelText("Password");
    const show = screen.getByRole("button", { name: "Show password" });
    expect(input).toHaveAttribute("type", "password");
    expect(show).toHaveAttribute("aria-controls", "password");
    fireEvent.mouseDown(show);
    await userEvent.click(show);
    expect(input).toHaveAttribute("type", "text");
    expect(onVisibleChange).toHaveBeenLastCalledWith(true);
    await userEvent.click(
      screen.getByRole("button", { name: "Hide password" }),
    );
    expect(input).toHaveAttribute("type", "password");
  });

  it("reports controlled visibility without changing it itself", async () => {
    const onVisibleChange = vi.fn();
    const { rerender } = render(
      <PasswordInput
        label="Secret"
        visible={false}
        onVisibleChange={onVisibleChange}
      />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: "Show password" }),
    );
    expect(screen.getByLabelText("Secret")).toHaveAttribute("type", "password");
    expect(onVisibleChange).toHaveBeenCalledWith(true);

    rerender(
      <PasswordInput
        label="Secret"
        visible
        onVisibleChange={onVisibleChange}
      />,
    );
    expect(screen.getByLabelText("Secret")).toHaveAttribute("type", "text");
  });

  it("can disable or remove the reveal control", () => {
    const { rerender } = render(<PasswordInput label="Secret" disabled />);
    expect(
      screen.getByRole("button", { name: "Show password" }),
    ).toBeDisabled();
    rerender(
      <PasswordInput label="Secret" revealable={false} startIcon={null} />,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });
});
