import { BoundedUploadService } from "../../licensing/uploads/bounded-upload.service";
import type { UploadScope } from "../../licensing/uploads/upload-scope";
import { createHash } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { Injectable, Optional } from "@nestjs/common";
import { inspectEvidenceMediaType } from "../../common/storage/evidence-media-inspection";
import { SupabaseService } from "../../supabase/supabase.service";
import type { EvidenceStoragePort } from "../application/evidence-intake-use-cases";

const bucket = "evidence-documents";
const maximumBytes = 50 * 1024 * 1024;
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
  constructor(
    private readonly supabase: SupabaseService,
    @Optional() private readonly uploads?: BoundedUploadService,
  ) {}

  async createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
      scope?: UploadScope;
    }>,
  ) {
    if (!objectKey.test(input.objectKey) || !validSize(input.byteSize))
      throw new EvidenceStorageError("malformed");
    try {
      if (!this.uploads || !input.scope)
        throw new Error("Upload admission unavailable");
      return await this.uploads.issue({ ...input, scope: input.scope, bucket });
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
      const mediaType = await inspectEvidenceMediaType(
        measured.probe,
        measured.textProbe,
        async () => Buffer.from(await result.data!.arrayBuffer()),
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
    const detected = await inspectEvidenceMediaType(
      measured.probe,
      measured.textProbe,
      async () => Buffer.from(await result.data!.arrayBuffer()),
    );
    if (
      measured.byteSize !== input.byteSize ||
      measured.sha256 !== input.sha256 ||
      detected !== input.mediaType
    )
      return null;
    return Buffer.from(await result.data.arrayBuffer());
  }

  /**
   * Cleanup is deliberately narrow: only a database-claimed key with the
   * evidence bucket's UUID path shape can be removed. Storage's not-found
   * response is idempotent success; the durable cleanup RPC decides whether a
   * retry is needed before this method is ever called.
   */
  async remove(
    input: Readonly<{ objectKey: string }>,
  ): Promise<"deleted" | "missing" | "unavailable"> {
    if (!objectKey.test(input.objectKey))
      throw new EvidenceStorageError("malformed");
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .remove([input.objectKey])) as StorageResponse<unknown>;
      if (!result.error) return "deleted";
      return isNotFound(result.error) ? "missing" : "unavailable";
    } catch {
      return "unavailable";
    }
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

function validSize(value: number) {
  return Number.isSafeInteger(value) && value > 0 && value <= maximumBytes;
}
function isNotFound(error: Readonly<{ message?: string }> | null) {
  return Boolean(
    error?.message && /not found|object.*not/i.test(error.message),
  );
}
