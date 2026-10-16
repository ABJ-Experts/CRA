import { describe, expect, it } from "vitest";
import { licenceDate, licenceReason } from "./licensing-status";
describe("licence display", () => {
  it("labels absence without creating an invalid date", () =>
    expect(licenceDate(null)).toBe("Not available"));
  it("renders locale dates and readable machine reasons", () => {
    expect(licenceDate("2026-01-01T00:00:00Z")).toBe(
      new Date("2026-01-01T00:00:00Z").toLocaleString(),
    );
    expect(licenceReason("clock_untrusted")).toBe("clock untrusted");
  });
});
