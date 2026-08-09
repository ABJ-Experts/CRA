import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Combobox } from "./combobox";

const options = [
  {
    value: "uk",
    label: "United Kingdom",
    group: "Europe",
    keywords: ["britain"],
  },
  { value: "fr", label: "France", group: "Europe", disabled: true },
  { value: "jp", label: "Japan", icon: <span>🇯🇵</span> },
];

describe("Combobox", () => {
  it("searches keywords, selects, clears, and returns focus", async () => {
    const onValueChange = vi.fn();
    render(
      <Combobox
        label="Country"
        options={options}
        clearable
        onValueChange={onValueChange}
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Country" });
    await userEvent.click(trigger);
    const search = screen.getByPlaceholderText("Search");
    await userEvent.type(search, "britain");
    await userEvent.click(screen.getByText("United Kingdom"));
    expect(onValueChange).toHaveBeenCalledWith("uk");
    expect(trigger).toHaveFocus();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Clear selection" }),
    );
    expect(onValueChange).toHaveBeenLastCalledWith("");
  });

  it("shows empty and error states", async () => {
    render(
      <Combobox
        aria-label="Empty picker"
        options={[]}
        error="Choose one"
        emptyMessage="No countries"
      />,
    );
    const trigger = screen.getByRole("combobox", { name: "Empty picker" });
    expect(trigger).toHaveAccessibleDescription("Choose one");
    await userEvent.click(trigger);
    expect(screen.getByText("No countries")).toBeInTheDocument();
  });
});
