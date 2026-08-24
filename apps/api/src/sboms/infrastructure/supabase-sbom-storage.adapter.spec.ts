import { createHash } from "node:crypto";

import { SupabaseService } from "../../supabase/supabase.service";
import { SupabaseSbomStorageAdapter } from "./supabase-sbom-storage.adapter";

const objectKey =
  "11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222/" +
  "a".repeat(64);

describe("SupabaseSbomStorageAdapter", () => {
  it("accepts text/plain SBOM metadata when creating signed uploads", async () => {
    const createSignedUploadUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "http://localhost/upload/sbom" },
      error: null,
    });
    const adapter = new SupabaseSbomStorageAdapter({
      admin: () => ({
        storage: {
          from: () => ({ createSignedUploadUrl }),
        },
      }),
    } as unknown as SupabaseService);

    await expect(
      adapter.createSignedUpload({
        objectKey,
        contentType: "text/plain",
        byteSize: 12,
      }),
    ).resolves.toMatchObject({
      uploadUrl: "http://localhost/upload/sbom",
    });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(objectKey, {
      upsert: false,
    });
  });

  it("reads verified bytes while rechecking hash and size with one storage download", async () => {
    const bytes = Buffer.from('{"spdxVersion":"SPDX-2.3"}');
    const download = jest.fn().mockResolvedValue({
      data: new Blob([bytes], { type: "application/json" }),
      error: null,
    });
    const adapter = new SupabaseSbomStorageAdapter({
      admin: () => ({
        storage: {
          from: () => ({ download }),
        },
      }),
    } as unknown as SupabaseService);

    await expect(
      adapter.readVerified({
        objectKey,
        contentType: "application/json",
        byteSize: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    ).resolves.toMatchObject({
      outcome: "verified",
      bytes,
      byteSize: bytes.byteLength,
      contentType: "application/json",
    });
    expect(download).toHaveBeenCalledTimes(1);
  });

  it("opens a verified SBOM as a guarded stream without collecting its chunks", async () => {
    const bytes = Buffer.from('{"bomFormat":"CycloneDX"}');
    const download = jest.fn().mockResolvedValue({
      data: new Blob([bytes], { type: "application/json" }),
      error: null,
    });
    const adapter = new SupabaseSbomStorageAdapter({
      admin: () => ({ storage: { from: () => ({ download }) } }),
    } as unknown as SupabaseService);

    const opened = await adapter.openVerified({
      objectKey,
      contentType: "application/json",
      byteSize: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });

    expect(opened.outcome).toBe("verified");
    if (opened.outcome !== "verified") throw new Error("expected stream");
    let output = Buffer.alloc(0);
    for await (const chunk of opened.stream)
      output = Buffer.concat([output, Buffer.from(chunk)]);
    expect(output).toEqual(bytes);
    expect(download).toHaveBeenCalledTimes(1);
  });
});
