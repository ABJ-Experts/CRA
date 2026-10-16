import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { SupabaseService } from "../../supabase/supabase.service";
import type { ExportWorkerStorage } from "../worker/export-worker.types";
const bucket = "filtered-exports";
const objectPathPattern =
  /^[a-f0-9-]{36}\/[a-f0-9-]{36}\/(?:part-\d{4}\.(?:csv|xlsx)|readiness\.(?:pdf|json))-[a-f0-9]{64}$/;
export class SupabaseExportWorkerStorage implements ExportWorkerStorage {
  constructor(private readonly supabase: SupabaseService) {}
  async upload(
    input: Readonly<{
      objectPath: string;
      contentType: string;
      stream: NodeJS.ReadableStream;
    }>,
  ) {
    assertPath(input.objectPath);
    const response = await this.supabase
      .admin()
      .storage.from(bucket)
      .upload(input.objectPath, input.stream, {
        contentType: input.contentType,
        upsert: false,
      });
    if (
      response.error &&
      !["Duplicate", "The resource already exists"].some((text) =>
        response.error.message.includes(text),
      )
    )
      throw new Error("storage_unavailable");
  }
  async verify(
    input: Readonly<{ objectPath: string; sha256: string; bytes: number }>,
  ) {
    const opened = await this.spoolVerified({
      objectPath: input.objectPath,
      sha256: input.sha256,
      byteLength: input.bytes,
    });
    if (!opened) return false;
    await opened.cleanup();
    return true;
  }
  async openVerified(
    input: Readonly<{ objectPath: string; sha256: string; byteLength: number }>,
  ): Promise<Readonly<{
    body: Readable;
    cleanup: () => Promise<void>;
  }> | null> {
    const opened = await this.spoolVerified(input);
    if (!opened) return null;
    const body = createReadStream(opened.path);
    const cleanup = async () => {
      if (!body.closed) {
        await new Promise<void>((resolve) => {
          const ignoreCleanupError = () => undefined;
          body.on("error", ignoreCleanupError);
          body.once("close", () => {
            body.off("error", ignoreCleanupError);
            resolve();
          });
          body.destroy();
        });
      }
      await opened.cleanup();
    };
    return { body, cleanup };
  }
  private async spoolVerified(
    input: Readonly<{ objectPath: string; sha256: string; byteLength: number }>,
  ): Promise<Readonly<{ path: string; cleanup: () => Promise<void> }> | null> {
    assertPath(input.objectPath);
    if (
      !/^[a-f0-9]{64}$/.test(input.sha256) ||
      !Number.isSafeInteger(input.byteLength) ||
      input.byteLength < 0 ||
      input.byteLength > 64 * 1024 * 1024
    )
      throw new Error("malformed_provider");
    const directory = await mkdtemp(join(tmpdir(), "cra-export-download-"));
    await chmod(directory, 0o700);
    const path = join(directory, "artifact");
    const cleanup = () => rm(directory, { recursive: true, force: true });
    try {
      const response = await this.supabase
        .admin()
        .storage.from(bucket)
        .download(input.objectPath)
        .asStream();
      if (response.error || !response.data) {
        await cleanup();
        return null;
      }
      const hash = createHash("sha256");
      let bytes = 0;
      const measure = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > input.byteLength) {
            callback(new Error("storage_integrity_failed"));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(
        Readable.fromWeb(
          response.data as Parameters<typeof Readable.fromWeb>[0],
        ),
        measure,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
      if (bytes !== input.byteLength || hash.digest("hex") !== input.sha256) {
        await cleanup();
        return null;
      }
      return { path, cleanup };
    } catch {
      await cleanup();
      return null;
    }
  }
}
function assertPath(value: string) {
  if (!objectPathPattern.test(value)) throw new Error("malformed_provider");
}
