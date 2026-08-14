import { describe, expect, it } from "vitest";

import { parseSupportAlertIntervalsDraft } from "./support-period-retention-section";

describe("parseSupportAlertIntervalsDraft", () => {
  it("preserves each complete whole-number interval", () => {
    expect(parseSupportAlertIntervalsDraft("180, 90,30")).toEqual([
      180, 90, 30,
    ]);
  });

  it.each(["180, abc, 30", "180,,30", "", "30.5, 90", "-30, 90"])(
    "rejects malformed interval input %j instead of silently dropping it",
    (input) => {
      expect(parseSupportAlertIntervalsDraft(input)).toBeNull();
    },
  );
});
