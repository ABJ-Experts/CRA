import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { Injectable } from "@nestjs/common";
import { fromBuffer as fileTypeFromBuffer } from "file-type";

import { SupabaseService } from "../../supabase/supabase.service";
import type { SbomStoragePort } from "../application/sbom-intake-use-cases";

const bucket = "sbom-originals";
const uploadTtlMilliseconds = 10 * 60 * 1_000;
const downloadTtlSeconds = 5 * 60;
const sha256 = /^[a-f0-9]{64}$/;
const objectKey =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[a-f0-9]{64}$/;
const mediaTypes = new Set([
  "application/json",
  "application/xml",
  "text/xml",
  "text/plain",
  "application/octet-stream",
  "application/vnd.cyclonedx+json",
  "application/vnd.cyclonedx+xml",
  "application/spdx+json",
  "application/spdx+xml",
]);

type StorageResponse<T> = Readonly<{
  data: T | null;
  error: Readonly<{ message?: string }> | null;
}>;

/** Private, server-owned SBOM object access; never logs bytes or signed URLs. */
@Injectable()
export class SupabaseSbomStorageAdapter implements SbomStoragePort {
  constructor(private readonly supabase: SupabaseService) {}

  async createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }>,
  ) {
    this.assertMetadata(input);
    if (!objectKey.test(input.objectKey))
      throw new SbomStorageError("malformed");
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .createSignedUploadUrl(input.objectKey, {
          upsert: false,
        })) as StorageResponse<Readonly<{ signedUrl?: unknown }>>;
      if (result.error || !result.data || !signedUrl(result.data.signedUrl))
        throw new SbomStorageError("unavailable");
      return Object.freeze({
        uploadUrl: result.data.signedUrl,
        expiresAt: new Date(Date.now() + uploadTtlMilliseconds).toISOString(),
      });
    } catch (error) {
      throw this.providerError(error);
    }
  }

  async createSignedDownload(
    input: Readonly<{
      objectKey: string;
      fileName: string;
      contentType: string;
    }>,
  ) {
    if (
      !objectKey.test(input.objectKey) ||
      !safeFileName(input.fileName) ||
      !mediaTypes.has(input.contentType)
    ) {
      throw new SbomStorageError("malformed");
    }
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .createSignedUrl(input.objectKey, downloadTtlSeconds, {
          download: input.fileName,
        })) as StorageResponse<Readonly<{ signedUrl?: unknown }>>;
      if (result.error || !result.data || !signedUrl(result.data.signedUrl))
        throw new SbomStorageError("unavailable");
      return Object.freeze({
        downloadUrl: result.data.signedUrl,
        expiresAt: new Date(
          Date.now() + downloadTtlSeconds * 1_000,
        ).toISOString(),
        fileName: input.fileName,
        contentType: input.contentType,
      });
    } catch (error) {
      throw this.providerError(error);
    }
  }

  async inspect(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ) {
    this.assertMetadata(input);
    if (!objectKey.test(input.objectKey) || !sha256.test(input.sha256))
      throw new SbomStorageError("malformed");
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectKey)) as StorageResponse<Blob>;
      if (result.error || !result.data)
        return isNotFound(result.error)
          ? Object.freeze({ outcome: "missing" as const })
          : Object.freeze({ outcome: "unavailable" as const });
      const measured = await digest(result.data);
      const detected = await fileTypeFromBuffer(measured.probe);
      const actualContentType = detected
        ? canonicalMediaType(detected.mime)
        : input.contentType;
      if (measured.byteSize !== input.byteSize)
        return Object.freeze({
          outcome: "corrupt" as const,
          sha256: measured.sha256,
          byteSize: measured.byteSize,
          contentType: actualContentType,
        });
      if (measured.sha256 !== input.sha256)
        return Object.freeze({
          outcome: "hash_mismatch" as const,
          sha256: measured.sha256,
          byteSize: measured.byteSize,
          contentType: actualContentType,
        });
      if (actualContentType !== input.contentType)
        return Object.freeze({
          outcome: "type_mismatch" as const,
          sha256: measured.sha256,
          byteSize: measured.byteSize,
          contentType: actualContentType,
        });
      return Object.freeze({
        outcome: "verified" as const,
        sha256: measured.sha256,
        byteSize: measured.byteSize,
        contentType: input.contentType,
      });
    } catch (error) {
      if (error instanceof SbomStorageError) throw error;
      return Object.freeze({ outcome: "unavailable" as const });
    }
  }

  async readVerified(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      contentType: string;
    }>,
  ) {
    this.assertMetadata(input);
    if (!objectKey.test(input.objectKey) || !sha256.test(input.sha256))
      throw new SbomStorageError("malformed");
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectKey)) as StorageResponse<Blob>;
      if (result.error || !result.data)
        return isNotFound(result.error)
          ? Object.freeze({ outcome: "missing" as const })
          : Object.freeze({ outcome: "unavailable" as const });
      const measured = await digest(result.data, { collectBytes: true });
      if (measured.byteSize !== input.byteSize)
        return Object.freeze({
          outcome: "corrupt" as const,
          sha256: measured.sha256,
          byteSize: measured.byteSize,
          contentType: input.contentType,
        });
      if (measured.sha256 !== input.sha256)
        return Object.freeze({
          outcome: "hash_mismatch" as const,
          sha256: measured.sha256,
          byteSize: measured.byteSize,
          contentType: input.contentType,
        });
      return Object.freeze({
        outcome: "verified" as const,
        bytes: measured.bytes,
        sha256: measured.sha256,
        byteSize: measured.byteSize,
        contentType: input.contentType,
      });
    } catch (error) {
      if (error instanceof SbomStorageError) throw error;
      return Object.freeze({ outcome: "unavailable" as const });
    }
  }

  private assertMetadata(
    input: Readonly<{ contentType: string; byteSize: number }>,
  ): void {
    if (
      !mediaTypes.has(input.contentType) ||
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > 100 * 1024 * 1024
    ) {
      throw new SbomStorageError("malformed");
    }
  }

  private providerError(error: unknown): SbomStorageError {
    return error instanceof SbomStorageError
      ? error
      : new SbomStorageError("unavailable");
  }
}

export class SbomStorageError extends Error {
  constructor(readonly code: "malformed" | "unavailable") {
    super(code);
  }
}

async function digest(
  blob: Blob,
  options: Readonly<{ collectBytes?: boolean }> = {},
): Promise<
  Readonly<{
    sha256: string;
    byteSize: number;
    probe: Buffer;
    bytes: Buffer;
  }>
> {
  const hash = createHash("sha256");
  const probeChunks: Buffer[] = [];
  const byteChunks: Buffer[] = [];
  let byteSize = 0;
  let probeRemaining = 8_192;
  for await (const value of Readable.fromWeb(blob.stream() as never)) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    hash.update(chunk);
    byteSize += chunk.byteLength;
    if (options.collectBytes) byteChunks.push(Buffer.from(chunk));
    if (probeRemaining > 0) {
      const probe = Buffer.from(chunk.subarray(0, probeRemaining));
      probeChunks.push(probe);
      probeRemaining -= probe.byteLength;
    }
  }
  return Object.freeze({
    sha256: hash.digest("hex"),
    byteSize,
    probe: Buffer.concat(probeChunks),
    bytes: Buffer.concat(byteChunks),
  });
}

function canonicalMediaType(value: string): string | null {
  if (value === "application/json") return "application/json";
  if (value === "application/xml") return "application/xml";
  return mediaTypes.has(value) ? value : null;
}

function safeFileName(value: string): boolean {
  return (
    value.trim().length > 0 &&
    value.length <= 255 &&
    value !== "." &&
    value !== ".." &&
    !/[\\/\p{Cc}\p{Cf}]/u.test(value)
  );
}

function signedUrl(value: unknown): value is string {
  try {
    const url = new URL(typeof value === "string" ? value : "");
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" &&
        ["localhost", "127.0.0.1", "::1"].includes(url.hostname))
    );
  } catch {
    return false;
  }
}

function isNotFound(error: Readonly<{ message?: string }> | null): boolean {
  return Boolean(
    error?.message && /not found|object.*not/i.test(error.message),
  );
}
