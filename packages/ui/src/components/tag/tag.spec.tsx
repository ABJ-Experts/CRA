import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Tag } from "./tag";

describe("Tag", () => {
  it.each([
    ["cool", "md", "bg-surface"],
    ["fill", "sm", "bg-origin-green-300"],
    ["dot", "md", "text-fg-subtle"],
  ] as const)("renders the %s variant", (variant, size, expectedClass) => {
    const { container } = render(
      <Tag variant={variant} size={size} tone="green" icon={<span>icon</span>}>
        Shipped
      </Tag>,
    );
    expect(container.firstElementChild).toHaveClass(expectedClass);
    if (variant === "dot")
      expect(screen.queryByText("icon")).not.toBeInTheDocument();
    else expect(screen.getByText("icon")).toBeInTheDocument();
  });

  it("uses the blue palette for an unspecified dot tone", () => {
    const { container } = render(<Tag variant="dot">Queued</Tag>);
    expect(container.querySelector('[aria-hidden="true"]')).toHaveClass(
      "bg-cyan-blue-500",
    );
  });
});
