import { describe, expect, it } from "vitest";

import {
  utcDateTimeInputValue,
  utcInstantFromDateTimeInput,
} from "./utc-date-time";

describe("UTC date-time form values", () => {
  it.each([
    ["2026-09-28T10:30", "2026-09-28T10:30:00.000Z"],
    ["2026-09-28T10:30:15", "2026-09-28T10:30:15.000Z"],
    ["2024-02-29T10:30:15.123", "2024-02-29T10:30:15.123Z"],
    ["2026-03-29T02:30", "2026-03-29T02:30:00.000Z"],
    ["2026-10-25T02:30", "2026-10-25T02:30:00.000Z"],
  ])(
    "interprets %s as UTC independently of local daylight saving",
    (input, expected) => {
      expect(utcInstantFromDateTimeInput(input)).toBe(expected);
    },
  );

  it.each([
    "",
    "2026-02-30T10:30",
    "2025-02-29T10:30",
    "2026-09-28T24:00",
    "bad",
    "2026-09-28T10:30+02:00",
    "2026-09-28T10:30Z",
  ])(
    "keeps invalid or empty input %s for request validation without date rollover",
    (input) => expect(utcInstantFromDateTimeInput(input)).toBe(input),
  );

  it("preserves existing timestamp precision while removing only the UTC marker", () => {
    expect(utcDateTimeInputValue("2026-09-28T10:30:15.123Z")).toBe(
      "2026-09-28T10:30:15.123",
    );
    expect(utcDateTimeInputValue("2026-09-28T10:30:15Z")).toBe(
      "2026-09-28T10:30:15",
    );
  });

  it.each(["", "invalid", "2026-02-30T10:30:00Z", "2026-09-28T10:30:00+02:00"])(
    "does not render an invalid or non-UTC instant %s",
    (instant) => expect(utcDateTimeInputValue(instant)).toBe(""),
  );
});
