import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "csv-parse/sync";
import ExcelJS from "exceljs";
import { renderExportPart, toTypedCell } from "./export-renderer";

describe("frozen export rendering", () => {
  it("preserves quoted Unicode while neutralizing formulas", async () => {
    const directory = await mkdtemp(join(tmpdir(), "export-test-"));
    try {
      const file = await renderExportPart({
        directory,
        format: "csv",
        name: "part.csv",
        columns: [{ key: "text", label: "Text", type: "text" }],
        rows: [{ ordinal: 1, values: { text: '\uFEFF =SUM(1),"é"\nΩ' } }],
      });
      expect(
        parse<{ Text: string }>(await readFile(file.path), { columns: true })[0]
          ?.Text,
      ).toBe('\'\uFEFF =SUM(1),"é"\nΩ');
      expect(file.bytes).toBeGreaterThan(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("writes explicit strings, booleans and UTC dates readable independently", async () => {
    const directory = await mkdtemp(join(tmpdir(), "export-test-"));
    try {
      const file = await renderExportPart({
        directory,
        format: "xlsx",
        name: "part.xlsx",
        columns: [
          { key: "text", label: "Text", type: "text" },
          { key: "ok", label: "OK", type: "boolean" },
          { key: "date", label: "Date", type: "date" },
        ],
        rows: [
          {
            ordinal: 1,
            values: {
              text: '=HYPERLINK("evil")',
              ok: true,
              date: "2026-10-09",
            },
          },
        ],
      });
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.readFile(file.path);
      const row = workbook.worksheets[0]!.getRow(2);
      expect(row.getCell(1).value).toBe('=HYPERLINK("evil")');
      expect(row.getCell(2).value).toBe(true);
      expect(row.getCell(3).value).toEqual(new Date("2026-10-09T00:00:00Z"));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  it("rejects overflow and imprecise numeric cells rather than losing data", () => {
    expect(() => toTypedCell("x".repeat(32768), "text")).toThrow(
      "xlsx_cell_limit_use_csv",
    );
    expect(toTypedCell("9007199254740993", "number")).toBe("9007199254740993");
    expect(toTypedCell(false, "boolean")).toBe(false);
    expect(toTypedCell(null, "text")).toBeNull();
    expect(() => toTypedCell("not-a-date", "date")).toThrow(
      "invalid_frozen_cell",
    );
  });
});

describe("render limits and empty datasets", () => {
  it.each(["../escape.csv", "bad.txt"])(
    "rejects unsafe name %s",
    async (name) => {
      await expect(
        renderExportPart({
          directory: tmpdir(),
          name,
          format: "csv",
          columns: [],
          rows: [],
        }),
      ).rejects.toThrow("invalid_part_name");
    },
  );
  it("rejects absent columns", async () => {
    await expect(
      renderExportPart({
        directory: tmpdir(),
        name: "part.csv",
        format: "csv",
        columns: [],
        rows: [],
      }),
    ).rejects.toThrow("export_limit");
  });
  it("preserves safe numeric/boolean/object values and invalid date states", () => {
    expect(toTypedCell(1.5, "number")).toBe(1.5);
    expect(toTypedCell(1, "number")).toBe(1);
    expect(toTypedCell(Number.NaN, "number")).toBe("NaN");
    expect(toTypedCell({ note: "é" }, "text")).toBe('{"note":"é"}');
    expect(toTypedCell(undefined, "text")).toBeNull();
    expect(toTypedCell("2026-10-09T12:34:56Z", "datetime")).toEqual(
      new Date("2026-10-09T12:34:56Z"),
    );
    expect(() => toTypedCell("2026-02-30", "date")).toThrow(
      "invalid_frozen_cell",
    );
    expect(() => toTypedCell("true", "boolean")).toThrow("invalid_frozen_cell");
  });
  it.each(["csv", "xlsx"] as const)(
    "writes headers for empty %s",
    async (format) => {
      const directory = await mkdtemp(join(tmpdir(), "empty-export-"));
      try {
        const part = await renderExportPart({
          directory,
          name: `empty.${format}`,
          format,
          columns: [{ key: "value", label: "Value", type: "text" }],
          rows: [],
        });
        expect(part.rowCount).toBe(0);
        expect(part.sha256).toMatch(/^[0-9a-f]{64}$/);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
  );
  it("cleans stream failures and rejects oversized XLSX text", async () => {
    const directory = await mkdtemp(join(tmpdir(), "bad-export-"));
    try {
      await expect(
        renderExportPart({
          directory,
          name: "bad.xlsx",
          format: "xlsx",
          columns: [{ key: "value", label: "Value", type: "datetime" }],
          rows: [{ ordinal: 1, values: { value: "invalid" } }],
        }),
      ).rejects.toThrow("invalid_frozen_cell");
      await expect(
        renderExportPart({
          directory,
          name: "bad.csv",
          format: "csv",
          columns: [{ key: "value", label: "Value", type: "text" }],
          rows: [
            { ordinal: 1, values: { value: null } },
            { ordinal: 2, values: { value: { x: true } } },
          ],
          onRow: () => Promise.reject(new Error("access_changed")),
        }),
      ).rejects.toThrow("access_changed");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

it("rejects runtime cells outside the frozen scalar/object boundary", () => {
  expect(() => toTypedCell(() => "hidden", "text")).toThrow(
    "invalid_frozen_cell",
  );
  expect(toTypedCell(12n, "text")).toBe("12");
});
