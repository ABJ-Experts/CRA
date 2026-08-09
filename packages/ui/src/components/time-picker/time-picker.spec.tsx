import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { TimePicker } from "./time-picker";

describe("TimePicker", () => {
  it("formats valid 12-hour and 24-hour values", () => {
    const { rerender } = render(<TimePicker label="Time" value="13:05" />);
    expect(screen.getByRole("button", { name: "Time" })).toHaveTextContent(
      "01 : 05 PM",
    );
    rerender(<TimePicker label="Time" value="08:30" hourCycle={24} />);
    expect(screen.getByRole("button", { name: "Time" })).toHaveTextContent(
      "08 : 30",
    );
    rerender(<TimePicker label="Time" value="99:99" />);
    expect(screen.getByRole("button", { name: "Time" })).toHaveTextContent(
      "00 : 00",
    );
  });

  it("opens selectors and wires helper/error/disabled semantics", async () => {
    const { rerender } = render(
      <TimePicker
        label="Meeting"
        defaultValue="09:15"
        minuteStep={15}
        helperText="Local time"
      />,
    );
    const trigger = screen.getByRole("button", { name: "Meeting" });
    expect(trigger).toHaveAccessibleDescription("Local time");
    await userEvent.click(trigger);
    expect(screen.getByTestId("time-hour")).toBeInTheDocument();
    expect(screen.getByTestId("time-minute")).toBeInTheDocument();
    expect(screen.getByTestId("time-meridiem")).toHaveAccessibleName("AM/PM");
    rerender(<TimePicker label="Meeting" error="Required" disabled />);
    expect(screen.getByRole("button", { name: "Meeting" })).toBeDisabled();
  });
});
