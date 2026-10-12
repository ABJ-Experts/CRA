import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { once } from "node:events";
import { finished } from "node:stream/promises";
import ExcelJS from "exceljs";
import { encodeAuditCsvCell } from "../../audit/worker/audit-export-serialization";

export type { ExportColumn } from "@repo/contracts/exports";
import type { ExportColumn } from "@repo/contracts/exports";
export type FrozenRow = Readonly<{
  ordinal: number;
  values: Readonly<Record<string, unknown>>;
}>;
export type RenderedPart = Readonly<{
  path: string;
  name: string;
  bytes: number;
  sha256: string;
  rowCount: number;
}>;
const maximumBytes = 64 * 1024 * 1024;

export function toTypedCell(
  value: unknown,
  type: ExportColumn["type"],
): string | number | boolean | Date | null {
  if (value === undefined || value === null) return null;
  const text = frozenCellText(value);
  if (text.length > 32767) throw new Error("xlsx_cell_limit_use_csv");
  if (type === "date" || type === "datetime") {
    const date = new Date(type === "date" ? `${text}T00:00:00Z` : text);
    if (
      !Number.isFinite(date.getTime()) ||
      (type === "date" && date.toISOString().slice(0, 10) !== text)
    )
      throw new Error("invalid_frozen_cell");
    return date;
  }
  if (type === "boolean") {
    if (typeof value !== "boolean") throw new Error("invalid_frozen_cell");
    return value;
  }
  if (type === "number") {
    if (
      typeof value === "number" &&
      Number.isFinite(value) &&
      (!Number.isInteger(value) || Number.isSafeInteger(value))
    )
      return value;
    // Keep database numeric text exact; coercion can change precision or scale.
    return text;
  }
  return text;
}

function frozenCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") return JSON.stringify(value);
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  )
    return String(value);
  throw new Error("invalid_frozen_cell");
}

export async function renderExportPart(
  input: Readonly<{
    directory: string;
    name: string;
    format: "csv" | "xlsx";
    columns: readonly ExportColumn[];
    rows: AsyncIterable<FrozenRow> | readonly FrozenRow[];
    onRow?: () => Promise<void>;
  }>,
): Promise<RenderedPart> {
  if (!/^[a-zA-Z0-9_-]+\.(csv|xlsx)$/.test(input.name))
    throw new Error("invalid_part_name");
  if (input.columns.length === 0 || input.columns.length > 256)
    throw new Error("export_limit");
  const path = join(input.directory, input.name);
  let rowCount = 0;
  const count = async () => {
    rowCount += 1;
    if (rowCount > 25000) throw new Error("export_limit");
    await input.onRow?.();
  };
  if (input.format === "csv") {
    const output = createWriteStream(path, { mode: 0o600, flags: "wx" });
    const completion = finished(output);
    // Attach immediately so a disk failure is never an unhandled rejection.
    void completion.catch(() => undefined);
    let bytes = 0;
    const write = async (line: string) => {
      bytes += Buffer.byteLength(line);
      if (bytes > maximumBytes) throw new Error("artifact_limit");
      if (!output.write(line)) await once(output, "drain");
    };
    try {
      await write(
        input.columns
          .map((column) => encodeAuditCsvCell(column.label))
          .join(",") + "\r\n",
      );
      for await (const row of input.rows) {
        await count();
        await write(
          input.columns
            .map((column) => {
              const value = row.values[column.key];
              return encodeAuditCsvCell(frozenCellText(value));
            })
            .join(",") + "\r\n",
        );
      }
      output.end();
      await completion;
    } catch (error) {
      output.destroy();
      await completion.catch(() => undefined);
      throw error;
    }
  } else {
    const output = createWriteStream(path, { mode: 0o600, flags: "wx" });
    const completion = finished(output);
    void completion.catch(() => undefined);
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      stream: output,
      useSharedStrings: false,
      useStyles: true,
    });
    const sheet = workbook.addWorksheet("Filtered results");
    sheet.columns = input.columns.map((column) => ({
      header: column.label,
      key: column.key,
      width: 24,
      style:
        column.type === "date"
          ? { numFmt: "yyyy-mm-dd" }
          : column.type === "datetime"
            ? { numFmt: 'yyyy-mm-dd"T"hh:mm:ss"Z"' }
            : {},
    }));
    sheet.getRow(1).commit();
    try {
      for await (const row of input.rows) {
        await count();
        sheet
          .addRow(
            input.columns.map((column) =>
              toTypedCell(row.values[column.key], column.type),
            ),
          )
          .commit();
        if (output.bytesWritten > maximumBytes)
          throw new Error("artifact_limit");
      }
      sheet.commit();
      await workbook.commit();
      await completion;
    } catch (error) {
      output.destroy();
      await completion.catch(() => undefined);
      throw error;
    }
  }
  const bytes = (await stat(path)).size;
  if (bytes > maximumBytes) throw new Error("artifact_limit");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path))
    hash.update(chunk as Buffer);
  return Object.freeze({
    path,
    name: input.name,
    bytes,
    sha256: hash.digest("hex"),
    rowCount,
  });
}
