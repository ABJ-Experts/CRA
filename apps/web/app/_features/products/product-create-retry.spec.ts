import { describe, expect, it, vi } from "vitest";
import { resolveProductCreateAttempt } from "./product-create-retry";
describe("product create retry command", () => {
  it("creates a UUID for the first parsed command", () => {
    expect(
      resolveProductCreateAttempt(null, "product", { name: "Sentinel" }).key,
    ).toMatch(/^[0-9a-f]{8}-[0-9a-f-]{27}$/);
  });
  it("preserves a command for the same parsed scope and payload", () => {
    const key = vi.fn(() => "first");
    const first = resolveProductCreateAttempt(
      null,
      "product",
      { name: "Sentinel" },
      key,
    );
    expect(
      resolveProductCreateAttempt(first, "product", { name: "Sentinel" }, key),
    ).toBe(first);
    expect(key).toHaveBeenCalledOnce();
  });
  it("rotates for changed payload or product scope and after successful clearing", () => {
    let counter = 0;
    const key = () => String(++counter);
    const first = resolveProductCreateAttempt(
      null,
      "release:a",
      { label: "stable" },
      key,
    );
    expect(
      resolveProductCreateAttempt(first, "release:a", { label: "next" }, key)
        .key,
    ).not.toBe(first.key);
    expect(
      resolveProductCreateAttempt(first, "release:b", { label: "stable" }, key)
        .key,
    ).not.toBe(first.key);
    expect(
      resolveProductCreateAttempt(null, "release:a", { label: "stable" }, key)
        .key,
    ).not.toBe(first.key);
    expect(first.key).toBe("1");
  });
});
