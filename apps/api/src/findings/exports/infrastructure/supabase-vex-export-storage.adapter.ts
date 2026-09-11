import { createHash } from "node:crypto";

import { Injectable, Logger } from "@nestjs/common";

import { SupabaseService } from "../../../supabase/supabase.service";
import type { VexExportStoragePort } from "../vex-export.port";

const bucket = "tenant-exports";
const sha256 = /^[a-f0-9]{64}$/;
const objectPath =
  /^[0-9a-f-]{36}\/vex\/(openvex|cyclonedx-vex)\/(0_2_0|1_6)\/[a-f0-9]{64}\.json$/;
const maximumBytes = 50 * 1024 * 1024;

type StorageResponse<T> = Readonly<{
  data: T | null;
  error: Readonly<{ message?: string }> | null;
}>;

/** Private immutable export store. Object paths never cross an HTTP boundary. */
@Injectable()
export class SupabaseVexExportStorageAdapter implements VexExportStoragePort {
  private readonly logger = new Logger(SupabaseVexExportStorageAdapter.name);

  constructor(private readonly supabase: SupabaseService) {}

  async putImmutable(
    input: Readonly<{
      organizationId: string;
      exportId: string;
      objectKey: string;
      bytes: Buffer;
      contentType:
        "application/vnd.openvex+json" | "application/vnd.cyclonedx+json";
      sha256: string;
    }>,
  ): Promise<Readonly<{ objectKey: string; byteSize: number }>> {
    assertObject(
      input.organizationId,
      input.objectKey,
      input.bytes,
      input.sha256,
    );
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .upload(input.objectKey, input.bytes, {
          contentType: input.contentType,
          upsert: false,
        })) as StorageResponse<unknown>;
      if (result.error && !alreadyExists(result.error)) {
        this.logger.warn(
          `VEX export upload was rejected: ${result.error.message ?? "storage rejection"}`,
        );
        throw unavailable();
      }
      return Object.freeze({
        objectKey: input.objectKey,
        byteSize: input.bytes.byteLength,
      });
    } catch (error) {
      if (error instanceof VexExportStorageError) throw error;
      this.logger.warn(`VEX export upload failed: ${safeErrorMessage(error)}`);
      throw unavailable();
    }
  }

  async readImmutable(
    input: Readonly<{ organizationId: string; objectKey: string }>,
  ): Promise<Buffer | null> {
    if (
      !objectPath.test(input.objectKey) ||
      !input.objectKey.startsWith(`${input.organizationId}/`)
    )
      throw new VexExportStorageError("malformed");
    try {
      const result = (await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectKey)) as StorageResponse<Blob>;
      if (result.error || !result.data) {
        if (missing(result.error)) return null;
        this.logger.warn(
          `VEX export download was rejected: ${result.error?.message ?? "storage rejection"}`,
        );
        throw unavailable();
      }
      const bytes = Buffer.from(await result.data.arrayBuffer());
      if (bytes.byteLength > maximumBytes) throw unavailable();
      return bytes;
    } catch (error) {
      if (error instanceof VexExportStorageError) throw error;
      this.logger.warn(
        `VEX export download failed: ${safeErrorMessage(error)}`,
      );
      throw unavailable();
    }
  }
}

export class VexExportStorageError extends Error {
  constructor(readonly code: "malformed" | "unavailable") {
    super(`VEX export storage ${code}`);
  }
}

function assertObject(
  organizationId: string,
  key: string,
  bytes: Buffer,
  digest: string,
) {
  if (
    !objectPath.test(key) ||
    !key.startsWith(`${organizationId}/`) ||
    bytes.byteLength < 1 ||
    bytes.byteLength > maximumBytes ||
    !sha256.test(digest) ||
    createHash("sha256").update(bytes).digest("hex") !== digest
  )
    throw new VexExportStorageError("malformed");
}
function alreadyExists(error: Readonly<{ message?: string }>): boolean {
  return /exist|duplicate|409/i.test(error.message ?? "");
}
function missing(error: Readonly<{ message?: string }> | null): boolean {
  return /not found|404/i.test(error?.message ?? "");
}
function unavailable(): VexExportStorageError {
  return new VexExportStorageError("unavailable");
}

function safeErrorMessage(error: unknown): string {
  if (!(error instanceof Error)) return "unknown storage failure";
  return error.message.slice(0, 300);
}
