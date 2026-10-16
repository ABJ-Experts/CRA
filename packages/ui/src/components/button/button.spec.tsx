import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Button } from "../../index";

describe("Button", () => {
  it("uses the accent foreground for a filled primary button", () => {
    render(<Button>Save</Button>);

    expect(screen.getByRole("button", { name: "Save" })).toHaveClass(
      "text-on-accent",
    );
  });

  it("uses the accent foreground for a balloon button", () => {
    render(<Button variant="balloon">Reply</Button>);

    expect(screen.getByRole("button", { name: "Reply" })).toHaveClass(
      "text-on-accent",
    );
  });

  it("is a non-submitting button by default and forwards activation", async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole("button", { name: "Save" });
    expect(button).toHaveAttribute("type", "button");
    await userEvent.click(button);
    expect(onClick).toHaveBeenCalledOnce();
  });

  it("announces loading and blocks interaction", async () => {
    const onClick = vi.fn();
    render(
      <Button loading loadingLabel="Saving profile" onClick={onClick}>
        Save
      </Button>,
    );

    const button = screen.getByRole("button", { name: /save saving profile/i });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    await userEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("makes a disabled asChild link inert for pointer and keyboard users", async () => {
    const onClick = vi.fn();
    render(
      <Button
        asChild
        disabled
        fullWidth
        variant="outline"
        tone="grey"
        onClick={onClick}
      >
        <a href="/account">Account</a>
      </Button>,
    );

    const link = screen.getByRole("link", { name: "Account" });
    expect(link).toHaveAttribute("href", "/account");
    expect(link).toHaveAttribute("aria-disabled", "true");
    expect(link).toHaveAttribute("tabindex", "-1");
    expect(link).toHaveClass("pointer-events-none", "w-full");
    await userEvent.tab();
    expect(link).not.toHaveFocus();
    fireEvent.click(link);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("renders a divider only between a label and trailing icon", () => {
    const { rerender } = render(
      <Button withDivider endIcon={<span data-testid="end" />}>
        Continue
      </Button>,
    );
    expect(screen.getByTestId("end").previousElementSibling).toHaveClass(
      "w-px",
    );

    rerender(<Button withDivider>Continue</Button>);
    expect(screen.queryByTestId("end")).not.toBeInTheDocument();
  });
});
