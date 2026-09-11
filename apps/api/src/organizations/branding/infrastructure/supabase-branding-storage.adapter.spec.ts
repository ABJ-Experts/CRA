import { createHash } from "node:crypto";

import sharp from "sharp";

import { BrandingProviderError } from "../application/branding-use-cases";
import { SupabaseBrandingStorageAdapter } from "./supabase-branding-storage.adapter";

async function normalizedWebp(): Promise<Buffer> {
  return sharp({
    create: {
      width: 64,
      height: 64,
      channels: 4,
      background: "#336699",
    },
  })
    .webp()
    .toBuffer();
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

describe("SupabaseBrandingStorageAdapter", () => {
  it("uploads normalized WebP bytes into the private branding bucket without upsert", async () => {
    const upload = jest
      .fn()
      .mockResolvedValue({ data: { path: "ok" }, error: null });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ upload }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(
      adapter.upload("org/asset.webp", Buffer.from("webp"), "image/webp"),
    ).resolves.toBeUndefined();

    expect(upload).toHaveBeenCalledWith("org/asset.webp", Buffer.from("webp"), {
      contentType: "image/webp",
      cacheControl: "31536000",
      upsert: false,
    });
  });

  it("removes a private object key during compensation", async () => {
    const remove = jest.fn().mockResolvedValue({ data: [], error: null });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ remove }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(adapter.remove("org/asset.webp")).resolves.toBeUndefined();

    expect(remove).toHaveBeenCalledWith(["org/asset.webp"]);
  });

  it("downloads approved WebP bytes without creating a signed URL", async () => {
    const bytes = await normalizedWebp();
    const download = jest.fn().mockResolvedValue({
      data: new Blob([bytes], { type: "image/webp" }),
      error: null,
    });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ download }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(
      adapter.download("org/asset.webp", sha256(bytes)),
    ).resolves.toEqual({
      outcome: "found",
      bytes,
      mimeType: "image/webp",
    });
    expect(download).toHaveBeenCalledWith("org/asset.webp");
  });

  it("returns not found for a missing private object during render", async () => {
    const download = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "not found" },
    });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ download }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(
      adapter.download("org/missing.webp", "a".repeat(64)),
    ).resolves.toEqual({
      outcome: "not_found",
    });
  });

  it("rejects private bytes whose hash does not match the approved asset", async () => {
    const bytes = await normalizedWebp();
    const download = jest.fn().mockResolvedValue({
      data: new Blob([bytes], { type: "image/webp" }),
      error: null,
    });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ download }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(
      adapter.download("org/asset.webp", "b".repeat(64)),
    ).rejects.toEqual(new BrandingProviderError("malformed"));
  });

  it("rejects a non-WebP private object even when its recorded hash matches", async () => {
    const bytes = await sharp({
      create: {
        width: 64,
        height: 64,
        channels: 4,
        background: "#336699",
      },
    })
      .jpeg()
      .toBuffer();
    const download = jest.fn().mockResolvedValue({
      data: new Blob([bytes], { type: "image/jpeg" }),
      error: null,
    });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ download }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(
      adapter.download("org/asset.webp", sha256(bytes)),
    ).rejects.toEqual(new BrandingProviderError("malformed"));
  });

  it("does not turn private-storage outages into not-found responses", async () => {
    const download = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "bucket is unavailable", statusCode: "500" },
    });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ download }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(
      adapter.download("org/asset.webp", "a".repeat(64)),
    ).rejects.toEqual(new BrandingProviderError("unavailable"));
  });

  it("maps storage failures to safe provider errors", async () => {
    const upload = jest.fn().mockResolvedValue({
      data: null,
      error: { message: "bucket missing" },
    });
    const supabase = {
      admin: () => ({
        storage: {
          from: jest.fn().mockReturnValue({ upload }),
        },
      }),
    };
    const adapter = new SupabaseBrandingStorageAdapter(supabase as never);

    await expect(
      adapter.upload("org/asset.webp", Buffer.from("webp"), "image/webp"),
    ).rejects.toEqual(new BrandingProviderError("unavailable"));
  });
});
