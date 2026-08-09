import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Avatar, AvatarGroup, initialsFrom } from "./avatar";

describe("Avatar", () => {
  it.each([
    ["Ada Lovelace", "AL"],
    ["prince", "PR"],
    ["  ", ""],
    ["Grace Brewster Murray Hopper", "GH"],
  ])("derives initials for %j", (name, expected) => {
    expect(initialsFrom(name)).toBe(expected);
  });

  it("renders initials and an accessible presence state", async () => {
    render(
      <Avatar
        name="Ada Lovelace"
        status="online"
        size="md"
        ring
        data-testid="avatar"
      />,
    );
    expect(await screen.findByText("AL")).toBeInTheDocument();
    expect(
      screen.getByRole("img", { name: "Ada Lovelace: online" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("avatar")).toHaveClass("outline-brink-red-500");
  });

  it("renders verified and custom fallback states", async () => {
    const { rerender } = render(<Avatar name="Verified User" verified />);
    expect(screen.getByRole("img", { name: "Verified" })).toBeInTheDocument();
    rerender(<Avatar fallback={<span>No photo</span>} />);
    expect(await screen.findByText("No photo")).toBeInTheDocument();
  });

  it("clusters at most three decorative images", () => {
    const { container } = render(<Avatar images={["/a", "/b", "/c", "/d"]} />);
    expect(container.querySelectorAll("[style]")).toHaveLength(3);
  });

  it("limits groups and exposes an overflow count", async () => {
    render(
      <AvatarGroup max={2} total={12} size="lg">
        <Avatar name="One" />
        <Avatar name="Two" />
        <Avatar name="Three" />
      </AvatarGroup>,
    );
    expect(await screen.findByText("ON")).toBeInTheDocument();
    expect(screen.queryByText("TH")).not.toBeInTheDocument();
    expect(screen.getByRole("img", { name: "10 more" })).toHaveTextContent(
      "9+",
    );
  });
});
