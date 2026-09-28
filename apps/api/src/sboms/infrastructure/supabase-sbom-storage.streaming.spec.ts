import { createHash } from "node:crypto";
import { ReadableStream } from "node:stream/web";
import { SupabaseService } from "../../supabase/supabase.service";
import { SupabaseSbomStorageAdapter } from "./supabase-sbom-storage.adapter";

const objectKey =
  "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/" +
  "a".repeat(64);
const bytes = Buffer.from('{"bomFormat":"CycloneDX"}');
const metadata = {
  objectKey,
  contentType: "application/json",
  byteSize: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
};
function harness(
  options: {
    chunks?: Uint8Array[];
    error?: Error;
    resultError?: { message: string };
    missing?: boolean;
  } = {},
) {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of options.chunks ?? [bytes]) controller.enqueue(chunk);
      if (options.error) controller.error(options.error);
      else controller.close();
    },
  });
  const asStream = jest.fn().mockResolvedValue({
    data: options.missing ? null : stream,
    error: options.resultError ?? null,
  });
  const download = jest.fn().mockReturnValue({
    asStream,
    then: () => {
      throw new Error("Must not load a Blob");
    },
  });
  const adapter = new SupabaseSbomStorageAdapter({
    admin: () => ({ storage: { from: () => ({ download }) } }),
  } as unknown as SupabaseService);
  return { adapter, download, asStream };
}

describe("actual SBOM storage streaming", () => {
  it.each(["application/vnd.cyclonedx+json", "application/spdx+json"])(
    "preserves a declared %s JSON content type",
    async (contentType) => {
      await expect(
        harness().adapter.inspect({ ...metadata, contentType }),
      ).resolves.toMatchObject({ outcome: "verified", contentType });
    },
  );
  it.each(["application/xml", "application/vnd.cyclonedx+xml"])(
    "accepts XML magic bytes with the declared %s representation",
    async (contentType) => {
      const xml = Buffer.from(
        '<?xml version="1.0"?><bom xmlns="http://cyclonedx.org/schema/bom/1.6" version="1"/>',
      );
      const input = {
        ...metadata,
        contentType,
        byteSize: xml.length,
        sha256: createHash("sha256").update(xml).digest("hex"),
      };
      await expect(
        harness({ chunks: [xml] }).adapter.inspect(input),
      ).resolves.toMatchObject({
        outcome: "verified",
        contentType,
      });
    },
  );
  it("cancels an opened body even when destroyed before its first read", async () => {
    const cancel = jest.fn();
    const stream = new ReadableStream<Uint8Array>({ cancel });
    const opened = await providerAdapter({
      data: stream,
      error: null,
    }).adapter.openVerified(metadata);
    if (opened.outcome !== "verified") throw new Error("Stream unavailable");
    opened.stream.destroy();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("cancels the upstream download when a consumer stops early", async () => {
    const cancel = jest.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(8));
      },
      cancel,
    });
    const adapter = providerAdapter({ data: stream, error: null }).adapter;
    const opened = await adapter.openVerified({
      ...metadata,
      byteSize: 104857600,
    });
    if (opened.outcome !== "verified") throw new Error("Stream unavailable");
    for await (const chunk of opened.stream) {
      void chunk;
      break;
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it("inspects using the SDK stream without asking for a Blob", async () => {
    const { adapter, asStream } = harness();
    await expect(adapter.inspect(metadata)).resolves.toMatchObject({
      outcome: "verified",
      byteSize: bytes.length,
    });
    expect(asStream).toHaveBeenCalledTimes(1);
  });
  it("opens lazily and verifies every chunk's hash before successful EOF", async () => {
    const { adapter, asStream } = harness({
      chunks: [bytes.subarray(0, 3), bytes.subarray(3)],
    });
    const opened = await adapter.openVerified(metadata);
    expect(opened.outcome).toBe("verified");
    if (opened.outcome !== "verified") throw new Error("Stream unavailable");
    const output: Buffer[] = [];
    for await (const chunk of opened.stream) {
      if (!(chunk instanceof Uint8Array)) throw new Error("Invalid byte chunk");
      output.push(Buffer.from(chunk));
    }
    expect(Buffer.concat(output)).toEqual(bytes);
    expect(asStream).toHaveBeenCalledTimes(1);
  });
  it.each([
    { ...metadata, sha256: "b".repeat(64) },
    { ...metadata, byteSize: bytes.length + 1 },
    { ...metadata, byteSize: bytes.length - 1 },
  ])("rejects mismatched stream integrity", async (input) => {
    const opened = await harness().adapter.openVerified(input);
    if (opened.outcome !== "verified") throw new Error("Stream unavailable");
    await expect(
      (async () => {
        for await (const chunk of opened.stream) void chunk;
      })(),
    ).rejects.toMatchObject({ code: "malformed" });
  });
  it("propagates a late upstream failure through the consumer", async () => {
    const opened = await harness({
      error: new Error("provider disconnected"),
    }).adapter.openVerified(metadata);
    if (opened.outcome !== "verified") throw new Error("Stream unavailable");
    await expect(
      (async () => {
        for await (const chunk of opened.stream) void chunk;
      })(),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("does not declare inaccessible evidence verified", async () => {
    const { adapter } = harness({
      missing: true,
      resultError: { message: "Object not found" },
    });
    await expect(adapter.openVerified(metadata)).resolves.toMatchObject({
      outcome: "missing",
    });
  });
  it("inspects hash and size differences without changing originals", async () => {
    await expect(
      harness().adapter.inspect({ ...metadata, sha256: "b".repeat(64) }),
    ).resolves.toMatchObject({ outcome: "hash_mismatch" });
    await expect(
      harness().adapter.inspect({ ...metadata, byteSize: bytes.length + 1 }),
    ).resolves.toMatchObject({ outcome: "corrupt" });
  });
});

function providerAdapter(result: unknown, reject = false) {
  const operation = reject
    ? jest.fn().mockRejectedValue(result)
    : jest.fn().mockResolvedValue(result);
  const adapter = new SupabaseSbomStorageAdapter({
    admin: () => ({
      storage: {
        from: () => ({
          createSignedUploadUrl: operation,
          createSignedUrl: operation,
          upload: operation,
          download: () => ({ asStream: operation }),
        }),
      },
    }),
  } as unknown as SupabaseService);
  return { adapter, operation };
}

describe("SBOM storage authorization metadata and outage boundaries", () => {
  const upload = {
    objectKey,
    contentType: "application/json",
    byteSize: bytes.length,
  };
  const download = {
    objectKey,
    contentType: "application/json",
    fileName: "original.json",
  };
  it.each([
    "https://storage.example/upload",
    "http://127.0.0.1:54321/upload",
    "http://localhost/upload",
  ])("accepts scoped signed URL %s", async (signedUrl) => {
    await expect(
      providerAdapter({
        data: { signedUrl },
        error: null,
      }).adapter.createSignedUpload(upload),
    ).resolves.toMatchObject({ uploadUrl: signedUrl });
    await expect(
      providerAdapter({
        data: { signedUrl },
        error: null,
      }).adapter.createSignedDownload(download),
    ).resolves.toMatchObject({ downloadUrl: signedUrl });
  });
  it.each([
    "javascript:alert(1)",
    "http://external.example/upload",
    "not-url",
    undefined,
  ])("rejects unsafe provider signing output %s", async (signedUrl) => {
    await expect(
      providerAdapter({
        data: { signedUrl },
        error: null,
      }).adapter.createSignedUpload(upload),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      providerAdapter({
        data: { signedUrl },
        error: null,
      }).adapter.createSignedDownload(download),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it.each([
    { data: null, error: null },
    { data: null, error: { message: "provider failure" } },
  ])("does not leak inaccessible signing output", async (result) => {
    await expect(
      providerAdapter(result).adapter.createSignedUpload(upload),
    ).rejects.toMatchObject({ code: "unavailable" });
    await expect(
      providerAdapter(result).adapter.createSignedDownload(download),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("normalizes provider failures for signing, writes and reads", async () => {
    const { adapter } = providerAdapter(
      new Error("private provider detail"),
      true,
    );
    await expect(adapter.createSignedUpload(upload)).rejects.toMatchObject({
      message: "unavailable",
    });
    await expect(adapter.createSignedDownload(download)).rejects.toMatchObject({
      message: "unavailable",
    });
    await expect(
      adapter.writeImmutable({ ...upload, bytes }),
    ).rejects.toMatchObject({ message: "unavailable" });
    await expect(adapter.inspect(metadata)).resolves.toMatchObject({
      outcome: "unavailable",
    });
    await expect(adapter.readVerified(metadata)).resolves.toMatchObject({
      outcome: "unavailable",
    });
    await expect(adapter.openVerified(metadata)).resolves.toMatchObject({
      outcome: "unavailable",
    });
  });
  it("writes generated content without allowing overwrite", async () => {
    const { adapter, operation } = providerAdapter({ data: {}, error: null });
    await expect(adapter.writeImmutable({ ...upload, bytes })).resolves.toEqual(
      { outcome: "written" },
    );
    expect(operation).toHaveBeenCalledWith(objectKey, bytes, {
      contentType: "application/json",
      upsert: false,
    });
    await expect(
      providerAdapter({
        data: null,
        error: { message: "Object already exists" },
      }).adapter.writeImmutable({ ...upload, bytes }),
    ).resolves.toEqual({ outcome: "already_exists" });
    await expect(
      providerAdapter({
        data: null,
        error: { message: "Permission denied" },
      }).adapter.writeImmutable({ ...upload, bytes }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it.each([
    { byteSize: 0 },
    { byteSize: 104857601 },
    { byteSize: 1.5 },
    { contentType: "text/html" },
    { objectKey: "../other-tenant" },
  ])(
    "rejects malformed metadata before any storage request",
    async (change) => {
      const { adapter, operation } = providerAdapter({});
      await expect(
        adapter.createSignedUpload({ ...upload, ...change }),
      ).rejects.toMatchObject({ code: "malformed" });
      await expect(
        adapter.inspect({ ...metadata, ...change }),
      ).rejects.toMatchObject({ code: "malformed" });
      await expect(
        adapter.readVerified({ ...metadata, ...change }),
      ).rejects.toMatchObject({ code: "malformed" });
      await expect(
        adapter.openVerified({ ...metadata, ...change }),
      ).rejects.toMatchObject({ code: "malformed" });
      expect(operation).not.toHaveBeenCalled();
    },
  );
  it.each(["", "..", "../foreign.json", "unsafe\n.json", "x".repeat(256)])(
    "rejects unsafe attachment filename %s",
    async (fileName) => {
      await expect(
        providerAdapter({}).adapter.createSignedDownload({
          ...download,
          fileName,
        }),
      ).rejects.toMatchObject({ code: "malformed" });
    },
  );
  it("rejects unsafe generated object keys, filename metadata and digests", async () => {
    await expect(
      providerAdapter({}).adapter.writeImmutable({
        ...upload,
        bytes,
        objectKey: "foreign",
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      providerAdapter({}).adapter.createSignedDownload({
        ...download,
        objectKey: "foreign",
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      providerAdapter({}).adapter.createSignedDownload({
        ...download,
        contentType: "text/html",
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      providerAdapter({}).adapter.inspect({ ...metadata, sha256: "uppercase" }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      providerAdapter({}).adapter.readVerified({
        ...metadata,
        sha256: "uppercase",
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    await expect(
      providerAdapter({}).adapter.openVerified({
        ...metadata,
        sha256: "uppercase",
      }),
    ).rejects.toMatchObject({ code: "malformed" });
  });
  it.each(["inspect", "readVerified", "openVerified"] as const)(
    "returns missing versus outage for %s",
    async (method) => {
      await expect(
        providerAdapter({
          data: null,
          error: { message: "Object not found" },
        }).adapter[method](metadata),
      ).resolves.toMatchObject({ outcome: "missing" });
      await expect(
        providerAdapter({
          data: null,
          error: { message: "Storage unavailable" },
        }).adapter[method](metadata),
      ).resolves.toMatchObject({ outcome: "unavailable" });
    },
  );
  it("legacy byte-reader still validates integrity while collecting its explicitly requested bounded content", async () => {
    await expect(
      harness().adapter.readVerified({ ...metadata, sha256: "b".repeat(64) }),
    ).resolves.toMatchObject({ outcome: "hash_mismatch" });
    await expect(
      harness().adapter.readVerified({
        ...metadata,
        byteSize: bytes.length + 1,
      }),
    ).resolves.toMatchObject({ outcome: "corrupt" });
    await expect(
      harness({ error: new Error("provider disconnect") }).adapter.readVerified(
        metadata,
      ),
    ).resolves.toMatchObject({ outcome: "unavailable" });
    await expect(
      harness({ error: new Error("provider disconnect") }).adapter.inspect(
        metadata,
      ),
    ).resolves.toMatchObject({ outcome: "unavailable" });
  });
  it("rejects binary content pretending to be JSON", async () => {
    const png = Buffer.from(
      "89504e470d0a1a0a0000000d4948445200000001000000010806000000",
      "hex",
    );
    await expect(
      harness({ chunks: [png] }).adapter.inspect({
        ...metadata,
        byteSize: png.length,
        sha256: createHash("sha256").update(png).digest("hex"),
      }),
    ).resolves.toMatchObject({ outcome: "type_mismatch" });
  });
});
