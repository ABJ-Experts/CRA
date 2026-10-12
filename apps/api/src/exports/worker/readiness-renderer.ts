import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { finished } from "node:stream/promises";
import fontkit from "@pdf-lib/fontkit";
import PDFDocument from "pdfkit";
import {
  exportReadinessReportSchema,
  type ExportReadinessReport,
} from "@repo/contracts/exports";
import type { RenderedPart } from "./export-renderer";

const fontFiles = [
  "latin",
  "latin-ext",
  "greek",
  "greek-ext",
  "cyrillic",
  "cyrillic-ext",
  "devanagari",
];

export async function renderReadinessReport(
  directory: string,
  value: unknown,
): Promise<readonly RenderedPart[]> {
  const report = exportReadinessReportSchema.parse(value);
  const json = JSON.stringify(report, null, 2) + "\n";
  if (Buffer.byteLength(json) > 5 * 1024 * 1024)
    throw new Error("export_limit");
  const fonts = await Promise.all(
    fontFiles.map(async (kind) => {
      const bytes = await readFile(
        require.resolve(
          `@fontsource/noto-sans/files/noto-sans-${kind}-400-normal.woff`,
        ),
      );
      return { kind, bytes, font: fontkit.create(bytes) };
    }),
  );
  const path = join(directory, "readiness.pdf");
  const output = createWriteStream(path, { flags: "wx", mode: 0o600 });
  const completion = finished(output);
  void completion.catch(() => undefined);
  const document = new PDFDocument({
    bufferPages: false,
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
    info: {
      Title: "Product documentation audit-readiness",
      Author: "CRA Sentinel",
    },
  });
  document.pipe(output);
  fonts.forEach((font) => document.registerFont(font.kind, font.bytes));
  let pages = 1;
  let lines = 0;
  let degradedGlyphs = false;
  document.on("pageAdded", () => {
    pages += 1;
  });
  const write = (text: string) => {
    lines += Math.max(1, Math.ceil(text.length / 80));
    if (lines > 8000 || pages > 100 || output.bytesWritten > 25 * 1024 * 1024)
      throw new Error("export_limit");
    const runs: { kind: string; text: string }[] = [];
    for (const character of text) {
      const point = character.codePointAt(0)!;
      if (point < 32 && character !== "\n" && character !== "\t") continue;
      const font = fonts.find((candidate) =>
        candidate.font.hasGlyphForCodePoint(point),
      );
      const kind = font?.kind ?? "latin";
      const displayed = font
        ? character
        : `[U+${point.toString(16).toUpperCase()}]`;
      if (!font) degradedGlyphs = true;
      const previous = runs.at(-1);
      if (previous?.kind === kind) previous.text += displayed;
      else runs.push({ kind, text: displayed });
    }
    runs.forEach((run, index) =>
      document
        .font(run.kind)
        .text(run.text, { continued: index < runs.length - 1, link: null }),
    );
    if (!runs.length) document.text(" ");
  };
  try {
    document.fontSize(18);
    write("Product documentation audit-readiness");
    document.fontSize(10);
    document.moveDown();
    write(`Product: ${report.product.name}`);
    write(`Captured as of: ${report.snapshotAsOf}`);
    write(
      `Product version: ${report.product.version}; technical-file version: ${report.technicalFileVersion}`,
    );
    write(
      "Documentation readiness only. This report does not certify conformity or approve an audit.",
    );
    if (report.degraded)
      write("Degraded report: restricted or unavailable sources are omitted.");
    report.notices.forEach(write);
    write(
      `Canonical readiness: ${report.canonicalReadiness?.overallStatus ?? "unavailable"}`,
    );
    if (report.canonicalReadiness) {
      write(
        `Calculation state: ${report.canonicalReadiness.recalculationStatus}; calculated: ${report.canonicalReadiness.calculatedAt ?? "unknown"}`,
      );
      for (const section of report.canonicalReadiness.sections)
        write(`${section.sectionKey}: ${section.status}`);
      for (const gap of report.canonicalReadiness.gaps)
        write(`${gap.sectionKey}: ${gap.code} - ${gap.actionLabel}`);
    }
    document.moveDown();
    write("Evidence validity and source revisions");
    for (const evidence of report.evidence) write(evidenceLine(evidence));
    if (!report.evidence.length)
      write("No disclosable evidence in this capture.");
    document.moveDown();
    write("Source/as-of versions");
    report.sourceVersions.forEach((source) =>
      write(`${source.source}: ${source.version}; as of ${source.asOf}`),
    );
    if (degradedGlyphs)
      write(
        "Some PDF glyphs are displayed as Unicode code points. Exact source text is preserved in readiness.json.",
      );
    document.end();
    await completion;
    if (pages > 100) throw new Error("export_limit");
    await writeFile(join(directory, "readiness.json"), json, {
      mode: 0o600,
      flag: "wx",
    });
    return Promise.all(
      ["readiness.pdf", "readiness.json"].map(async (name) => {
        const file = join(directory, name);
        const bytes = (await stat(file)).size;
        if (bytes > 25 * 1024 * 1024) throw new Error("export_limit");
        const hash = createHash("sha256");
        for await (const chunk of createReadStream(file))
          hash.update(chunk as Buffer);
        return {
          path: file,
          name,
          bytes,
          sha256: hash.digest("hex"),
          rowCount: 1,
        };
      }),
    );
  } catch (error) {
    document.destroy();
    output.destroy();
    await completion.catch(() => undefined);
    throw error;
  }
}
function evidenceLine(
  evidence: ExportReadinessReport["evidence"][number],
): string {
  return `${evidence.name}: ${evidence.validityStatus}; ${evidence.stale ? "stale" : "current"}; ${evidence.unavailable ? "unavailable" : "available"}; validity ${evidence.validFrom ?? "unknown"} to ${evidence.validUntil ?? "unknown"}; ${evidence.sourceKind} version ${evidence.sourceVersion ?? "unknown"}`;
}
