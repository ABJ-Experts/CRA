import { parseSpdxTagValue } from "./spdx-tag-value-parser";

describe("parseSpdxTagValue", () => {
  it("parses repeated package blocks without mutating previous fields", () => {
    const parsed = parseSpdxTagValue(
      [
        "SPDXVersion: SPDX-2.3",
        "DataLicense: CC0-1.0",
        "SPDXID: SPDXRef-DOCUMENT",
        "DocumentName: Example",
        "DocumentNamespace: https://example.test/spdx",
        "Creator: Tool: CRA",
        "Created: 2026-08-21T00:00:00Z",
        "PackageName: first",
        "SPDXID: SPDXRef-Package-1",
        "PackageDownloadLocation: NOASSERTION",
        "FilesAnalyzed: false",
        "PackageName: second",
        "SPDXID: SPDXRef-Package-2",
        "PackageDownloadLocation: NOASSERTION",
        "FilesAnalyzed: false",
      ].join("\n"),
    );

    expect(parsed.document).toMatchObject({
      spdxVersion: "SPDX-2.3",
      SPDXID: "SPDXRef-DOCUMENT",
      documentNamespace: "https://example.test/spdx",
    });
    expect(parsed.packages).toEqual([
      expect.objectContaining({ name: "first", SPDXID: "SPDXRef-Package-1" }),
      expect.objectContaining({ name: "second", SPDXID: "SPDXRef-Package-2" }),
    ]);
  });

  it("returns deterministic diagnostics for malformed tag-value lines", () => {
    const parsed = parseSpdxTagValue(
      ["SPDXVersion SPDX-2.3", "SPDXID: SPDXRef-DOCUMENT"].join("\n"),
    );

    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({
        code: "malformed_tag_value_line",
        location: "line:1",
      }),
    ]);
  });

  it("reports duplicate mapped tags without overwriting the first value", () => {
    const parsed = parseSpdxTagValue(
      [
        "SPDXVersion: SPDX-2.3",
        "SPDXID: SPDXRef-DOCUMENT",
        "SPDXID: SPDXRef-DOCUMENT-OTHER",
        "PackageName: package",
        "SPDXID: SPDXRef-Package",
        "SPDXID: SPDXRef-Package",
      ].join("\n"),
    );

    expect(parsed.document.SPDXID).toBe("SPDXRef-DOCUMENT");
    expect(parsed.packages[0]).toMatchObject({
      SPDXID: "SPDXRef-Package",
    });
    expect(parsed.diagnostics).toEqual([
      expect.objectContaining({
        code: "duplicate_spdx_tag",
        location: "line:3",
      }),
      expect.objectContaining({
        code: "duplicate_spdx_id",
        location: "line:3",
      }),
      expect.objectContaining({
        code: "duplicate_spdx_tag",
        location: "line:6",
      }),
      expect.objectContaining({
        code: "duplicate_spdx_id",
        location: "line:6",
      }),
    ]);
  });

  it("bounds repeated malformed-line diagnostics while preserving the omission count", () => {
    const parsed = parseSpdxTagValue(
      Array.from({ length: 20 }, () => "not-a-tag-value-line").join("\n"),
      2,
    );

    expect(parsed.diagnostics).toHaveLength(2);
    expect(parsed.omittedDiagnosticCount).toBe(18);
  });
});
