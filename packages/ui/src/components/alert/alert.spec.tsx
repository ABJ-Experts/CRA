import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Alert,
  AlertAction,
  AlertActions,
  AlertCancel,
  AlertContent,
  AlertDescription,
  AlertRoot,
  AlertTitle,
} from "./alert";

describe("Alert", () => {
  it("announces content and invokes confirmation", async () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Alert
        open
        onOpenChange={onOpenChange}
        title="Delete project?"
        description="This cannot be undone."
        confirmLabel="Delete"
        onConfirm={onConfirm}
      />,
    );
    expect(screen.getByRole("alertdialog")).toHaveAccessibleName(
      "Delete project?",
    );
    expect(screen.getByRole("alertdialog")).toHaveAccessibleDescription(
      "This cannot be undone.",
    );
    await userEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("supports cancellation and loading acknowledge-only state", async () => {
    const onCancel = vi.fn();
    const { rerender } = render(
      <Alert open title="Leave?" onCancel={onCancel} />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledOnce();

    rerender(
      <Alert
        open
        title="Saving"
        showCancel={false}
        loading
        confirmLabel="Save"
      />,
    );
    expect(
      screen.queryByRole("button", { name: "Cancel" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /save loading/i }),
    ).toBeDisabled();
  });

  it("supports composed parts and custom action variants", () => {
    render(
      <AlertRoot open>
        <AlertContent className="custom-content">
          <AlertTitle>Archive?</AlertTitle>
          <AlertDescription>It can be restored.</AlertDescription>
          <AlertActions>
            <AlertCancel variant="invisible">Back</AlertCancel>
            <AlertAction variant="outline">Archive</AlertAction>
          </AlertActions>
        </AlertContent>
      </AlertRoot>,
    );
    expect(screen.getByRole("alertdialog")).toHaveClass("custom-content");
    expect(screen.getByRole("button", { name: "Back" })).toHaveClass(
      "bg-transparent",
    );
  });
});
