import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function Example({
  variant = "line",
}: {
  variant?: "line" | "fill" | "outline";
}) {
  return (
    <Tabs defaultValue="all" variant={variant} size="md">
      <TabsList aria-label="Inbox views">
        <TabsTrigger
          value="all"
          icon={<span>icon</span>}
          count={120}
          countMax={99}
        >
          All
        </TabsTrigger>
        <TabsTrigger value="mine" count="">
          Mine
        </TabsTrigger>
      </TabsList>
      <TabsContent value="all">All messages</TabsContent>
      <TabsContent value="mine">My messages</TabsContent>
    </Tabs>
  );
}

describe("Tabs", () => {
  it("exposes selection and switches panels from keyboard", async () => {
    render(<Example />);
    const all = screen.getByRole("tab", { name: /all 99\+/i });
    expect(all).toHaveAttribute("aria-selected", "true");
    all.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(screen.getByRole("tab", { name: "Mine" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByRole("tabpanel")).toHaveTextContent("My messages");
  });

  it.each(["fill", "outline"] as const)(
    "renders the %s visual family",
    (variant) => {
      render(<Example variant={variant} />);
      expect(screen.getAllByRole("tab")[0]).toHaveClass(
        variant === "fill" ? "border-r" : "rounded-lg",
      );
    },
  );

  it("disconnects measurement observers when unmounted", () => {
    const cancel = vi.spyOn(globalThis, "cancelAnimationFrame");
    const { unmount } = render(<Example />);
    unmount();
    expect(cancel).toHaveBeenCalled();
  });
});
