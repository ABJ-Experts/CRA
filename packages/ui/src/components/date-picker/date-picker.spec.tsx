import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DatePicker } from "./date-picker";

describe("DatePicker", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

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
    const calendar = screen.getByRole("grid");
    expect(calendar).toBeInTheDocument();
    expect(calendar.querySelector("[data-selected]")).toHaveClass(
      "[&_button]:text-on-accent",
    );
    rerender(<DatePicker label="Date" disabled error="Unavailable" />);
    expect(screen.getByLabelText("Date")).toBeDisabled();
  });

  it("keeps an accent foreground when the selected day is today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12));
    render(<DatePicker defaultValue={new Date(2026, 7, 12)} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose date" }));
    const selectedToday = screen
      .getByRole("grid")
      .querySelector("[data-selected][data-today]");

    expect(selectedToday).toHaveClass("[&_button]:text-on-accent");
    expect(selectedToday).not.toHaveClass("[&_button]:text-active-500");
  });

  it("keeps the active-color cue for a today that is not selected", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 12));
    render(<DatePicker defaultValue={new Date(2026, 7, 11)} />);

    fireEvent.click(screen.getByRole("button", { name: "Choose date" }));
    const today = screen.getByRole("grid").querySelector("[data-today]");

    expect(today).toHaveClass(
      "[&:not([data-selected])_button]:text-active-500",
    );
  });
});
