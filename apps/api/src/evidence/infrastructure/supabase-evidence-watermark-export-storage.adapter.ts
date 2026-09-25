import { createHash } from "node:crypto";
import { Injectable } from "@nestjs/common";
import { SupabaseService } from "../../supabase/supabase.service";

const bucket = "evidence-watermark-exports";
const maximumBytes = 50 * 1024 * 1024;
const derivativeKey =
  /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/;
const accepted = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

type StorageResponse<T> = Readonly<{
  data: T | null;
  error: Readonly<{ message?: string }> | null;
}>;

/**
 * Derivatives intentionally use a separate private bucket.  Nothing here
 * signs URLs: the API streams a token-authorized, hash-verified object so
 * recipient metadata can never escape in a provider URL.
 */
@Injectable()
export class SupabaseEvidenceWatermarkExportStorageAdapter {
  constructor(private readonly supabase: SupabaseService) {}

  async upload(
    input: Readonly<{
      objectKey: string;
      bytes: Buffer;
      mediaType: string;
    }>,
  ): Promise<"stored" | "unavailable"> {
    if (
      !derivativeKey.test(input.objectKey) ||
      !accepted.has(input.mediaType) ||
      input.bytes.byteLength < 1 ||
      input.bytes.byteLength > maximumBytes
    )
      throw new EvidenceWatermarkStorageError("malformed");
    try {
      const response = (await this.supabase
        .admin()
        .storage.from(bucket)
        .upload(input.objectKey, input.bytes, {
          contentType: input.mediaType,
          upsert: false,
        })) as StorageResponse<unknown>;
      return response.error ? "unavailable" : "stored";
    } catch {
      return "unavailable";
    }
  }

  async readVerified(
    input: Readonly<{
      objectKey: string;
      sha256: string;
      byteSize: number;
      mediaType: string;
    }>,
  ): Promise<Buffer | null> {
    if (
      !derivativeKey.test(input.objectKey) ||
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      !Number.isSafeInteger(input.byteSize) ||
      input.byteSize < 1 ||
      input.byteSize > maximumBytes ||
      !accepted.has(input.mediaType)
    )
      throw new EvidenceWatermarkStorageError("malformed");
    try {
      const response = (await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectKey)) as StorageResponse<Blob>;
      if (response.error || !response.data) return null;
      const bytes = Buffer.from(await response.data.arrayBuffer());
      return bytes.byteLength === input.byteSize &&
        digest(bytes) === input.sha256
        ? bytes
        : null;
    } catch {
      return null;
    }
  }

  async remove(
    input: Readonly<{ objectKey: string }>,
  ): Promise<"deleted" | "missing" | "unavailable"> {
    if (!derivativeKey.test(input.objectKey))
      throw new EvidenceWatermarkStorageError("malformed");
    try {
      const response = (await this.supabase
        .admin()
        .storage.from(bucket)
        .remove([input.objectKey])) as StorageResponse<unknown>;
      if (!response.error) return "deleted";
      return /not found|object not found/i.test(response.error.message ?? "")
        ? "missing"
        : "unavailable";
    } catch {
      return "unavailable";
    }
  }
}

export class EvidenceWatermarkStorageError extends Error {
  constructor(readonly code: "malformed") {
    super(code);
  }
}

export function evidenceWatermarkDerivativeSha256(bytes: Buffer): string {
  return digest(bytes);
}

function digest(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}
