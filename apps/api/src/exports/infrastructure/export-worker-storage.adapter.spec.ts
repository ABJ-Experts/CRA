import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import type { SupabaseService } from "../../supabase/supabase.service";
import { SupabaseExportWorkerStorage } from "./export-worker-storage.adapter";
const bytes = Buffer.from("private filtered rows é");
const hash = createHash("sha256").update(bytes).digest("hex");
const objectPath = `${"a".repeat(36)}/${"b".repeat(36)}/part-0001.csv-${hash}`;
function fixture(
  response: { data: ReadableStream | null; error: unknown } = {
    data: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    error: null,
  },
) {
  const upload = jest.fn().mockResolvedValue({ error: null });
  const asStream = jest.fn().mockResolvedValue(response);
  const from = jest
    .fn()
    .mockReturnValue({ upload, download: () => ({ asStream }) });
  const adapter = new SupabaseExportWorkerStorage({
    admin: () => ({ storage: { from } }),
  } as unknown as SupabaseService);
  return { adapter, upload, from };
}
describe("private export artifact storage", () => {
  it("streams verified private artifact and cleans only its private spool", async () => {
    const { adapter, from } = fixture();
    const opened = await adapter.openVerified({
      objectPath,
      sha256: hash,
      byteLength: bytes.length,
    });
    expect(opened).not.toBeNull();
    const result: Buffer[] = [];
    for await (const chunk of opened!.body) result.push(chunk as Buffer);
    expect(Buffer.concat(result)).toEqual(bytes);
    await opened!.cleanup();
    expect(from).toHaveBeenCalledWith("filtered-exports");
  });
  it("verifies exact hashes without returning public links", async () => {
    expect(
      await fixture().adapter.verify({
        objectPath,
        sha256: hash,
        bytes: bytes.length,
      }),
    ).toBe(true);
  });
  it.each([0, bytes.length + 1])("rejects wrong lengths %s", async (length) => {
    expect(
      await fixture().adapter.openVerified({
        objectPath,
        sha256: hash,
        byteLength: length,
      }),
    ).toBeNull();
  });
  it("denies corrupt hashes or storage outage", async () => {
    expect(
      await fixture().adapter.openVerified({
        objectPath,
        sha256: "f".repeat(64),
        byteLength: bytes.length,
      }),
    ).toBeNull();
    expect(
      await fixture({
        data: null,
        error: { message: "provider" },
      }).adapter.verify({ objectPath, sha256: hash, bytes: bytes.length }),
    ).toBe(false);
  });
  it("uploads idempotently without replacing existing files", async () => {
    const { adapter, upload } = fixture();
    await adapter.upload({
      objectPath,
      contentType: "text/csv",
      stream: Readable.from(bytes),
    });
    upload.mockResolvedValueOnce({
      error: { message: "The resource already exists" },
    });
    await adapter.upload({
      objectPath,
      contentType: "text/csv",
      stream: Readable.from(bytes),
    });
    upload.mockResolvedValueOnce({ error: { message: "offline" } });
    await expect(
      adapter.upload({
        objectPath,
        contentType: "text/csv",
        stream: Readable.from(bytes),
      }),
    ).rejects.toThrow("storage_unavailable");
    expect(upload).toHaveBeenCalledWith(objectPath, expect.anything(), {
      contentType: "text/csv",
      upsert: false,
    });
  });
  it("rejects unsafe paths and unbounded read metadata", async () => {
    await expect(
      fixture().adapter.upload({
        objectPath: "../secret",
        contentType: "text/csv",
        stream: Readable.from(bytes),
      }),
    ).rejects.toThrow("malformed_provider");
    await expect(
      fixture().adapter.openVerified({
        objectPath,
        sha256: "bad",
        byteLength: bytes.length,
      }),
    ).rejects.toThrow("malformed_provider");
    await expect(
      fixture().adapter.openVerified({
        objectPath,
        sha256: hash,
        byteLength: -1,
      }),
    ).rejects.toThrow("malformed_provider");
  });
});
it("repeated verification never creates an unused delivery stream", async () => {
  const readStream = jest.spyOn(
    jest.requireActual<typeof import("node:fs")>("node:fs"),
    "createReadStream",
  );
  try {
    for (let n = 0; n < 12; n++)
      expect(
        await fixture().adapter.verify({
          objectPath,
          sha256: hash,
          bytes: bytes.length,
        }),
      ).toBe(true);
    expect(readStream).not.toHaveBeenCalled();
  } finally {
    readStream.mockRestore();
  }
});
it("closes an unopened delivery stream before removing its spool", async () => {
  const opened = await fixture().adapter.openVerified({
    objectPath,
    sha256: hash,
    byteLength: bytes.length,
  });
  if (!opened) throw new Error("Expected verified spool");
  await opened.cleanup();
  expect(opened.body.destroyed).toBe(true);
  expect(opened.body.closed).toBe(true);
  await opened.cleanup();
});
