import { createHash } from "node:crypto";

import { Injectable } from "@nestjs/common";
import { fromBuffer as fileTypeFromBuffer } from "file-type";
import { BRANDING_MAX_LOGO_BYTES } from "@repo/contracts/organizations";

import { SupabaseService } from "../../../supabase/supabase.service";
import {
  BrandingProviderError,
  type BrandingStoragePort,
} from "../application/branding-use-cases";

const BRANDING_BUCKET = "organization-branding";
const SHA256_PATTERN = /^[a-f0-9]{64}$/;

@Injectable()
export class SupabaseBrandingStorageAdapter implements BrandingStoragePort {
  constructor(private readonly supabase: SupabaseService) {}

  async upload(
    objectKey: string,
    bytes: Buffer,
    mimeType: "image/webp",
  ): Promise<void> {
    try {
      const result = await this.supabase
        .admin()
        .storage.from(BRANDING_BUCKET)
        .upload(objectKey, bytes, {
          contentType: mimeType,
          cacheControl: "31536000",
          upsert: false,
        });
      if (result.error) throw new BrandingProviderError("unavailable");
    } catch (error) {
      if (error instanceof BrandingProviderError) throw error;
      throw new BrandingProviderError("unavailable");
    }
  }

  async remove(objectKey: string): Promise<void> {
    try {
      const result = await this.supabase
        .admin()
        .storage.from(BRANDING_BUCKET)
        .remove([objectKey]);
      if (result.error) throw new BrandingProviderError("unavailable");
    } catch (error) {
      if (error instanceof BrandingProviderError) throw error;
      throw new BrandingProviderError("unavailable");
    }
  }

  async download(objectKey: string, expectedSha256: string) {
    try {
      const result = await this.supabase
        .admin()
        .storage.from(BRANDING_BUCKET)
        .download(objectKey);
      if (result.error) {
        if (this.isObjectNotFound(result.error)) {
          return Object.freeze({ outcome: "not_found" as const });
        }
        throw new BrandingProviderError("unavailable");
      }
      const bytes = Buffer.from(await result.data.arrayBuffer());
      await this.assertApprovedWebp(bytes, expectedSha256);
      return Object.freeze({
        outcome: "found" as const,
        bytes,
        mimeType: "image/webp" as const,
      });
    } catch (error) {
      if (error instanceof BrandingProviderError) throw error;
      throw new BrandingProviderError("unavailable");
    }
  }

  private async assertApprovedWebp(
    bytes: Buffer,
    expectedSha256: string,
  ): Promise<void> {
    if (
      !SHA256_PATTERN.test(expectedSha256) ||
      bytes.byteLength === 0 ||
      bytes.byteLength > BRANDING_MAX_LOGO_BYTES
    ) {
      throw new BrandingProviderError("malformed");
    }
    const actualSha256 = createHash("sha256").update(bytes).digest("hex");
    if (actualSha256 !== expectedSha256) {
      throw new BrandingProviderError("malformed");
    }
    let detected: Awaited<ReturnType<typeof fileTypeFromBuffer>>;
    try {
      detected = await fileTypeFromBuffer(bytes);
    } catch {
      throw new BrandingProviderError("malformed");
    }
    if (detected?.mime !== "image/webp") {
      throw new BrandingProviderError("malformed");
    }
  }

  private isObjectNotFound(error: Readonly<{ message?: unknown }>): boolean {
    const message =
      typeof error.message === "string" ? error.message.toLowerCase() : "";
    if (message.includes("bucket")) return false;
    return (
      message === "not found" ||
      message.includes("object not found") ||
      message.includes("file not found")
    );
  }
}
