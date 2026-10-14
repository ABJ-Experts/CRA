import { createHash } from "node:crypto";
import * as yauzl from "yauzl";
import { z } from "zod";
import {
  diagnosticPayloadSchema,
  diagnosticManifestSchema,
  diagnosticSelectionSchema,
} from "@repo/contracts/support-diagnostics";
import type {
  SupportDiagnosticSelection,
  SupportDiagnosticPayload,
} from "@repo/contracts/support-diagnostics";
import { buildStoredZipStream } from "../../common/archive/stored-zip";
const MAX = 10485760;
const names = [
  "logs.json",
  "configuration.json",
  "metrics.json",
  "omissions.json",
] as const;
export const diagnosticDigest = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
export class DiagnosticArchive {
  constructor(private readonly now: () => Date = () => new Date()) {}
  async pack(
    jobId: string,
    selection: SupportDiagnosticSelection,
    payload: SupportDiagnosticPayload,
  ) {
    z.uuid().parse(jobId);
    diagnosticSelectionSchema.parse(selection);
    const safe = diagnosticPayloadSchema.parse(payload);
    const selected = names.filter(
      (name) =>
        name === "omissions.json" ||
        (selection.categories.includes(
          name.slice(0, -5) as SupportDiagnosticSelection["categories"][number],
        ) &&
          safe[name.slice(0, -5) as keyof SupportDiagnosticPayload] !==
            undefined),
    );
    const files = selected.map((name) => ({
      name,
      bytes: Buffer.from(
        JSON.stringify(
          safe[name.slice(0, -5) as keyof SupportDiagnosticPayload],
        ),
      ),
    }));
    const manifest = diagnosticManifestSchema.parse({
      version: "m15_04_v1",
      jobId,
      generatedAt: this.now().toISOString(),
      selection,
      entries: files.map((file) => ({
        name: file.name,
        sha256: diagnosticDigest(file.bytes),
        byteSize: file.bytes.length,
      })),
      omissions: safe.omissions,
    });
    const built = buildStoredZipStream([
      ...files,
      { name: "manifest.json", bytes: Buffer.from(JSON.stringify(manifest)) },
    ]);
    if (built.byteSize > MAX) throw new Error("bundle_limit");
    const chunks: Buffer[] = [];
    for await (const chunk of built.stream) chunks.push(chunk as Buffer);
    return {
      bytes: Buffer.concat(chunks),
      manifest,
      artifact: {
        sha256: built.sha256,
        byteSize: built.byteSize,
        fileName: `support-diagnostics-${jobId}.zip`,
      },
    };
  }
  async inspect(bytes: Buffer) {
    if (bytes.length > MAX || bytes.length < 22)
      throw new Error("artifact_integrity");
    const files = await readEntries(bytes);
    const canonical = buildStoredZipStream(
      [...files].map(([name, content]) => ({ name, bytes: content })),
    );
    if (
      canonical.byteSize !== bytes.length ||
      canonical.sha256 !== diagnosticDigest(bytes)
    )
      throw new Error("artifact_integrity");
    const manifest = diagnosticManifestSchema.parse(
      JSON.parse(files.get("manifest.json")!.toString("utf8")),
    );
    for (const entry of manifest.entries) {
      const content = files.get(entry.name);
      if (
        !content ||
        content.length !== entry.byteSize ||
        diagnosticDigest(content) !== entry.sha256
      )
        throw new Error("artifact_integrity");
    }
    if (
      manifest.entries.length !== files.size - 1 ||
      new Set(manifest.entries.map((entry) => entry.name)).size !==
        manifest.entries.length
    )
      throw new Error("artifact_integrity");
    const parsed = diagnosticPayloadSchema.parse(
      Object.fromEntries(
        [...files]
          .filter(([name]) => name !== "manifest.json")
          .map(([name, content]) => [name.slice(0, -5), parseJson(content)]),
      ),
    );
    if (
      !files.has("omissions.json") ||
      manifest.entries.some(
        (entry) =>
          entry.name !== "omissions.json" &&
          !manifest.selection.categories.includes(
            entry.name.slice(
              0,
              -5,
            ) as SupportDiagnosticSelection["categories"][number],
          ),
      )
    )
      throw new Error("artifact_integrity");
    if (JSON.stringify(parsed.omissions) !== JSON.stringify(manifest.omissions))
      throw new Error("artifact_integrity");
    return {
      manifest,
      logs: parsed.logs ?? [],
      configuration: parsed.configuration ?? null,
      metrics: parsed.metrics ?? [],
      omissions: parsed.omissions,
    };
  }
}
function readEntries(bytes: Buffer): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) =>
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) return reject(new Error("artifact_integrity"));
        const files = new Map<string, Buffer>();
        let total = 0;
        const fail = () => {
          zip.close();
          reject(new Error("artifact_integrity"));
        };
        zip.on("error", fail);
        zip.on("end", () =>
          files.size >= 2 && files.size <= 5 && files.has("manifest.json")
            ? resolve(files)
            : fail(),
        );
        zip.on("entry", (entry: yauzl.Entry) => {
          if (
            ![...names, "manifest.json"].includes(entry.fileName) ||
            files.has(entry.fileName) ||
            entry.compressionMethod !== 0 ||
            entry.generalPurposeBitFlag & 1 ||
            entry.uncompressedSize > MAX ||
            entry.extraFields.length > 0
          )
            return fail();
          total += entry.uncompressedSize;
          if (total > MAX) return fail();
          zip.openReadStream(entry, (streamError, stream) => {
            if (streamError || !stream) return fail();
            const chunks: Buffer[] = [];
            let size = 0;
            stream.on("error", fail);
            stream.on("data", (chunk: Buffer) => {
              size += chunk.length;
              if (size > entry.uncompressedSize) {
                stream.destroy();
                fail();
              } else chunks.push(chunk);
            });
            stream.on("end", () => {
              if (size !== entry.uncompressedSize) return fail();
              files.set(entry.fileName, Buffer.concat(chunks));
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    ),
  );
}

function parseJson(bytes: Buffer): unknown {
  return JSON.parse(bytes.toString("utf8")) as unknown;
}
