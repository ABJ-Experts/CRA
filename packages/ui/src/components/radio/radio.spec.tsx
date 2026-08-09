import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Radio, RadioGroup } from "./radio";

describe("RadioGroup", () => {
  it("selects by label and reports exact values", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        label="Plan"
        description="Choose one"
        onValueChange={onValueChange}
        size="sm"
      >
        <Radio value="free" label="Free" description="Basic" />
        <Radio value="pro" label="Pro" link="Popular" />
      </RadioGroup>,
    );
    const group = screen.getByRole("radiogroup", { name: "Plan" });
    expect(group).toHaveAccessibleDescription("Choose one");
    await userEvent.click(screen.getByText("Pro"));
    expect(onValueChange).toHaveBeenLastCalledWith("pro");
    expect(screen.getByRole("radio", { name: "Pro Popular" })).toBeChecked();
  });

  it("wires group errors and prevents disabled option selection", async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup
        aria-label="Choice"
        error="Select an enabled option"
        onValueChange={onValueChange}
      >
        <Radio value="off" label="Unavailable" disabled size="md" />
      </RadioGroup>,
    );
    const group = screen.getByRole("radiogroup", { name: "Choice" });
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group).toHaveAccessibleDescription("Select an enabled option");
    await userEvent.click(screen.getByText("Unavailable"));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
