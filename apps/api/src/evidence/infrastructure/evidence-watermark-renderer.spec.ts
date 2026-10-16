import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import {
  EvidenceWatermarkRenderError,
  EvidenceWatermarkRenderer,
} from "./evidence-watermark-renderer";

describe("EvidenceWatermarkRenderer", () => {
  const renderer = new EvidenceWatermarkRenderer();

  it("stamps every PDF page using bundled Unicode-capable fonts", async () => {
    const source = await PDFDocument.create();
    source.addPage([612, 792]);
    source.addPage([792, 612]);
    const result = await renderer.render({
      bytes: Buffer.from(await source.save()),
      mediaType: "application/pdf",
      recipient: "Renée Αλέξης",
      purpose: "External review",
      exportedAt: "2026-09-21T12:00:00.000Z",
    });
    expect(result.mediaType).toBe("application/pdf");
    expect(result.bytes.equals(Buffer.from(await source.save()))).toBe(false);
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2);
  });

  it("preserves a supported image as a distinct stamped derivative", async () => {
    const source = await sharp({
      create: { width: 320, height: 180, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    const result = await renderer.render({
      bytes: source,
      mediaType: "image/png",
      recipient: "Søren",
      purpose: "Review",
      exportedAt: "2026-09-21T12:00:00.000Z",
    });
    expect(result.mediaType).toBe("image/png");
    expect(result.bytes.equals(source)).toBe(false);
    expect((await sharp(result.bytes).metadata()).format).toBe("png");
  });

  it("fails closed for unrenderable watermark glyphs", async () => {
    const source = await sharp({
      create: { width: 32, height: 32, channels: 3, background: "white" },
    })
      .png()
      .toBuffer();
    await expect(
      renderer.render({
        bytes: source,
        mediaType: "image/png",
        recipient: "Recipient 😀",
        purpose: "Review",
        exportedAt: "2026-09-21T12:00:00.000Z",
      }),
    ).rejects.toEqual(new EvidenceWatermarkRenderError("renderer_unavailable"));
  });
});
