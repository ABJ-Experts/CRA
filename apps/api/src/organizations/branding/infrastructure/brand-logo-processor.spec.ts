import sharp from "sharp";

import { BrandLogoProcessor } from "./brand-logo-processor";

describe("BrandLogoProcessor", () => {
  const processor = new BrandLogoProcessor();

  it("normalizes a trusted raster image to metadata-stripped WebP", async () => {
    const input = await sharp({
      create: {
        width: 128,
        height: 96,
        channels: 4,
        background: "#336699",
      },
    })
      .png()
      .withMetadata()
      .toBuffer();

    const result = await processor.process(input, "image/png");
    const metadata = await sharp(result.bytes).metadata();

    expect(result).toMatchObject({
      width: 128,
      height: 96,
      inputBytes: input.byteLength,
    });
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.format).toBe("webp");
    expect(metadata.exif).toBeUndefined();
    expect(metadata.icc).toBeUndefined();
  });

  it("rejects declared MIME types that are not allowed for branding logos", async () => {
    await expect(
      processor.process(Buffer.from("<svg></svg>"), "image/svg+xml"),
    ).rejects.toMatchObject({ code: "invalid_mime" });
  });

  it("rejects spoofed raster content before upload", async () => {
    await expect(
      processor.process(Buffer.from("not a png"), "image/png"),
    ).rejects.toMatchObject({ code: "invalid_image" });
  });

  it("rejects valid raster bytes when the declared MIME does not match magic bytes", async () => {
    const input = await sharp({
      create: {
        width: 128,
        height: 128,
        channels: 4,
        background: "#336699",
      },
    })
      .jpeg()
      .toBuffer();

    await expect(processor.process(input, "image/png")).rejects.toMatchObject({
      code: "invalid_mime",
    });
  });

  it("rejects images below the minimum dimensions", async () => {
    const input = await sharp({
      create: {
        width: 32,
        height: 32,
        channels: 4,
        background: "#336699",
      },
    })
      .png()
      .toBuffer();

    await expect(processor.process(input, "image/png")).rejects.toMatchObject({
      code: "invalid_dimensions",
    });
  });

  it("rejects source payloads above the byte limit before decoding", async () => {
    await expect(
      processor.process(Buffer.alloc(2 * 1024 * 1024 + 1), "image/png"),
    ).rejects.toMatchObject({ code: "too_large" });
  });
});
