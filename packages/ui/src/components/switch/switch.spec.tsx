import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Switch } from "./switch";

describe("Switch", () => {
  it("toggles through the associated label", async () => {
    const onCheckedChange = vi.fn();
    render(
      <Switch
        label="Notifications"
        description="Weekly summary"
        onCheckedChange={onCheckedChange}
      />,
    );
    const control = screen.getByRole("switch", { name: "Notifications" });
    expect(control).toHaveAccessibleDescription("Weekly summary");
    await userEvent.click(screen.getByText("Notifications"));
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it("supports leading labels, links, size variants, and disabled state", () => {
    render(
      <Switch
        label="Security"
        link="recommended"
        labelPosition="start"
        size="md"
        disabled
        wrapperClassName="wrapper"
      />,
    );
    const control = screen.getByRole("switch", {
      name: "Security recommended",
    });
    expect(control).toBeDisabled();
    expect(control.parentElement).toHaveClass("flex-row-reverse");
    expect(control.closest(".wrapper")).toBeInTheDocument();
  });
});
