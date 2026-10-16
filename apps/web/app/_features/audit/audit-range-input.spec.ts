import { describe, expect, it } from "vitest";
import { parseAuditRangeDraft } from "./audit-range-input";
const id = "00000000-0000-4000-8000-000000000001";
describe("range draft parsing", () => {
  it("normalizes strings and optional checkpoint", () => {
    expect(parseAuditRangeDraft(id, " 1 ", "", "")).toEqual({
      requestId: id,
      fromSequence: "1",
    });
    const checkpoint = {
      organizationId: id,
      activationAt: "2026-10-07T00:00:00Z",
      chainVersion: 1,
      sequence: "4",
      hash: "a".repeat(64),
    };
    expect(
      parseAuditRangeDraft(id, "1", "4", JSON.stringify(checkpoint))
        .priorCheckpoint,
    ).toEqual(checkpoint);
  });
  it("rejects UTF8 oversized, invalid JSON, and backwards ranges", () => {
    expect(() => parseAuditRangeDraft(id, "1", "", "é".repeat(8193))).toThrow(
      "16 KiB",
    );
    expect(() => parseAuditRangeDraft(id, "1", "", "{")).toThrow();
    expect(() => parseAuditRangeDraft(id, "4", "2", "")).toThrow();
  });
});
