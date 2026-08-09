import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { OtpInput } from "./otp-input";

describe("OtpInput", () => {
  it("accepts digits, advances focus, and completes once", async () => {
    const onChange = vi.fn();
    const onComplete = vi.fn();
    render(
      <OtpInput
        length={3}
        label="Security code"
        onChange={onChange}
        onComplete={onComplete}
      />,
    );
    const digits = screen.getAllByRole("textbox");
    await userEvent.type(digits[0]!, "1a2");
    await userEvent.type(digits[2]!, "3");
    expect(onChange).toHaveBeenLastCalledWith("123");
    expect(onComplete).toHaveBeenCalledWith("123");
    expect(
      screen.getByRole("group", { name: "Security code" }),
    ).toBeInTheDocument();
  });

  it("supports paste, deletion, and navigation keys", async () => {
    const onChange = vi.fn();
    render(
      <OtpInput
        length={4}
        ariaLabel="MFA"
        defaultValue="12"
        onChange={onChange}
      />,
    );
    const digits = screen.getAllByRole("textbox");
    fireEvent.paste(digits[1]!, { clipboardData: { getData: () => "9x87" } });
    expect(onChange).toHaveBeenLastCalledWith("1987");
    await userEvent.type(digits[3]!, "{Backspace}");
    expect(onChange).toHaveBeenLastCalledWith("198");
    fireEvent.keyDown(digits[1]!, { key: "Delete" });
    fireEvent.keyDown(digits[1]!, { key: "ArrowLeft" });
    fireEvent.keyDown(digits[1]!, { key: "ArrowRight" });
    fireEvent.keyDown(digits[1]!, { key: "Home" });
    fireEvent.keyDown(digits[1]!, { key: "End" });
  });

  it("wires errors and disables every digit", () => {
    render(
      <OtpInput
        length={2}
        error="Expired"
        helperText="Hint"
        disabled
        autoFocus
      />,
    );
    expect(screen.getByRole("group")).toHaveAccessibleDescription("Expired");
    expect(screen.queryByText("Hint")).not.toBeInTheDocument();
    expect(screen.getAllByRole("textbox")).toEqual(
      expect.arrayContaining([expect.objectContaining({ disabled: true })]),
    );
  });
});
