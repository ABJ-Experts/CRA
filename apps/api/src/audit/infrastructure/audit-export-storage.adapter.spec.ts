/* eslint-disable @typescript-eslint/require-await */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { stat } from "node:fs/promises";

import { SupabaseAuditExportStorageAdapter } from "./audit-export-storage.adapter";

const objectPath =
  "33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.zip";
const bytes = Buffer.from("zip-bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");

describe("SupabaseAuditExportStorageAdapter", () => {
  it("spools verified downloads into isolated 0600 temp files and cleans only its own file", async () => {
    const storage = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(bytes) as never,
    );
    const first = await storage.openVerified({
      objectPath,
      sha256,
      byteSize: bytes.byteLength,
    });
    const second = await storage.openVerified({
      objectPath,
      sha256,
      byteSize: bytes.byteLength,
    });
    expect(first?.path).toBeTruthy();
    expect(second?.path).toBeTruthy();
    expect(first!.path).not.toBe(second!.path);
    expect((await stat(first!.path)).mode & 0o777).toBe(0o600);
    await first!.cleanup();
    expect(existsSync(first!.path)).toBe(false);
    expect(existsSync(second!.path)).toBe(true);
    await second!.cleanup();
  });

  it("rejects corrupt downloads before exposing bytes", async () => {
    const storage = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(Buffer.from("wrong")) as never,
    );
    await expect(
      storage.openVerified({ objectPath, sha256, byteSize: bytes.byteLength }),
    ).resolves.toBeNull();
  });

  it("verifies an already-existing object before reuse", async () => {
    const storage = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(bytes, { uploadError: "Already exists" }) as never,
    );
    await expect(
      storage.upload({
        objectPath,
        contentType: "application/zip",
        stream: streamFrom(bytes) as never,
      }),
    ).resolves.toEqual({ outcome: "already_exists" });
    await expect(
      storage.verify({ objectPath, sha256, byteSize: bytes.byteLength }),
    ).resolves.toEqual({ outcome: "verified" });
  });

  it("rejects malformed object paths and reports unavailable provider uploads", async () => {
    const storage = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(bytes, { uploadError: "down" }) as never,
    );
    await expect(
      storage.upload({
        objectPath: "bad",
        contentType: "application/zip",
        stream: streamFrom(bytes) as never,
      }),
    ).rejects.toThrow("malformed");
    await expect(
      storage.upload({
        objectPath,
        contentType: "application/zip",
        stream: streamFrom(bytes) as never,
      }),
    ).resolves.toEqual({ outcome: "unavailable" });
  });

  it("returns null for missing provider downloads", async () => {
    const storage = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(bytes, { downloadError: "not found" }) as never,
    );
    await expect(
      storage.openVerified({ objectPath, sha256, byteSize: bytes.byteLength }),
    ).resolves.toBeNull();
  });

  it("returns verified/corrupt from the public verifier and rejects malformed reads", async () => {
    const storage = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(bytes) as never,
    );
    await expect(
      storage.verify({ objectPath, sha256, byteSize: bytes.byteLength }),
    ).resolves.toEqual({ outcome: "verified" });
    await expect(
      storage.verify({
        objectPath,
        sha256: "ff".repeat(32),
        byteSize: bytes.byteLength,
      }),
    ).resolves.toEqual({ outcome: "corrupt" });
    await expect(
      storage.openVerified({
        objectPath: "bad",
        sha256,
        byteSize: bytes.byteLength,
      }),
    ).rejects.toThrow("malformed");
  });

  it("treats provider exceptions as unavailable and aborts oversize spools", async () => {
    const storage = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(bytes, { uploadThrows: true }) as never,
    );
    await expect(
      storage.upload({
        objectPath,
        contentType: "application/zip",
        stream: streamFrom(bytes) as never,
      }),
    ).resolves.toEqual({ outcome: "unavailable" });

    const oversize = new SupabaseAuditExportStorageAdapter(
      fakeSupabase(Buffer.concat([bytes, Buffer.from("extra")])) as never,
    );
    await expect(
      oversize.openVerified({ objectPath, sha256, byteSize: bytes.byteLength }),
    ).rejects.toThrow("malformed");
  });
});

function fakeSupabase(
  downloadBytes: Buffer,
  options: {
    uploadError?: string;
    downloadError?: string;
    uploadThrows?: boolean;
  } = {},
) {
  return {
    admin: () => ({
      storage: {
        from: () => ({
          upload: async () => {
            if (options.uploadThrows) throw new Error("provider down");
            return {
              data: options.uploadError ? null : {},
              error: options.uploadError
                ? { message: options.uploadError }
                : null,
            };
          },
          download: () => ({
            asStream: async () => ({
              data: options.downloadError ? null : streamFrom(downloadBytes),
              error: options.downloadError
                ? { message: options.downloadError }
                : null,
            }),
          }),
        }),
      },
    }),
  };
}

function streamFrom(value: Buffer): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(value);
      controller.close();
    },
  });
}
