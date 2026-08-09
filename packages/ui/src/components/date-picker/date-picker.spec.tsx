import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { DatePicker } from "./date-picker";

describe("DatePicker", () => {
  it("commits typed valid dates and preserves invalid drafts", async () => {
    const onValueChange = vi.fn();
    render(
      <DatePicker
        label="Start date"
        onValueChange={onValueChange}
        helperText="DD MM YYYY"
      />,
    );
    const input = screen.getByLabelText("Start date");
    await userEvent.type(input, "09 08 2026");
    fireEvent.blur(input);
    expect(onValueChange).toHaveBeenCalledWith(expect.any(Date));
    await userEvent.clear(input);
    await userEvent.type(input, "invalid");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(input).toHaveValue("invalid");
  });

  it("opens its accessible calendar and supports disabled errors", async () => {
    const { rerender } = render(
      <DatePicker aria-label="Date" defaultValue={new Date(2026, 7, 9)} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Choose date" }));
    expect(screen.getByRole("grid")).toBeInTheDocument();
    rerender(<DatePicker label="Date" disabled error="Unavailable" />);
    expect(screen.getByLabelText("Date")).toBeDisabled();
  });
});
