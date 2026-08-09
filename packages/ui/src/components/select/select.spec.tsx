import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Select,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
} from "./select";

describe("Select", () => {
  it("opens from its label and emits the chosen value", async () => {
    const onValueChange = vi.fn();
    const user = userEvent.setup();
    render(
      <Select
        label="Country"
        helperText="Where you live"
        required
        onValueChange={onValueChange}
        data-testid="country"
      >
        <SelectGroup>
          <SelectLabel>Europe</SelectLabel>
          <SelectItem
            value="uk"
            startIcon={<span>🇬🇧</span>}
            description="United Kingdom"
          >
            UK
          </SelectItem>
        </SelectGroup>
        <SelectSeparator />
        <SelectItem value="us">US</SelectItem>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Country" });
    expect(trigger).toHaveAccessibleDescription("Where you live");
    expect(trigger).toHaveAttribute("data-testid", "country");
    await user.click(screen.getByText("Country"));
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("option", { name: /uk/i })).toBeVisible();
    await user.keyboard("{Escape}");
    await user.click(trigger);
    await user.click(screen.getByRole("option", { name: /uk/i }));
    expect(onValueChange).toHaveBeenCalledWith("uk");
  });

  it("wires disabled error semantics", () => {
    render(
      <Select aria-label="Broken" error="Required" disabled>
        <SelectItem value="x">X</SelectItem>
      </Select>,
    );
    const trigger = screen.getByRole("combobox", { name: "Broken" });
    expect(trigger).toBeDisabled();
    expect(trigger).toHaveAccessibleDescription("Required");
  });

  it("merges caller descriptions without overriding managed state", () => {
    render(
      <>
        <p id="policy-help">Required by policy</p>
        <Select
          aria-label="Country"
          aria-describedby="policy-help"
          aria-expanded="true"
          helperText="Where you live"
        >
          <SelectItem value="uk">UK</SelectItem>
        </Select>
      </>,
    );

    const trigger = screen.getByRole("combobox", { name: "Country" });
    expect(trigger).toHaveAccessibleDescription(
      "Required by policy Where you live",
    );
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });
});
