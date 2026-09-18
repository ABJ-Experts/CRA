import {
  PRODUCT_IMPORT_HEADERS,
  PRODUCT_IMPORT_SCHEMA_VERSION,
  csvReport,
  isWithinSynchronousImportThreshold,
  parseProductImportCsv,
  safeCsvCell,
  type PlannedImportRow,
} from "./product-release-import-format";

const header = PRODUCT_IMPORT_HEADERS.join(",");

function productRow(overrides: readonly string[] = []): string {
  const values = [
    PRODUCT_IMPORT_SCHEMA_VERSION,
    "product",
    "create",
    "GW-100",
    "Sentinel Gateway",
    "hardware_with_software",
    "Gateway product",
    "owner@cra.test",
    "abj-eu",
    "",
    "",
    "",
    "",
  ];
  overrides.forEach((value, index) => {
    values[index] = value;
  });
  return values.join(",");
}

describe("product import CSV format", () => {
  it("accepts UTF-8 BOM, CRLF, quoted commas, newlines and escaped quotes", async () => {
    const source = `\ufeff${header}\r\n${productRow().replace(
      "Gateway product",
      '"Gateway, ""rugged""\r\nmodel"',
    )}\r\n`;

    const result = await parseProductImportCsv(Buffer.from(source));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]?.sourceRowNumber).toBe(2);
    expect(result.rows[0]?.values.product_description).toBe(
      'Gateway, "rugged"\r\nmodel',
    );
  });

  it.each([
    ["invalid UTF-8", Buffer.from([0xff, 0xfe]), "invalid_utf8"],
    [
      "a null byte",
      Buffer.from(`${header}\n${productRow()}\u0000`),
      "null_byte",
    ],
    ["gzip", Buffer.from([0x1f, 0x8b, 0x00]), "compressed_input"],
    [
      "a malformed quote",
      Buffer.from(`${header}\n${productRow()}"`),
      "malformed_csv",
    ],
  ])("rejects %s safely", async (_label, bytes: Buffer, code) => {
    const result = await parseProductImportCsv(bytes);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe(code);
  });

  it("rejects unknown, duplicate, and visually ambiguous headers", async () => {
    const unknown = await parseProductImportCsv(
      Buffer.from(`${header},surprise\n${productRow()},value`),
    );
    const duplicate = await parseProductImportCsv(
      Buffer.from(
        `${header.replace("record_type", "format_version")}\n${productRow()}`,
      ),
    );
    const ambiguous = await parseProductImportCsv(
      Buffer.from(
        `${header.replace("format_version", "ｆｏｒｍａｔ＿ｖｅｒｓｉｏｎ")}\n${productRow()}`,
      ),
    );

    expect(!unknown.ok && unknown.issues[0]?.code).toBe("unknown_column");
    expect(!duplicate.ok && duplicate.issues[0]?.code).toBe("duplicate_header");
    expect(!ambiguous.ok && ambiguous.issues[0]?.code).toBe("ambiguous_header");
  });

  it("counts blank physical records toward the hostile-input limit", async () => {
    const source = `${header}\n${"\n".repeat(10_001)}`;
    const result = await parseProductImportCsv(Buffer.from(source));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]?.code).toBe("too_many_rows");
  });

  it("does not count embedded quoted newlines as separate CSV records", () => {
    const rows = `${header}\n${productRow().replace(
      "Gateway product",
      '"line one\nline two"',
    )}\n`;

    expect(isWithinSynchronousImportThreshold(Buffer.from(rows), 1)).toBe(true);
    expect(
      isWithinSynchronousImportThreshold(
        Buffer.from(`${rows}${productRow()}\n`),
        1,
      ),
    ).toBe(false);
  });

  it("neutralizes formula-prefixed report cells including leading spaces", () => {
    expect(safeCsvCell(" =cmd|' /C calc'!A0")).toBe("\"' =cmd|' /C calc'!A0\"");
    const row: PlannedImportRow = {
      sourceRowNumber: 2,
      recordType: "product",
      proposedAction: "create",
      result: "failed",
      productInternalCodeNormalized: "=formula",
      releaseVersionNormalized: null,
      productId: null,
      releaseId: null,
      expectedProductVersion: null,
      expectedReleaseVersion: null,
      proposed: {},
      issues: [
        {
          field: "product_internal_code",
          code: "invalid_value",
          message: "Use a supported product code.",
          severity: "error",
        },
      ],
    };

    expect(csvReport([row])).toContain("'=formula");
    expect(csvReport([row])).not.toContain("owner@cra.test");
  });
});
