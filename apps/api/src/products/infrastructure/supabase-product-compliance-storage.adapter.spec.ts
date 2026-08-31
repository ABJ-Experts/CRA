import { createHash } from "node:crypto";

import { SupabaseProductComplianceStorageAdapter } from "./supabase-product-compliance-storage.adapter";

const organizationId = "00000000-0000-4000-8000-000000000001";
const artifactId = "00000000-0000-4000-8000-000000000002";
const sha256 = "a".repeat(64);
const objectKey = `${organizationId}/${sha256}`;
const legacyObjectKey = `${organizationId}/${artifactId}/${sha256}`;

describe("SupabaseProductComplianceStorageAdapter", () => {
  it("issues a private immutable signed-upload URL only for an org-first content-addressed key", async () => {
    const createSignedUploadUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/upload" },
      error: null,
    });
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } }),
    } as never);

    await expect(
      storage.createSignedUpload({
        objectKey,
        contentType: "application/octet-stream",
        byteSize: 1_024,
      }),
    ).resolves.toMatchObject({
      uploadUrl: "https://storage.example.test/upload",
    });
    expect(createSignedUploadUrl).toHaveBeenCalledWith(objectKey, {
      upsert: false,
    });
  });

  it("permits a loopback HTTP signed URL only for local Supabase development", async () => {
    const createSignedUploadUrl = jest.fn().mockResolvedValue({
      data: {
        signedUrl:
          "http://127.0.0.1:54321/storage/v1/object/upload/security-update-artifacts/test",
      },
      error: null,
    });
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } }),
    } as never);

    const result = await storage.createSignedUpload({
      objectKey,
      contentType: "application/octet-stream",
      byteSize: 1_024,
    });
    expect(result.uploadUrl.startsWith("http://127.0.0.1:")).toBe(true);
  });

  it("rejects non-org-first or non-content-addressed paths before calling storage", async () => {
    const createSignedUploadUrl = jest.fn();
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } }),
    } as never);

    await expect(
      storage.createSignedUpload({
        objectKey: `${organizationId}/mutable/security-update.bin`,
        contentType: "application/octet-stream",
        byteSize: 1_024,
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("never issues a new upload URL for a legacy per-artifact object key", async () => {
    const createSignedUploadUrl = jest.fn();
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ createSignedUploadUrl }) } }),
    } as never);

    await expect(
      storage.createSignedUpload({
        objectKey: legacyObjectKey,
        contentType: "application/octet-stream",
        byteSize: 1_024,
      }),
    ).rejects.toMatchObject({ code: "malformed" });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });

  it("generates a short-lived attachment download URL without persisting it", async () => {
    const createSignedUrl = jest.fn().mockResolvedValue({
      data: { signedUrl: "https://storage.example.test/download" },
      error: null,
    });
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ createSignedUrl }) } }),
    } as never);

    await expect(
      storage.createSignedDownload({
        objectKey: legacyObjectKey,
        fileName: "security-update.bin",
        contentType: "application/octet-stream",
      }),
    ).resolves.toMatchObject({
      downloadUrl: "https://storage.example.test/download",
      fileName: "security-update.bin",
    });
    expect(createSignedUrl).toHaveBeenCalledWith(legacyObjectKey, 300, {
      download: "security-update.bin",
    });
  });

  it("deletes only an org-first content-addressed object key", async () => {
    const remove = jest
      .fn()
      .mockResolvedValue({ data: [{ name: objectKey }], error: null });
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ remove }) } }),
    } as never);

    await expect(storage.remove(objectKey)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([objectKey]);
  });

  it("removes a legacy per-artifact object key during cleanup", async () => {
    const remove = jest
      .fn()
      .mockResolvedValue({ data: [{ name: legacyObjectKey }], error: null });
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ remove }) } }),
    } as never);

    await expect(storage.remove(legacyObjectKey)).resolves.toBeUndefined();
    expect(remove).toHaveBeenCalledWith([legacyObjectKey]);
  });

  it("rejects deleting a non-content-addressed path before calling storage", async () => {
    const remove = jest.fn();
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ remove }) } }),
    } as never);

    await expect(
      storage.remove(`${organizationId}/mutable/security-update.bin`),
    ).rejects.toMatchObject({ code: "malformed" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("surfaces a storage removal failure as an unavailable provider error", async () => {
    const remove = jest
      .fn()
      .mockResolvedValue({ data: null, error: { message: "network error" } });
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ remove }) } }),
    } as never);

    await expect(storage.remove(objectKey)).rejects.toMatchObject({
      code: "unavailable",
    });
  });

  it("accepts a small text artifact when hash and size match but MIME probing is inconclusive", async () => {
    const bytes = Buffer.from("M2 V2 text update artifact\n");
    const download = jest.fn().mockResolvedValue({
      data: new Blob([bytes], { type: "text/plain" }),
      error: null,
    });
    const storage = new SupabaseProductComplianceStorageAdapter({
      admin: () => ({ storage: { from: () => ({ download }) } }),
    } as never);

    await expect(
      storage.inspect({
        objectKey,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        byteSize: bytes.byteLength,
        contentType: "text/plain",
      }),
    ).resolves.toEqual({
      outcome: "verified",
      sha256: createHash("sha256").update(bytes).digest("hex"),
      byteSize: bytes.byteLength,
      contentType: "text/plain",
    });
  });
});
