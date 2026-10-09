import { describe, expect, it } from "vitest";
import { readDashboardTriageLink } from "./dashboard-triage-deep-link";
describe("dashboard triage deep link", () => {
  it("parses only strict UUID severity and boolean inputs", () => {
    expect(
      readDashboardTriageLink(
        new URLSearchParams(
          "productId=11111111-1111-4111-8111-111111111111&severity=high&openOnly=true",
        ),
      ),
    ).toEqual({
      productIds: ["11111111-1111-4111-8111-111111111111"],
      severities: ["high"],
      openOnly: true,
    });
    expect(readDashboardTriageLink(new URLSearchParams())).toBeNull();
    for (const value of [
      "productId=foreign",
      "severity=high&severity=low",
      "severity=nope",
      "openOnly=1",
      "openOnly=true&openOnly=false",
    ])
      expect(readDashboardTriageLink(new URLSearchParams(value))).toBeNull();
    expect(
      readDashboardTriageLink(new URLSearchParams("openOnly=false")),
    ).toEqual({ openOnly: false });
  });
});
