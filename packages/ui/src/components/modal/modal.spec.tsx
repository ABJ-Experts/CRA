import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalIconButton,
  ModalRoot,
  ModalSteps,
  ModalTitle,
  ModalTrigger,
} from "./modal";

describe("Modal", () => {
  it("opens with focusable content and closes from its named control", async () => {
    render(
      <ModalRoot>
        <ModalTrigger asChild>
          <button type="button">Open profile</button>
        </ModalTrigger>
        <ModalContent size="lg">
          <ModalHeader>
            <ModalTitle>Edit profile</ModalTitle>
            <ModalDescription>Update details</ModalDescription>
          </ModalHeader>
          <ModalBody>Body</ModalBody>
          <ModalFooter left={<span>Optional</span>}>
            <button type="button">Save</button>
          </ModalFooter>
        </ModalContent>
      </ModalRoot>,
    );
    await userEvent.click(screen.getByRole("button", { name: "Open profile" }));
    expect(
      screen.getByRole("dialog", { name: "Edit profile" }),
    ).toHaveAccessibleDescription("Update details");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open profile" })).toHaveFocus();
  });

  it("renders mailbox chrome and ordered progress semantics", () => {
    render(
      <ModalRoot open>
        <ModalContent size="sm">
          <ModalHeader
            variant="mailbox"
            actions={<ModalIconButton aria-label="Minimise" />}
          >
            <ModalTitle>Compose</ModalTitle>
          </ModalHeader>
          <ModalSteps steps={["Draft", "Review", "Send"]} current={1} />
        </ModalContent>
      </ModalRoot>,
    );
    expect(screen.getByRole("heading", { name: "Compose" })).toHaveClass(
      "text-subhead-medium",
    );
    expect(screen.getByText("Review").closest("li")).toHaveAttribute(
      "aria-current",
      "step",
    );
    expect(
      screen.getByRole("button", { name: "Minimise" }),
    ).toBeInTheDocument();
  });
});
