import { createHash } from "node:crypto";
import { Readable } from "node:stream";

import { Injectable } from "@nestjs/common";
import { fromBuffer as fileTypeFromBuffer } from "file-type";

import { SupabaseService } from "../../supabase/supabase.service";
import {
  ProductComplianceProviderError,
  type ProductComplianceInspection,
  type ProductComplianceStoragePort,
} from "../application/product-compliance-use-cases";

const bucket = "security-update-artifacts";
const signedUploadTtlMilliseconds = 2 * 60 * 60 * 1_000;
const signedDownloadTtlSeconds = 5 * 60;
const sharedContentAddressedObjectKey =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[a-f0-9]{64}$/;
const legacyContentAddressedObjectKey =
  /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\/[a-f0-9]{64}$/;
const sha256 = /^[a-f0-9]{64}$/;
const fileTypeProbeBytes = 8_192;

type StorageError = Readonly<{ message?: unknown }>;
type StorageResponse<T> = Readonly<{
  data: T | null;
  error: StorageError | null;
}>;

/**
 * Product-owned private Storage adapter. Object keys are immutable and scoped
 * by organization first; this adapter never logs object data or signed URLs.
 */
@Injectable()
export class SupabaseProductComplianceStorageAdapter implements ProductComplianceStoragePort {
  constructor(private readonly supabase: SupabaseService) {}

  async createSignedUpload(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
    }>,
  ) {
    this.assertNewObjectInput(input);
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .createSignedUploadUrl(input.objectKey, {
          upsert: false,
        })) as StorageResponse<Readonly<{ signedUrl?: unknown }>>;
      if (
        result.error ||
        !result.data ||
        !isSignedStorageUrl(result.data.signedUrl)
      ) {
        throw new ProductComplianceProviderError("unavailable");
      }
      return Object.freeze({
        uploadUrl: result.data.signedUrl,
        expiresAt: new Date(
          Date.now() + signedUploadTtlMilliseconds,
        ).toISOString(),
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
    this.assertReadableObjectKey(input.objectKey);
    if (
      !isSafeFileName(input.fileName) ||
      input.contentType.trim().length === 0
    ) {
      throw new ProductComplianceProviderError("malformed");
    }
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .createSignedUrl(input.objectKey, signedDownloadTtlSeconds, {
          download: input.fileName,
        })) as StorageResponse<Readonly<{ signedUrl?: unknown }>>;
      if (
        result.error ||
        !result.data ||
        !isSignedStorageUrl(result.data.signedUrl)
      ) {
        throw new ProductComplianceProviderError("unavailable");
      }
      return Object.freeze({
        downloadUrl: result.data.signedUrl,
        expiresAt: new Date(
          Date.now() + signedDownloadTtlSeconds * 1_000,
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
  ): Promise<ProductComplianceInspection> {
    this.assertReadableObjectInput(input);
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectKey)) as StorageResponse<Blob>;
      if (result.error || !result.data) {
        return this.isObjectNotFound(result.error)
          ? Object.freeze({ outcome: "missing" as const })
          : Object.freeze({ outcome: "unavailable" as const });
      }
      if (result.data.size !== input.byteSize) {
        return Object.freeze({ outcome: "corrupt" as const });
      }
      const bytes = await this.digestAndProbe(result.data);
      if (bytes.byteSize !== input.byteSize) {
        return Object.freeze({ outcome: "corrupt" as const });
      }
      if (bytes.sha256 !== input.sha256) {
        return Object.freeze({ outcome: "hash_mismatch" as const });
      }
      const detected = await fileTypeFromBuffer(bytes.probe);
      const verifiedContentType =
        detected?.mime ?? undetectedContentType(input.contentType);
      if (!verifiedContentType || verifiedContentType !== input.contentType) {
        return Object.freeze({ outcome: "type_mismatch" as const });
      }
      return Object.freeze({
        outcome: "verified" as const,
        sha256: bytes.sha256,
        byteSize: bytes.byteSize,
        contentType: verifiedContentType,
      });
    } catch (error) {
      if (error instanceof ProductComplianceProviderError) throw error;
      return Object.freeze({ outcome: "unavailable" as const });
    }
  }

  /** The only place storage bytes are ever deleted; callers never touch storage directly. */
  async remove(objectKey: string): Promise<void> {
    this.assertReadableObjectKey(objectKey);
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .remove([objectKey])) as StorageResponse<unknown>;
      if (result.error) throw new ProductComplianceProviderError("unavailable");
    } catch (error) {
      throw this.providerError(error);
    }
  }

  private async digestAndProbe(
    blob: Blob,
  ): Promise<Readonly<{ sha256: string; byteSize: number; probe: Buffer }>> {
    const hash = createHash("sha256");
    let byteSize = 0;
    const probeChunks: Buffer[] = [];
    let remainingProbeBytes = fileTypeProbeBytes;
    const stream = Readable.fromWeb(blob.stream() as never);
    for await (const value of stream) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      byteSize += chunk.byteLength;
      hash.update(chunk);
      if (remainingProbeBytes > 0) {
        const probe = Buffer.from(chunk.subarray(0, remainingProbeBytes));
        probeChunks.push(probe);
        remainingProbeBytes -= probe.byteLength;
      }
    }
    return Object.freeze({
      sha256: hash.digest("hex"),
      byteSize,
      probe: Buffer.concat(probeChunks),
    });
  }

  private assertNewObjectInput(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
      sha256?: string;
    }>,
  ): void {
    this.assertNewObjectKey(input.objectKey);
    this.assertObjectMetadata(input);
  }

  private assertReadableObjectInput(
    input: Readonly<{
      objectKey: string;
      contentType: string;
      byteSize: number;
      sha256?: string;
    }>,
  ): void {
    this.assertReadableObjectKey(input.objectKey);
    this.assertObjectMetadata(input);
  }

  private assertObjectMetadata(
    input: Readonly<{
      contentType: string;
      byteSize: number;
      sha256?: string;
    }>,
  ): void {
    if (
      input.contentType.trim().length === 0 ||
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      (input.sha256 !== undefined && !sha256.test(input.sha256))
    ) {
      throw new ProductComplianceProviderError("malformed");
    }
  }

  private assertNewObjectKey(objectKey: string): void {
    if (!sharedContentAddressedObjectKey.test(objectKey)) {
      throw new ProductComplianceProviderError("malformed");
    }
  }

  private assertReadableObjectKey(objectKey: string): void {
    if (
      !sharedContentAddressedObjectKey.test(objectKey) &&
      !legacyContentAddressedObjectKey.test(objectKey)
    ) {
      throw new ProductComplianceProviderError("malformed");
    }
  }

  private providerError(error: unknown): ProductComplianceProviderError {
    return error instanceof ProductComplianceProviderError
      ? error
      : new ProductComplianceProviderError("unavailable");
  }

  private isObjectNotFound(error: StorageError | null): boolean {
    const message =
      typeof error?.message === "string" ? error.message.toLowerCase() : "";
    return (
      message === "not found" ||
      message.includes("object not found") ||
      message.includes("file not found")
    );
  }
}

const isSignedStorageUrl = (value: unknown): value is string => {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" ||
      (url.protocol === "http:" && isLoopbackHost(url.hostname))
    );
  } catch {
    return false;
  }
};

const isLoopbackHost = (hostname: string): boolean => {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
};

const undetectedContentType = (contentType: string): string | null => {
  const normalized = contentType.trim().toLowerCase();
  if (
    normalized === "application/octet-stream" ||
    normalized.startsWith("text/")
  ) {
    return contentType;
  }
  return null;
};

const isSafeFileName = (value: string): boolean =>
  value.trim().length > 0 &&
  value.length <= 255 &&
  !value.includes("/") &&
  !value.includes("\\") &&
  !value.includes("\u0000");
