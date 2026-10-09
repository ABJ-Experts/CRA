import { createHash } from "node:crypto";

import PDFDocument from "pdfkit";
import type { TechnicalFileSnapshot } from "@repo/contracts/technical-files";

import { buildStoredZip } from "../../organizations/tenant-administration/worker/export-archive";

const maximumPages = 100;
const maximumLines = 8_000;
const maximumPdfBytes = 25 * 1024 * 1024;

export class TechnicalFileSnapshotRenderError extends Error {
  constructor(readonly code: "artifact_too_large" | "worker_unavailable") {
    super(code);
  }
}

export type RenderedTechnicalFileSnapshotExport = Readonly<{
  pdf: Buffer;
  archive: Buffer;
  manifest: Buffer;
  manifestSha256: string;
}>;

/**
 * Renders an immutable snapshot using only built-in Helvetica and bounded,
 * plain text. Snapshot JSON remains the complete machine-readable artifact.
 */
export async function renderTechnicalFileSnapshotExport(
  snapshot: TechnicalFileSnapshot,
): Promise<RenderedTechnicalFileSnapshotExport> {
  const snapshotBytes = Buffer.from(stableJson(snapshot.payload), "utf8");
  const pdf = await renderPdf(snapshot);
  const manifest = Buffer.from(
    stableJson({
      schemaVersion: "m7_04_export_v1",
      snapshotId: snapshot.id,
      payloadSha256: snapshot.payloadSha256,
      files: [
        fileRecord("snapshot.json", "application/json", snapshotBytes),
        fileRecord("technical-file.pdf", "application/pdf", pdf),
      ],
    }),
    "utf8",
  );
  const archive = buildStoredZip([
    { path: "manifest.json", bytes: manifest },
    { path: "snapshot.json", bytes: snapshotBytes },
    { path: "technical-file.pdf", bytes: pdf },
  ]).bytes;
  if (archive.byteLength > maximumPdfBytes) {
    throw new TechnicalFileSnapshotRenderError("artifact_too_large");
  }
  return Object.freeze({
    pdf,
    archive,
    manifest,
    manifestSha256: digest(manifest),
  });
}

async function renderPdf(snapshot: TechnicalFileSnapshot): Promise<Buffer> {
  const document = new PDFDocument({
    autoFirstPage: true,
    bufferPages: true,
    compress: true,
    info: {
      Title: "Annex VII technical-file snapshot",
      Author: "CRA Sentinel",
      Subject: `Snapshot ${snapshot.id}`,
    },
    margins: { top: 54, bottom: 54, left: 54, right: 54 },
  });
  const chunks: Buffer[] = [];
  const finished = new Promise<Buffer>((resolve, reject) => {
    document.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    document.on("error", () =>
      reject(new TechnicalFileSnapshotRenderError("worker_unavailable")),
    );
    document.on("end", () => resolve(Buffer.concat(chunks)));
  });
  let lines = 0;
  const write = (text: string, options?: PDFKit.Mixins.TextOptions) => {
    const normalized = [...text]
      .map((character) => {
        const code = character.charCodeAt(0);
        return code < 32 && code !== 9 && code !== 10 && code !== 13
          ? " "
          : character;
      })
      .join("");
    const count = Math.max(1, Math.ceil(normalized.length / 90));
    lines += count;
    if (lines > maximumLines) {
      throw new TechnicalFileSnapshotRenderError("artifact_too_large");
    }
    if (document.y > 720) {
      document.addPage();
    }
    document.text(normalized, options);
  };

  try {
    document.font("Helvetica-Bold").fontSize(18);
    write("Annex VII technical-file snapshot");
    document.font("Helvetica").fontSize(10);
    write(`Snapshot ID: ${snapshot.id}`);
    write(`Captured: ${snapshot.createdAt}`);
    write(`Purpose: ${snapshot.purpose}`);
    write(`Readiness: ${snapshot.readinessStatus}`);
    write(`Template: ${snapshot.templateKey} ${snapshot.templateVersion}`);
    if (snapshot.releaseId) write(`Release: ${snapshot.releaseId}`);
    if (snapshot.auditRationale)
      write(`Audit rationale: ${snapshot.auditRationale}`);

    for (const section of snapshot.payload.technicalFile.sections) {
      document.moveDown(0.8).font("Helvetica-Bold").fontSize(13);
      write(section.heading);
      document.font("Helvetica").fontSize(10);
      write(`Requirement: ${section.requirementText}`);
      write(`Status: ${section.status}`);
      write(`Narrative: ${section.narrative ?? "Not provided."}`);
      if (section.sources.length > 0) {
        write(
          `Pinned sources: ${section.sources.map((source) => `${source.title} (${source.observedRevision ?? "no revision"})`).join("; ")}`,
        );
      } else {
        write("Pinned sources: none.");
      }
    }
    const pageRange = document.bufferedPageRange();
    if (pageRange.count > maximumPages) {
      throw new TechnicalFileSnapshotRenderError("artifact_too_large");
    }
    for (let page = 0; page < pageRange.count; page += 1) {
      document.switchToPage(pageRange.start + page);
      document
        .font("Helvetica")
        .fontSize(8)
        .text(`Page ${page + 1} of ${pageRange.count}`, 54, 756, {
          align: "right",
          width: 504,
        });
    }
    document.end();
  } catch (error) {
    document.destroy();
    if (error instanceof TechnicalFileSnapshotRenderError) throw error;
    throw new TechnicalFileSnapshotRenderError("worker_unavailable");
  }
  const pdf = await finished;
  if (pdf.byteLength > maximumPdfBytes) {
    throw new TechnicalFileSnapshotRenderError("artifact_too_large");
  }
  return pdf;
}

function fileRecord(path: string, mimeType: string, bytes: Buffer) {
  return {
    path,
    fileName: path,
    mimeType,
    byteLength: bytes.byteLength,
    sha256: digest(bytes),
  };
}

function digest(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stableJson(value: unknown): string {
  return JSON.stringify(canonical(value));
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, nested]) => [key, canonical(nested)]),
    );
  }
  return value;
}
