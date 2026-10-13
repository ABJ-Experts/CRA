import { describe, expect, it } from "vitest";
import { encodeUsageCsvCell, serializeUsageExport } from "./usage-export";
import { usageReceipt } from "./test/usage-fixtures";

describe("audited usage serialization", () => {
  it("preserves the immutable audited snapshot, exact integers, UTC and safe filename", () => {
    const receipt = usageReceipt();
    const original = structuredClone(receipt);
    const json = serializeUsageExport(receipt, "json");
    expect(JSON.parse(json.content)).toEqual(receipt);
    expect(json.filename).toBe("licence-usage-2026-10-13T00-00-00-000Z.json");
    expect(json.mediaType).toBe("application/json");
    const csv = serializeUsageExport(receipt, "csv");
    expect(csv.content).toContain('"m15_02_v1"');
    expect(csv.content).toContain('"current_state"');
    expect(csv.content).toContain('"source_changes_only"');
    expect(csv.content).toContain('"2026-10-13T00:00:00.000Z"');
    expect(csv.content).toContain('"protected_storage"');
    expect(csv.content).toContain('"exempt"');
    expect(csv.content).toContain(receipt.auditEventId);
    expect(receipt).toEqual(original);
  });
  it("exports exact large bytes and unavailable null without fabricating zero", () => {
    const receipt = usageReceipt();
    receipt.snapshot.counters[2] = {
      ...receipt.snapshot.counters[2]!,
      value: Number.MAX_SAFE_INTEGER,
      components: [
        { key: "storageBytes", value: Number.MAX_SAFE_INTEGER },
        { key: "storageReservedBytes", value: 0 },
      ],
      limit: { kind: "unlimited", value: null },
    };
    receipt.snapshot.counters[0] = {
      ...receipt.snapshot.counters[0]!,
      value: null,
      availability: "unavailable",
      state: "unavailable",
      components: [
        { key: "activeMembers", value: null },
        { key: "reservedInvitations", value: 0 },
      ],
      reasons: ["meter_unavailable"],
    };
    expect(serializeUsageExport(receipt, "csv").content).toContain(
      '"9007199254740991"',
    );
    expect(serializeUsageExport(receipt, "csv").content).toContain('"null"');
    expect(serializeUsageExport(receipt, "csv").content).toContain(
      '"meter_unavailable"',
    );
  });
  it("parses the final receipt and rejects private fields", () => {
    expect(() =>
      serializeUsageExport({ ...usageReceipt(), artifact: "secret" }, "json"),
    ).toThrow();
  });
  it.each(["=cmd", " +cmd", "\uFEFF@cmd", "\t-cmd", "\u0001=cmd"])(
    "neutralizes spreadsheet formulas %j",
    (cell) => {
      expect(encodeUsageCsvCell(cell)).toBe(`"'${cell}"`);
    },
  );
  it("escapes quotes, commas and newlines", () => {
    expect(encodeUsageCsvCell('one,"two"\nthree')).toBe('"one,""two""\nthree"');
  });
});
