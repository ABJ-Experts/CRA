import { describe, expect, it } from "vitest";
import { readTechnicalFileSectionLink } from "./technical-file-deep-link";
describe("technical-file gap deep link", () => {
  it("accepts one known section and rejects forged or duplicate values", () => {
    expect(
      readTechnicalFileSectionLink(
        new URLSearchParams("section=general_description"),
      ),
    ).toBe("general_description");
    for (const value of [
      "",
      "section=invalid",
      "section=general_description&section=test_reports",
    ])
      expect(
        readTechnicalFileSectionLink(new URLSearchParams(value)),
      ).toBeNull();
  });
});
