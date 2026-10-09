import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { TextDecoder } from "node:util";
import {
  productImportMaxBytes,
  productImportMaxRows,
  type ProductType,
} from "@repo/contracts/products";
import { parse } from "csv-parse";

export const PRODUCT_IMPORT_SCHEMA_VERSION =
  "m2-product-release-import-v1" as const;

export const PRODUCT_IMPORT_HEADERS = Object.freeze([
  "format_version",
  "record_type",
  "operation",
  "product_internal_code",
  "product_name",
  "product_type",
  "product_description",
  "owner_email",
  "legal_entity_identifier",
  "release_version",
  "release_label",
  "release_description",
  "expected_version",
] as const);

export type ProductImportHeader = (typeof PRODUCT_IMPORT_HEADERS)[number];

export const PRODUCT_IMPORT_TEMPLATE = [
  PRODUCT_IMPORT_HEADERS.join(","),
  [
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
  ].join(","),
  [
    PRODUCT_IMPORT_SCHEMA_VERSION,
    "release",
    "create",
    "GW-100",
    "",
    "",
    "",
    "",
    "",
    "1.0.0",
    "Initial release",
    "First commercial release",
    "",
  ].join(","),
  "",
].join("\n");

export type ParsedImportRow = Readonly<{
  sourceRowNumber: number;
  values: Readonly<Record<ProductImportHeader, string>>;
}>;

export type ImportFieldIssue = Readonly<{
  field: string;
  code: string;
  message: string;
  severity: "warning" | "error";
}>;

export type ParsedImportFile =
  | Readonly<{
      ok: true;
      rows: readonly ParsedImportRow[];
      contentHash: string;
      byteSize: number;
    }>
  | Readonly<{
      ok: false;
      contentHash: string;
      byteSize: number;
      issues: readonly ImportFieldIssue[];
    }>;

export type PlannedImportRow = Readonly<{
  sourceRowNumber: number;
  recordType: "product" | "release" | null;
  proposedAction: "create" | "update" | "unchanged" | "skipped" | "failed";
  result: "planned" | "committed" | "failed" | "skipped";
  productInternalCodeNormalized: string | null;
  releaseVersionNormalized: string | null;
  productId: string | null;
  releaseId: string | null;
  expectedProductVersion: number | null;
  expectedReleaseVersion: number | null;
  proposed: Readonly<Record<string, string | number | null>>;
  issues: readonly ImportFieldIssue[];
}>;

export type ImportCounts = Readonly<{
  create: number;
  update: number;
  unchanged: number;
  skipped: number;
  failed: number;
  warnings: number;
}>;

export const PRODUCT_TYPES = new Set<ProductType>([
  "hardware_with_software",
  "standalone_software",
  "component",
  "remote_data_processing",
]);

const maximumRecordBytes = 16_384;

export function sha256Hex(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Mirrors the database identity normalization used for exact tenant lookups. */
export function normalizeIdentity(value: string): string {
  return value.normalize("NFKC").replace(/\s+/gu, "").toLowerCase();
}

/**
 * Cheap RFC-4180 record pre-scan used only to choose sync versus durable work.
 * The authoritative parser still validates every byte. Quotes are ASCII, so
 * scanning the bounded source bytes does not require decoding untrusted UTF-8.
 */
export function isWithinSynchronousImportThreshold(
  bytes: Buffer,
  maximumDataRows: number,
): boolean {
  let quoted = false;
  let records = 0;
  for (let index = 0; index < bytes.length; index += 1) {
    const value = bytes[index];
    if (value === 0x22) {
      if (quoted && bytes[index + 1] === 0x22) {
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (value === 0x0a && !quoted) {
      records += 1;
      if (records > maximumDataRows + 1) return false;
    }
  }
  if (bytes.length > 0 && bytes[bytes.length - 1] !== 0x0a) records += 1;
  return records <= maximumDataRows + 1;
}

/**
 * Parses through csv-parse's streaming iterator. The HTTP boundary caps the
 * source at 10 MiB; the parser also bounds each record and stops after the V1
 * record limit, so hostile blank-row input cannot grow memory without bound.
 */
export async function parseProductImportCsv(
  bytes: Buffer,
): Promise<ParsedImportFile> {
  const contentHash = sha256Hex(bytes);
  const byteSize = bytes.byteLength;
  if (byteSize === 0) {
    return failed(
      contentHash,
      byteSize,
      "file",
      "empty_file",
      "The CSV file is empty.",
    );
  }
  if (byteSize > productImportMaxBytes) {
    return failed(
      contentHash,
      byteSize,
      "file",
      "file_too_large",
      "The CSV file is larger than the allowed limit.",
    );
  }
  if (isCompressed(bytes)) {
    return failed(
      contentHash,
      byteSize,
      "file",
      "compressed_input",
      "Compressed files are not supported.",
    );
  }

  try {
    validateUtf8(bytes);
  } catch {
    return failed(
      contentHash,
      byteSize,
      "file",
      "invalid_utf8",
      "The CSV file must be valid UTF-8.",
    );
  }
  if (bytes.includes(0)) {
    return failed(
      contentHash,
      byteSize,
      "file",
      "null_byte",
      "The CSV file contains an unsupported null byte.",
    );
  }

  try {
    const parser = Readable.from(decodeChunks(bytes)).pipe(
      parse({
        bom: true,
        delimiter: ",",
        encoding: "utf8",
        escape: '"',
        max_record_size: maximumRecordBytes,
        quote: '"',
        relax_column_count: true,
        relax_quotes: false,
        skip_empty_lines: false,
      }),
    );
    let headers: readonly string[] | null = null;
    let headerIndex: ReadonlyMap<ProductImportHeader, number> | null = null;
    let recordNumber = 0;
    const rows: ParsedImportRow[] = [];

    for await (const value of parser) {
      recordNumber += 1;
      if (recordNumber > productImportMaxRows + 1) {
        return failed(
          contentHash,
          byteSize,
          "file",
          "too_many_rows",
          "The CSV file contains more rows than the V1 limit.",
        );
      }
      const record = asStringRecord(value);
      if (headers === null) {
        headers = record;
        const validation = validateHeaders(record);
        if (!validation.ok) {
          return Object.freeze({
            ok: false,
            contentHash,
            byteSize,
            issues: validation.issues,
          });
        }
        headerIndex = validation.index;
        continue;
      }
      if (record.every((cell) => cell.trim() === "")) continue;
      if (record.length !== headers.length) {
        return failed(
          contentHash,
          byteSize,
          "file",
          "invalid_column_count",
          "A CSV row does not contain the same number of columns as the header.",
        );
      }
      const index = headerIndex;
      if (!index) throw new Error("validated CSV header index missing");
      const values = Object.fromEntries(
        PRODUCT_IMPORT_HEADERS.map((header) => [
          header,
          (record[index.get(header) ?? -1] ?? "").trim(),
        ]),
      ) as Record<ProductImportHeader, string>;
      rows.push(
        Object.freeze({
          sourceRowNumber: recordNumber,
          values: Object.freeze(values),
        }),
      );
    }

    if (headers === null) {
      return failed(
        contentHash,
        byteSize,
        "file",
        "missing_header",
        "The CSV file must include a header row.",
      );
    }
    if (rows.length === 0) {
      return failed(
        contentHash,
        byteSize,
        "file",
        "no_data_rows",
        "The CSV file contains no import rows.",
      );
    }
    return Object.freeze({
      ok: true,
      rows: Object.freeze(rows),
      contentHash,
      byteSize,
    });
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      error.code === "CSV_MAX_RECORD_SIZE"
    ) {
      return failed(
        contentHash,
        byteSize,
        "file",
        "row_too_large",
        "A CSV row is larger than the V1 limit.",
      );
    }
    return failed(
      contentHash,
      byteSize,
      "file",
      "malformed_csv",
      "The CSV file is malformed.",
    );
  }
}

export function countRows(rows: readonly PlannedImportRow[]): ImportCounts {
  return rows.reduce(
    (counts, row) => ({
      create:
        counts.create +
        (row.proposedAction === "create" && row.result !== "failed" ? 1 : 0),
      update:
        counts.update +
        (row.proposedAction === "update" && row.result !== "failed" ? 1 : 0),
      unchanged:
        counts.unchanged +
        (row.proposedAction === "unchanged" && row.result !== "failed" ? 1 : 0),
      skipped:
        counts.skipped +
        (row.proposedAction === "skipped" || row.result === "skipped" ? 1 : 0),
      failed: counts.failed + (row.result === "failed" ? 1 : 0),
      warnings:
        counts.warnings +
        row.issues.filter((issueValue) => issueValue.severity === "warning")
          .length,
    }),
    {
      create: 0,
      update: 0,
      unchanged: 0,
      skipped: 0,
      failed: 0,
      warnings: 0,
    },
  );
}

export function csvReport(rows: readonly PlannedImportRow[]): string {
  const output: string[][] = [
    [
      "source_row_number",
      "record_type",
      "proposed_action",
      "result",
      "product_internal_code",
      "release_version",
      "field",
      "error_code",
      "message",
    ],
  ];
  for (const row of rows) {
    const issues =
      row.issues.length > 0
        ? row.issues
        : [
            Object.freeze({
              field: "",
              code: "",
              message: "",
              severity: "warning" as const,
            }),
          ];
    for (const issue of issues) {
      output.push([
        String(row.sourceRowNumber),
        row.recordType ?? "",
        row.proposedAction,
        row.result,
        row.productInternalCodeNormalized ?? "",
        row.releaseVersionNormalized ?? "",
        issue.field,
        issue.code,
        issue.message,
      ]);
    }
  }
  return `${output.map((row) => row.map(safeCsvCell).join(",")).join("\n")}\n`;
}

export function safeCsvCell(value: string): string {
  const neutralized = /^\s*[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${neutralized.replace(/"/g, '""')}"`;
}

function failed(
  contentHash: string,
  byteSize: number,
  field: string,
  code: string,
  message: string,
): ParsedImportFile {
  return Object.freeze({
    ok: false,
    contentHash,
    byteSize,
    issues: Object.freeze([
      Object.freeze({ field, code, message, severity: "error" as const }),
    ]),
  });
}

function validateHeaders(headers: readonly string[]):
  | Readonly<{
      ok: true;
      index: ReadonlyMap<ProductImportHeader, number>;
    }>
  | Readonly<{ ok: false; issues: readonly ImportFieldIssue[] }> {
  const issues: ImportFieldIssue[] = [];
  const exact = headers.map((header) => header.trim());
  const canonical = exact.map(canonicalHeader);
  if (new Set(canonical).size !== canonical.length) {
    issues.push(
      issue(
        "header",
        "duplicate_header",
        "The CSV header contains duplicate or ambiguous columns.",
      ),
    );
  }
  const allowed = new Set<string>(PRODUCT_IMPORT_HEADERS);
  if (exact.some((header) => !allowed.has(header))) {
    issues.push(
      issue(
        "header",
        canonical.some(
          (header, position) =>
            allowed.has(header) && exact[position] !== header,
        )
          ? "ambiguous_header"
          : "unknown_column",
        "The CSV header contains unsupported or ambiguous columns.",
      ),
    );
  }
  for (const required of PRODUCT_IMPORT_HEADERS) {
    if (!exact.includes(required)) {
      issues.push(
        issue(required, "missing_header", "A required CSV column is missing."),
      );
    }
  }
  if (issues.length > 0) {
    return Object.freeze({ ok: false, issues: Object.freeze(issues) });
  }
  return Object.freeze({
    ok: true,
    index: new Map(
      PRODUCT_IMPORT_HEADERS.map((header) => [header, exact.indexOf(header)]),
    ),
  });
}

function issue(field: string, code: string, message: string): ImportFieldIssue {
  return Object.freeze({ field, code, message, severity: "error" });
}

function canonicalHeader(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function asStringRecord(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.some((cell) => typeof cell !== "string")) {
    throw new TypeError("CSV parser returned a malformed record");
  }
  return value as string[];
}

function isCompressed(bytes: Buffer): boolean {
  return (
    (bytes[0] === 0x1f && bytes[1] === 0x8b) ||
    (bytes[0] === 0x50 && bytes[1] === 0x4b) ||
    (bytes[0] === 0x28 && bytes[1] === 0xb5 && bytes[2] === 0x2f) ||
    (bytes[0] === 0xfd && bytes[1] === 0x37 && bytes[2] === 0x7a)
  );
}

function validateUtf8(bytes: Buffer): void {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunkSize = 64 * 1024;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    decoder.decode(bytes.subarray(index, index + chunkSize), { stream: true });
  }
  decoder.decode();
}

function* decodeChunks(bytes: Buffer): Generator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const chunkSize = 64 * 1024;
  for (let index = 0; index < bytes.length; index += chunkSize) {
    const decoded = decoder.decode(bytes.subarray(index, index + chunkSize), {
      stream: true,
    });
    if (decoded) yield decoded;
  }
  const final = decoder.decode();
  if (final) yield final;
}
