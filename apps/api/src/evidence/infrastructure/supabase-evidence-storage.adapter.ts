import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { Injectable } from "@nestjs/common";
import { fromBuffer as fileTypeFromBuffer } from "file-type";
import yauzl from "yauzl";
import { SupabaseService } from "../../supabase/supabase.service";
import type { EvidenceStoragePort } from "../application/evidence-intake-use-cases";

const bucket = "evidence-documents";
const maximumBytes = 50 * 1024 * 1024;
const uploadTtlMilliseconds = 15 * 60 * 1_000;
const objectKey =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const accepted = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/csv",
  "text/plain",
]);
type StorageResponse<T> = Readonly<{
  data: T | null;
  error: Readonly<{ message?: string }> | null;
}>;

@Injectable()
export class SupabaseEvidenceStorageAdapter implements EvidenceStoragePort {
  constructor(private readonly supabase: SupabaseService) {}

  async createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }>,
  ) {
    if (!objectKey.test(input.objectKey) || !validSize(input.byteSize))
      throw new EvidenceStorageError("malformed");
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .createSignedUploadUrl(input.objectKey, {
          upsert: false,
        })) as StorageResponse<Readonly<{ signedUrl?: unknown }>>;
      if (result.error || typeof result.data?.signedUrl !== "string")
        throw new EvidenceStorageError("unavailable");
      return Object.freeze({
        uploadUrl: result.data.signedUrl,
        expiresAt: new Date(Date.now() + uploadTtlMilliseconds).toISOString(),
      });
    } catch (error) {
      throw this.providerError(error);
    }
  }

  async inspect(
    input: Readonly<{ objectKey: string; maximumByteSize: number }>,
  ) {
    if (
      !objectKey.test(input.objectKey) ||
      input.maximumByteSize !== maximumBytes
    )
      throw new EvidenceStorageError("malformed");
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectKey)) as StorageResponse<Blob>;
      if (result.error || !result.data)
        return {
          outcome: isNotFound(result.error)
            ? ("missing" as const)
            : ("unavailable" as const),
          code: isNotFound(result.error)
            ? "source_missing"
            : "storage_unavailable",
        };
      if (!validSize(result.data.size))
        return { outcome: "rejected" as const, code: "size_exceeded" };
      const measured = await digest(result.data);
      const mediaType = await inspectType(
        measured.probe,
        measured.textProbe,
        result.data,
      );
      if (!mediaType)
        return {
          outcome: "rejected" as const,
          code: "unsupported_or_disguised_content",
        };
      return Object.freeze({
        outcome: "verified" as const,
        sha256: measured.sha256,
        byteSize: measured.byteSize,
        mediaType,
      });
    } catch {
      return { outcome: "unavailable" as const, code: "storage_unavailable" };
    }
  }

  async openVerified(
    input: Readonly<{ objectKey: string; sha256: string; byteSize: number }>,
  ) {
    if (
      !objectKey.test(input.objectKey) ||
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      !validSize(input.byteSize)
    )
      throw new EvidenceStorageError("malformed");
    const result = (await this.supabase
      .admin()
      .storage.from(bucket)
      .download(input.objectKey)) as StorageResponse<Blob>;
    if (result.error || !result.data) return null;
    if (result.data.size !== input.byteSize) return null;
    return Readable.fromWeb(result.data.stream() as never).pipe(
      guardedStream(input),
    );
  }

  /**
   * Delivery must verify before emitting a byte. The bounded evidence limit
   * makes this deliberately stricter than the streaming scan-worker path.
   */
  async readVerified(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      mediaType: string;
    }>,
  ) {
    if (
      !objectKey.test(input.objectKey) ||
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      !validSize(input.byteSize) ||
      !accepted.has(input.mediaType)
    )
      throw new EvidenceStorageError("malformed");
    const result = (await this.supabase
      .admin()
      .storage.from(bucket)
      .download(input.objectKey)) as StorageResponse<Blob>;
    if (result.error || !result.data) return null;
    const measured = await digest(result.data);
    const detected = await inspectType(
      measured.probe,
      measured.textProbe,
      result.data,
    );
    if (
      measured.byteSize !== input.byteSize ||
      measured.sha256 !== input.sha256 ||
      detected !== input.mediaType
    )
      return null;
    return Buffer.from(await result.data.arrayBuffer());
  }

  private providerError(error: unknown) {
    return error instanceof EvidenceStorageError
      ? error
      : new EvidenceStorageError("unavailable");
  }
}

export class EvidenceStorageError extends Error {
  constructor(readonly code: "malformed" | "unavailable") {
    super(code);
  }
}

function guardedStream(
  input: Readonly<{ sha256: string; byteSize: number }>,
): Transform {
  const hash = createHash("sha256");
  let size = 0;
  return new Transform({
    transform(chunk: Buffer, _encoding, done) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += bytes.byteLength;
      if (size > input.byteSize)
        return done(new EvidenceStorageError("malformed"));
      hash.update(bytes);
      done(null, bytes);
    },
    flush(done) {
      if (size !== input.byteSize || hash.digest("hex") !== input.sha256)
        return done(new EvidenceStorageError("malformed"));
      done();
    },
  });
}

async function digest(blob: Blob) {
  const hash = createHash("sha256");
  const probeChunks: Buffer[] = [];
  let remaining = 8192;
  let size = 0;
  const stream = Readable.fromWeb(
    blob.stream() as ReadableStream<Uint8Array>,
  ) as AsyncIterable<Buffer | Uint8Array>;
  for await (const value of stream) {
    const bytes = Buffer.isBuffer(value)
      ? value
      : Buffer.from(value.buffer, value.byteOffset, value.byteLength);
    size += bytes.byteLength;
    if (size > maximumBytes) throw new EvidenceStorageError("malformed");
    hash.update(bytes);
    if (remaining > 0) {
      const part = Buffer.from(bytes.subarray(0, remaining));
      probeChunks.push(part);
      remaining -= part.byteLength;
    }
  }
  const probe = Buffer.concat(probeChunks);
  return {
    sha256: hash.digest("hex"),
    byteSize: size,
    probe,
    textProbe: probe.toString("utf8"),
  };
}

async function inspectType(
  probe: Buffer,
  text: string,
  blob: Blob,
): Promise<string | null> {
  // PDF must begin at byte zero: allowing a leading executable turns a polyglot
  // into a plausible document. Office files are further constrained by their
  // declared extension at the reservation/DB layer and scanned before access.
  if (probe.subarray(0, 5).toString("ascii") === "%PDF-")
    return "application/pdf";
  const detected = await fileTypeFromBuffer(probe);
  if (
    detected?.mime === "image/jpeg" ||
    detected?.mime === "image/png" ||
    detected?.mime === "image/webp"
  )
    return detected.mime;
  if (detected?.mime === "application/zip") return inspectOoxml(blob);
  if (probe.includes(0)) return null;
  if (!/^[\t\n\r\x20-\x7e\u0080-\uffff]*$/u.test(text)) return null;
  return /[,;\n\r]/.test(text) ? "text/csv" : "text/plain";
}

/** Inspect OOXML central-directory metadata only. yauzl never extracts an
 * entry here: entries are bounded before any future consumer can process one. */
async function inspectOoxml(blob: Blob): Promise<string | null> {
  const bytes = Buffer.from(await blob.arrayBuffer());
  return new Promise((resolve) => {
    yauzl.fromBuffer(
      bytes,
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, archive) => {
        if (error || !archive) return resolve(null);
        let count = 0;
        let total = 0;
        let contentType: string | null = null;
        let done = false;
        const finish = (value: string | null) => {
          if (!done) {
            done = true;
            archive.close();
            resolve(value);
          }
        };
        archive.on("error", () => finish(null));
        let word = false;
        let xl = false;
        let ppt = false;
        archive.on("entry", (entry: yauzl.Entry) => {
          if (
            ++count > 10_000 ||
            entry.uncompressedSize > 50 * 1024 * 1024 ||
            (entry.compressedSize > 0 &&
              entry.uncompressedSize / entry.compressedSize > 100) ||
            entry.fileName.startsWith("/") ||
            entry.fileName.includes("..") ||
            /vbaProject\.bin$/i.test(entry.fileName) ||
            (entry.generalPurposeBitFlag & 1) !== 0
          )
            return finish(null);
          total += entry.uncompressedSize;
          if (total > 200 * 1024 * 1024) return finish(null);
          if (entry.fileName === "[Content_Types].xml") contentType = "pending";
          if (entry.fileName === "word/document.xml") word = true;
          if (entry.fileName === "xl/workbook.xml") xl = true;
          if (entry.fileName === "ppt/presentation.xml") ppt = true;
          archive.readEntry();
        });
        archive.removeAllListeners("end");
        archive.on("end", () =>
          finish(
            contentType === "pending" && word
              ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              : contentType === "pending" && xl
                ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                : contentType === "pending" && ppt
                  ? "application/vnd.openxmlformats-officedocument.presentationml.presentation"
                  : null,
          ),
        );
        archive.readEntry();
      },
    );
  });
}

function validSize(value: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximumBytes;
}
function isNotFound(error: Readonly<{ message?: string }> | null) {
  return Boolean(
    error?.message && /not found|object.*not/i.test(error.message),
  );
}
