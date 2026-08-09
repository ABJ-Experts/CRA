import { describe, expect, it } from "vitest";

import { cn } from "./cn";

describe("cn", () => {
  it("keeps semantic typography and colour classes together", () => {
    expect(cn("text-h3", "text-fg")).toBe("text-h3 text-fg");
  });

  it("lets later semantic font sizes and gradients win", () => {
    expect(cn("text-h3 bg-grad-caramel", "text-h5 bg-grad-yellow")).toBe(
      "text-h5 bg-grad-yellow",
    );
  });

  it("handles conditional class values", () => {
    expect(cn("rounded-r12", false, null, { "bg-canvas": true })).toBe(
      "rounded-r12 bg-canvas",
    );
  });
});
