import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import type { Readable } from "node:stream";
import sharp from "sharp";
import yauzl from "yauzl";

const maximumTextBytes = 2 * 1024 * 1024;
const maximumOoxmlEntries = 250;
const maximumOcrPages = 50;
const yauzlModule = yauzl as unknown as YauzlModule;

type ZipEntry = Readonly<{ fileName: string; uncompressedSize: number }>;
type ZipFile = Readonly<{
  on(event: "error", listener: (error: Error) => void): void;
  once(event: "end", listener: () => void): void;
  readEntry(): void;
  close(): void;
  openReadStream(
    entry: ZipEntry,
    callback: (error: Error | null, stream?: Readable) => void,
  ): void;
}>;
type YauzlModule = Readonly<{
  fromBuffer(
    bytes: Buffer,
    options: Readonly<{
      lazyEntries: true;
      decodeStrings: true;
      validateEntrySizes: true;
    }>,
    callback: (error: Error | null, archive?: ZipFile) => void,
  ): void;
}>;

export type EvidenceExtractionFailure =
  | "source_unavailable"
  | "unsupported"
  | "malformed"
  | "encrypted"
  | "resource_limit"
  | "timeout"
  | "extractor_unavailable"
  | "empty"
  | "low_quality";

export type EvidenceTextExtractionResult = Readonly<
  | {
      outcome: "complete";
      text: string;
      quality: "native" | "ocr" | "mixed";
      truncated: boolean;
      pages: readonly Readonly<{ page: number; text: string }>[];
    }
  | { outcome: "failed"; failureCode: EvidenceExtractionFailure }
>;

export type LocalEvidenceTextExtractorOptions = Readonly<{
  pdftotextPath?: string;
  pdftoppmPath?: string;
  tesseractPath?: string;
  ocrLanguage: string;
  commandTimeoutMs: number;
  overallTimeoutMs: number;
  maximumPixels: number;
}>;

/**
 * Local-only, bounded document text extraction. The caller supplies a stream
 * whose digest guard must finish successfully before any parser sees bytes.
 * Nothing in this adapter performs network I/O or shell interpolation.
 */
export class LocalEvidenceTextExtractorAdapter {
  constructor(private readonly options: LocalEvidenceTextExtractorOptions) {}

  async extract(
    input: Readonly<{ source: Readable; mediaType: string }>,
  ): Promise<EvidenceTextExtractionResult> {
    const startedAt = Date.now();
    const directory = await mkdtemp(join(tmpdir(), "cra-evidence-ocr-"));
    const sourcePath = join(directory, "source");
    try {
      await pipeline(input.source, await createPrivateFile(sourcePath));
      if (Date.now() - startedAt > this.options.overallTimeoutMs)
        return failed("timeout");
      if (input.mediaType === "text/plain" || input.mediaType === "text/csv")
        return completeText(await readBoundedText(sourcePath), "native");
      if (isOffice(input.mediaType)) return await this.extractOoxml(sourcePath);
      if (input.mediaType === "application/pdf")
        return await this.extractPdf(sourcePath, directory, startedAt);
      if (isImage(input.mediaType))
        return await this.extractImage(sourcePath, directory, startedAt);
      return failed("unsupported");
    } catch (error) {
      return failed(classify(error));
    } finally {
      await rm(directory, { recursive: true, force: true }).catch(
        () => undefined,
      );
    }
  }

  private async extractPdf(
    sourcePath: string,
    directory: string,
    startedAt: number,
  ): Promise<EvidenceTextExtractionResult> {
    if (!this.options.pdftotextPath) return failed("extractor_unavailable");
    const nativePath = join(directory, "native.txt");
    const native = await command(
      this.options.pdftotextPath,
      ["-enc", "UTF-8", sourcePath, nativePath],
      directory,
      this.remaining(startedAt),
    );
    if (native.code === null) return failed("extractor_unavailable");
    if (native.code !== 0)
      return failed(
        native.timedOut
          ? "timeout"
          : /password|encrypt/i.test(native.stderr)
            ? "encrypted"
            : "malformed",
      );
    const nativeRaw = await readBoundedRawText(nativePath);
    const nativeText = normalize(nativeRaw);
    const nativePages = pdfPages(nativeRaw);
    if (hasUsefulText(nativeText)) {
      if (
        nativeText.length < 1_000 &&
        this.options.pdftoppmPath &&
        this.options.tesseractPath
      ) {
        const ocr = await this.ocrPdf(sourcePath, directory, startedAt);
        if (ocr.outcome === "complete" && hasUsefulText(ocr.text))
          return completeText(
            `${nativeText}\n${ocr.text}`,
            "mixed",
            mergePages(nativePages, ocr.pages),
          );
      }
      return completeText(nativeText, "native", nativePages);
    }
    return this.ocrPdf(sourcePath, directory, startedAt);
  }

  private async ocrPdf(
    sourcePath: string,
    directory: string,
    startedAt: number,
  ): Promise<EvidenceTextExtractionResult> {
    if (!this.options.pdftoppmPath || !this.options.tesseractPath)
      return failed("extractor_unavailable");
    const prefix = join(directory, "page");
    const rendered = await command(
      this.options.pdftoppmPath,
      [
        "-jpeg",
        "-r",
        "180",
        "-f",
        "1",
        "-l",
        String(maximumOcrPages),
        sourcePath,
        prefix,
      ],
      directory,
      this.remaining(startedAt),
    );
    if (rendered.code === null) return failed("extractor_unavailable");
    if (rendered.code !== 0)
      return failed(rendered.timedOut ? "timeout" : "malformed");
    const pages = (await readdir(directory))
      .filter((name) => /^page-\d+\.jpg$/u.test(name))
      .sort((left, right) => pageNumber(left) - pageNumber(right));
    if (pages.length === 0) return failed("empty");
    if (pages.length >= maximumOcrPages) return failed("resource_limit");
    return this.ocrImages(
      pages.map((page) => ({
        path: join(directory, page),
        page: pageNumber(page),
      })),
      directory,
      startedAt,
    );
  }

  private async extractImage(
    sourcePath: string,
    directory: string,
    startedAt: number,
  ): Promise<EvidenceTextExtractionResult> {
    try {
      const metadata = await sharp(sourcePath, {
        limitInputPixels: this.options.maximumPixels,
      }).metadata();
      if (
        !metadata.width ||
        !metadata.height ||
        metadata.width * metadata.height > this.options.maximumPixels
      )
        return failed("resource_limit");
    } catch {
      return failed("malformed");
    }
    return this.ocrImages(
      [{ path: sourcePath, page: 1 }],
      directory,
      startedAt,
    );
  }

  private async ocrImages(
    images: readonly Readonly<{ path: string; page: number }>[],
    directory: string,
    startedAt: number,
  ): Promise<EvidenceTextExtractionResult> {
    if (!this.options.tesseractPath) return failed("extractor_unavailable");
    const pages: { page: number; text: string }[] = [];
    for (const [index, image] of images.entries()) {
      if (this.remaining(startedAt) <= 0) return failed("timeout");
      const outputBase = join(directory, `ocr-${index}`);
      const result = await command(
        this.options.tesseractPath,
        [image.path, outputBase, "-l", this.options.ocrLanguage],
        directory,
        this.remaining(startedAt),
      );
      if (result.code === null) return failed("extractor_unavailable");
      if (result.code !== 0)
        return failed(result.timedOut ? "timeout" : "extractor_unavailable");
      pages.push({
        page: image.page,
        text: await readBoundedText(`${outputBase}.txt`),
      });
    }
    const text = pages.map((page) => page.text).join("\n");
    return hasUsefulText(text)
      ? completeText(text, "ocr", pages)
      : failed("low_quality");
  }

  private async extractOoxml(
    sourcePath: string,
  ): Promise<EvidenceTextExtractionResult> {
    const bytes = await readFile(sourcePath);
    const text = await readOoxmlText(bytes);
    return hasUsefulText(text) ? completeText(text, "native") : failed("empty");
  }

  private remaining(startedAt: number) {
    return Math.min(
      this.options.commandTimeoutMs,
      this.options.overallTimeoutMs - (Date.now() - startedAt),
    );
  }
}

async function createPrivateFile(path: string) {
  await writeFile(path, Buffer.alloc(0), { mode: 0o600 });
  return createWriteStream(path, { flags: "w", mode: 0o600 });
}

async function readBoundedText(path: string) {
  return normalize(await readBoundedRawText(path));
}
async function readBoundedRawText(path: string) {
  const bytes = await readFile(path);
  if (bytes.byteLength > maximumTextBytes) throw new ResourceLimitError();
  return bytes.toString("utf8");
}
function pageNumber(name: string) {
  return Number(/^page-(\d+)\.jpg$/u.exec(name)?.[1]);
}
function pdfPages(raw: string) {
  return raw.split("\f").flatMap((part, index) => {
    const text = normalize(part);
    return text ? [{ page: index + 1, text }] : [];
  });
}
function mergePages(
  native: readonly Readonly<{ page: number; text: string }>[],
  ocr: readonly Readonly<{ page: number; text: string }>[],
) {
  return [...new Set([...native, ...ocr].map((entry) => entry.page))]
    .sort((left, right) => left - right)
    .map((page) => ({
      page,
      text: [
        native.find((entry) => entry.page === page)?.text,
        ocr.find((entry) => entry.page === page)?.text,
      ]
        .filter(Boolean)
        .join("\n"),
    }));
}

async function readOoxmlText(bytes: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: string[] = [];
    let count = 0;
    let total = 0;
    yauzlModule.fromBuffer(
      bytes,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive) return reject(new MalformedError());
        archive.on("error", () => reject(new MalformedError()));
        (archive as unknown as EventEmitter).on(
          "entry",
          (entry: yauzl.Entry) => {
            count += 1;
            total += entry.uncompressedSize;
            if (count > maximumOoxmlEntries || total > maximumTextBytes * 4) {
              archive.close();
              return reject(new ResourceLimitError());
            }
            if (!isTextOoxmlEntry(entry.fileName)) return archive.readEntry();
            archive.openReadStream(entry, (streamError, stream) => {
              if (streamError || !stream) return reject(new MalformedError());
              const pieces: Buffer[] = [];
              let size = 0;
              stream.on("data", (chunk: Buffer) => {
                size += chunk.byteLength;
                if (size <= maximumTextBytes) pieces.push(Buffer.from(chunk));
              });
              stream.once("error", () => reject(new MalformedError()));
              stream.once("end", () => {
                if (size > maximumTextBytes)
                  return reject(new ResourceLimitError());
                chunks.push(stripXml(Buffer.concat(pieces).toString("utf8")));
                archive.readEntry();
              });
            });
          },
        );
        archive.once("end", () => resolve(normalize(chunks.join("\n"))));
        archive.readEntry();
      },
    );
  });
}

function isTextOoxmlEntry(name: string) {
  return /^(word\/(document|header\d+|footer\d+)\.xml|xl\/(sharedStrings|worksheets\/sheet\d+)\.xml|ppt\/slides\/slide\d+\.xml)$/u.test(
    name,
  );
}
function stripXml(value: string) {
  return value
    .replace(/<[^>]*>/gu, " ")
    .replace(/&amp;/gu, "&")
    .replace(/&lt;/gu, "<")
    .replace(/&gt;/gu, ">");
}
function normalize(value: string) {
  return stripControlCharacters(value).replace(/\s+/gu, " ").trim();
}
function stripControlCharacters(value: string) {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127 ? " " : character;
  }).join("");
}
function hasUsefulText(value: string) {
  return value.replace(/[^\p{L}\p{N}]/gu, "").length >= 8;
}
function isOffice(type: string) {
  return type.includes("openxmlformats-officedocument");
}
function isImage(type: string) {
  return type === "image/jpeg" || type === "image/png" || type === "image/webp";
}
function completeText(
  text: string,
  quality: "native" | "ocr" | "mixed",
  pages: readonly Readonly<{ page: number; text: string }>[] = [
    { page: 1, text },
  ],
): EvidenceTextExtractionResult {
  if (!hasUsefulText(text))
    return failed(quality === "ocr" ? "low_quality" : "empty");
  return Object.freeze({
    outcome: "complete",
    text: text.slice(0, maximumTextBytes),
    quality,
    truncated: text.length > maximumTextBytes,
    pages: text.length > maximumTextBytes ? [] : pages,
  });
}
function failed(
  failureCode: EvidenceExtractionFailure,
): EvidenceTextExtractionResult {
  return Object.freeze({ outcome: "failed", failureCode });
}
function classify(error: unknown): EvidenceExtractionFailure {
  if (error instanceof ResourceLimitError) return "resource_limit";
  if (error instanceof MalformedError) return "malformed";
  if (error instanceof CommandTimeoutError) return "timeout";
  return "source_unavailable";
}
class ResourceLimitError extends Error {}
class MalformedError extends Error {}
class CommandTimeoutError extends Error {}
async function command(
  executable: string,
  args: readonly string[],
  cwd: string,
  timeoutMs: number,
) {
  if (timeoutMs <= 0) throw new CommandTimeoutError();
  return new Promise<
    Readonly<{ code: number | null; stderr: string; timedOut: boolean }>
  >((resolve) => {
    const child = spawn(executable, args, {
      cwd,
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
    });
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);
    child.stderr.on("data", (chunk: Buffer) => {
      if (Buffer.concat(stderr).byteLength < 8192)
        stderr.push(Buffer.from(chunk));
    });
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ code: null, stderr: "", timedOut });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({
        code,
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
      });
    });
  });
}
