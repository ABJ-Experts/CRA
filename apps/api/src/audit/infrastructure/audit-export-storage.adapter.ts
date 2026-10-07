import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Injectable, Logger } from "@nestjs/common";

import { SupabaseService } from "../../supabase/supabase.service";
import type { AuditExportStorage } from "../worker/audit-export-types";

const bucket = "audit-exports";
const maximumBytes = 256 * 1024 * 1024;
const objectPathPattern = /^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[a-f0-9]{64}\.zip$/;
const sha256Pattern = /^[a-f0-9]{64}$/;

type StorageResponse<T> = Readonly<{
  data: T | null;
  error: Readonly<{ message?: string }> | null;
}>;

export type VerifiedAuditExportDownload = Readonly<{
  path: string;
  sha256: string;
  byteSize: number;
  stream: () => NodeJS.ReadableStream;
  cleanup: () => Promise<void>;
}>;

@Injectable()
export class SupabaseAuditExportStorageAdapter implements AuditExportStorage {
  private readonly logger = new Logger(SupabaseAuditExportStorageAdapter.name);

  constructor(private readonly supabase: SupabaseService) {}

  async upload(
    input: Readonly<{
      objectPath: string;
      contentType: "application/zip";
      stream: NodeJS.ReadableStream;
    }>,
  ): Promise<
    Readonly<{ outcome: "stored" | "already_exists" | "unavailable" }>
  > {
    if (!objectPathPattern.test(input.objectPath))
      throw new AuditExportStorageError("malformed");
    try {
      const response = (await this.supabase
        .admin()
        .storage.from(bucket)
        .upload(input.objectPath, input.stream, {
          contentType: input.contentType,
          upsert: false,
        })) as StorageResponse<unknown>;
      if (!response.error) return Object.freeze({ outcome: "stored" as const });
      if (alreadyExists(response.error))
        return Object.freeze({ outcome: "already_exists" as const });
      this.logger.warn(
        `Audit export storage upload unavailable ${storageErrorFingerprint(response.error)}`,
      );
      return Object.freeze({ outcome: "unavailable" as const });
    } catch (error) {
      if (error instanceof AuditExportStorageError) throw error;
      this.logger.warn(
        `Audit export storage upload threw ${storageErrorFingerprint(error)}`,
      );
      return Object.freeze({ outcome: "unavailable" as const });
    }
  }

  async verify(
    input: Readonly<{ objectPath: string; sha256: string; byteSize: number }>,
  ): Promise<
    Readonly<{ outcome: "verified" | "missing" | "corrupt" | "unavailable" }>
  > {
    const opened = await this.openVerified(input);
    if (opened) {
      await opened.cleanup();
      return Object.freeze({ outcome: "verified" as const });
    }
    return Object.freeze({ outcome: "corrupt" as const });
  }

  async openVerified(
    input: Readonly<{
      objectPath: string;
      sha256: string;
      byteSize: number;
    }>,
  ): Promise<VerifiedAuditExportDownload | null> {
    assertReadInput(input);
    const tempDir = await mkdtemp(join(tmpdir(), "cra-audit-export-"));
    await chmod(tempDir, 0o700);
    const tempPath = join(tempDir, "audit-export.zip");
    try {
      const response = (await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectPath)
        .asStream()) as StorageResponse<ReadableStream<Uint8Array>>;
      if (response.error || !response.data) {
        this.logger.warn(
          `Audit export storage download unavailable ${storageErrorFingerprint(response.error)}`,
        );
        await rm(tempDir, { force: true, recursive: true });
        return null;
      }
      const measured = await spoolVerified(
        response.data,
        tempPath,
        input.byteSize,
      );
      if (
        measured.sha256 !== input.sha256 ||
        measured.byteSize !== input.byteSize
      ) {
        await rm(tempDir, { force: true, recursive: true });
        return null;
      }
      await chmod(tempPath, 0o600);
      return Object.freeze({
        path: tempPath,
        sha256: measured.sha256,
        byteSize: measured.byteSize,
        stream: () => createReadStream(tempPath),
        cleanup: () => rm(tempDir, { force: true, recursive: true }),
      });
    } catch (error) {
      await rm(tempDir, { force: true, recursive: true });
      if (error instanceof AuditExportStorageError) throw error;
      this.logger.warn(
        `Audit export storage download threw ${storageErrorFingerprint(error)}`,
      );
      return null;
    }
  }
}

export class AuditExportStorageError extends Error {
  constructor(readonly code: "malformed") {
    super(code);
  }
}

async function spoolVerified(
  stream: ReadableStream<Uint8Array>,
  path: string,
  expectedBytes: number,
): Promise<Readonly<{ sha256: string; byteSize: number }>> {
  const hash = createHash("sha256");
  let byteSize = 0;
  await pipeline(
    Readable.fromWeb(stream as never),
    new Transform({
      transform(value, _encoding, done) {
        const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
        byteSize += chunk.byteLength;
        if (byteSize > expectedBytes)
          return done(new AuditExportStorageError("malformed"));
        hash.update(chunk);
        done(null, chunk);
      },
    }),
    createWriteStream(path, { flags: "wx", mode: 0o600 }),
  );
  const metadata = await stat(path);
  if ((metadata.mode & 0o777) !== 0o600) await chmod(path, 0o600);
  return Object.freeze({ sha256: hash.digest("hex"), byteSize });
}

function assertReadInput(
  input: Readonly<{ objectPath: string; sha256: string; byteSize: number }>,
): void {
  if (
    !objectPathPattern.test(input.objectPath) ||
    !sha256Pattern.test(input.sha256) ||
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize < 1 ||
    input.byteSize > maximumBytes
  ) {
    throw new AuditExportStorageError("malformed");
  }
}

function alreadyExists(error: Readonly<{ message?: string }>): boolean {
  return /already exists|duplicate|409/i.test(error.message ?? "");
}

function storageErrorFingerprint(error: unknown): string {
  if (!error || typeof error !== "object") return "type=unknown";
  const source = error as Readonly<{
    name?: unknown;
    code?: unknown;
    status?: unknown;
    statusCode?: unknown;
    message?: unknown;
  }>;
  const name = safeToken(source.name);
  const code = safeToken(source.code);
  const status = safeToken(source.status ?? source.statusCode);
  const message = safeMessage(source.message);
  return `name=${name} code=${code} status=${status} message=${message}`;
}

function safeToken(value: unknown): string {
  return typeof value === "string" || typeof value === "number"
    ? String(value)
        .replace(/[^a-z0-9_.:-]/gi, "_")
        .slice(0, 80)
    : "unknown";
}

function safeMessage(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[^a-z0-9_.:, -]/gi, "_").slice(0, 160)
    : "unknown";
}
