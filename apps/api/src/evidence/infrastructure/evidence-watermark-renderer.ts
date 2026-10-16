import { readFile } from "node:fs/promises";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, degrees, rgb, type PDFFont } from "pdf-lib";
import sharp from "sharp";

const maximumBytes = 50 * 1024 * 1024;
const maximumPdfPages = 200;
const fontPackages = Object.freeze({
  latin: "@fontsource/noto-sans/files/noto-sans-latin-ext-400-normal.woff",
  cyrillic:
    "@fontsource/noto-sans/files/noto-sans-cyrillic-ext-400-normal.woff",
  greek: "@fontsource/noto-sans/files/noto-sans-greek-ext-400-normal.woff",
  devanagari:
    "@fontsource/noto-sans/files/noto-sans-devanagari-400-normal.woff",
});
type FontKind = keyof typeof fontPackages;
type SupportedMediaType =
  "application/pdf" | "image/jpeg" | "image/png" | "image/webp";

export class EvidenceWatermarkRenderError extends Error {
  constructor(
    readonly code:
      | "unsupported_media_type"
      | "source_unavailable"
      | "source_integrity_failed"
      | "output_limit"
      | "renderer_unavailable"
      | "page_limit",
  ) {
    super(code);
  }
}

/**
 * Renders a derivative only.  It never writes or changes original evidence;
 * callers bind the produced hash to the immutable source version separately.
 */
export class EvidenceWatermarkRenderer {
  async render(
    input: Readonly<{
      bytes: Buffer;
      mediaType: string;
      recipient: string;
      purpose: string;
      exportedAt: string;
    }>,
  ): Promise<Readonly<{ bytes: Buffer; mediaType: SupportedMediaType }>> {
    if (!isSupportedMediaType(input.mediaType))
      throw new EvidenceWatermarkRenderError("unsupported_media_type");
    if (input.bytes.byteLength < 1 || input.bytes.byteLength > maximumBytes)
      throw new EvidenceWatermarkRenderError("source_unavailable");
    const label = watermarkLabel(input);
    const kinds = requiredFonts(label);
    if (!kinds) throw new EvidenceWatermarkRenderError("renderer_unavailable");
    const fonts = await loadFonts(kinds);
    const bytes =
      input.mediaType === "application/pdf"
        ? await renderPdf(input.bytes, label, fonts)
        : await renderImage(input.bytes, input.mediaType, label, fonts);
    if (bytes.byteLength > maximumBytes)
      throw new EvidenceWatermarkRenderError("output_limit");
    return Object.freeze({ bytes, mediaType: input.mediaType });
  }
}

function isSupportedMediaType(value: string): value is SupportedMediaType {
  return ["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(
    value,
  );
}

function watermarkLabel(input: {
  recipient: string;
  purpose: string;
  exportedAt: string;
}) {
  return `RECIPIENT: ${input.recipient}\nPURPOSE: ${input.purpose}\nEXPORTED: ${input.exportedAt}`;
}

async function renderPdf(
  bytes: Buffer,
  label: string,
  fontBytes: ReadonlyMap<FontKind, Buffer>,
): Promise<Buffer> {
  let document: PDFDocument;
  try {
    document = await PDFDocument.load(bytes, {
      ignoreEncryption: false,
      updateMetadata: false,
    });
  } catch {
    throw new EvidenceWatermarkRenderError("source_integrity_failed");
  }
  const pages = document.getPages();
  if (pages.length < 1 || pages.length > maximumPdfPages)
    throw new EvidenceWatermarkRenderError("page_limit");
  document.registerFontkit(fontkit);
  const fonts = new Map<FontKind, PDFFont>();
  for (const [kind, source] of fontBytes)
    fonts.set(kind, await document.embedFont(source, { subset: true }));
  // Encode every character before writing any page. This turns an unsupported
  // glyph into an explicit policy failure rather than a damaged derivative.
  preflightGlyphs(label, fonts);
  for (const page of pages) {
    const { width, height } = page.getSize();
    const size = Math.max(9, Math.min(width, height) / 34);
    const lines = wrapLabel(label, fonts, size, Math.min(width, height) * 0.72);
    const startY = Math.max(
      height * 0.18,
      (height + lines.length * size * 1.35) / 2,
    );
    for (const [lineIndex, line] of lines.entries()) {
      let x = Math.max(
        width * 0.08,
        (width - lineWidth(line, fonts, size)) / 2,
      );
      const y = startY - lineIndex * size * 1.35;
      for (const segment of segments(line)) {
        const font = fontFor(segment, fonts);
        page.drawText(segment, {
          x,
          y,
          size,
          font,
          color: rgb(0.2, 0.2, 0.2),
          opacity: 0.28,
          rotate: degrees(-28),
        });
        x += font.widthOfTextAtSize(segment, size);
      }
    }
  }
  try {
    return Buffer.from(await document.save({ useObjectStreams: true }));
  } catch {
    throw new EvidenceWatermarkRenderError("source_integrity_failed");
  }
}

async function renderImage(
  bytes: Buffer,
  mediaType: Exclude<SupportedMediaType, "application/pdf">,
  label: string,
  fontBytes: ReadonlyMap<FontKind, Buffer>,
): Promise<Buffer> {
  try {
    const image = sharp(bytes, { animated: true }).rotate();
    const metadata = await image.metadata();
    if (
      !metadata.width ||
      !metadata.height ||
      (metadata.pages !== undefined && metadata.pages > 1)
    )
      throw new EvidenceWatermarkRenderError("source_unavailable");
    const overlay = Buffer.from(
      watermarkSvg(metadata.width, metadata.height, label, fontBytes),
    );
    const composed = image.composite([{ input: overlay, gravity: "centre" }]);
    switch (mediaType) {
      case "image/jpeg":
        return await composed.jpeg({ quality: 92, mozjpeg: true }).toBuffer();
      case "image/png":
        return await composed.png({ compressionLevel: 9 }).toBuffer();
      case "image/webp":
        return await composed.webp({ quality: 92 }).toBuffer();
    }
  } catch (error) {
    if (error instanceof EvidenceWatermarkRenderError) throw error;
    throw new EvidenceWatermarkRenderError("source_integrity_failed");
  }
}

function watermarkSvg(
  width: number,
  height: number,
  label: string,
  fontBytes: ReadonlyMap<FontKind, Buffer>,
) {
  const size = Math.max(12, Math.min(width, height) / 26);
  const fontFaces = [...fontBytes]
    .map(
      ([kind, bytes]) =>
        `@font-face{font-family:'Evidence ${kind}';src:url(data:font/woff;base64,${bytes.toString("base64")}) format('woff');}`,
    )
    .join("");
  const fonts = [...fontBytes.keys()]
    .map((kind) => `'Evidence ${kind}'`)
    .join(",");
  const text = label
    .split("\n")
    .map(
      (line, index) =>
        `<tspan x="${width / 2}" dy="${index === 0 ? 0 : size * 1.4}">${xml(line)}</tspan>`,
    )
    .join("");
  return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><style>${fontFaces}</style><g transform="rotate(-28 ${width / 2} ${height / 2})"><text x="${width / 2}" y="${height / 2 - size}" text-anchor="middle" fill="#1f2937" fill-opacity="0.30" font-size="${size}" font-family="${fonts},sans-serif" font-weight="400">${text}</text></g></svg>`;
}

function xml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function requiredFonts(value: string): readonly FontKind[] | null {
  const found = new Set<FontKind>(["latin"]);
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point <= 0x024f || /[\p{P}\p{Z}\p{N}]/u.test(character)) continue;
    if (point >= 0x0370 && point <= 0x03ff) found.add("greek");
    else if (point >= 0x0400 && point <= 0x052f) found.add("cyrillic");
    else if (point >= 0x0900 && point <= 0x097f) found.add("devanagari");
    else return null;
  }
  return [...found];
}

function segments(value: string): readonly string[] {
  const result: string[] = [];
  let segment = "";
  let current: FontKind | null = null;
  for (const character of value) {
    const kind = fontKind(character);
    if (current !== null && current !== kind) {
      result.push(segment);
      segment = "";
    }
    segment += character;
    current = kind;
  }
  if (segment) result.push(segment);
  return result;
}

function fontKind(value: string): FontKind {
  const point = value.codePointAt(0) ?? 0;
  if (point >= 0x0370 && point <= 0x03ff) return "greek";
  if (point >= 0x0400 && point <= 0x052f) return "cyrillic";
  if (point >= 0x0900 && point <= 0x097f) return "devanagari";
  return "latin";
}

function fontFor(value: string, fonts: ReadonlyMap<FontKind, PDFFont>) {
  const font = fonts.get(fontKind(value[0] ?? ""));
  if (!font) throw new EvidenceWatermarkRenderError("renderer_unavailable");
  return font;
}

function preflightGlyphs(value: string, fonts: ReadonlyMap<FontKind, PDFFont>) {
  for (const character of value) {
    if (character === "\n") continue;
    try {
      fontFor(character, fonts).encodeText(character);
    } catch {
      throw new EvidenceWatermarkRenderError("renderer_unavailable");
    }
  }
}

function wrapLabel(
  label: string,
  fonts: ReadonlyMap<FontKind, PDFFont>,
  size: number,
  maxWidth: number,
): readonly string[] {
  const lines: string[] = [];
  for (const source of label.split("\n")) {
    let line = "";
    for (const token of source.split(/(\s+)/u)) {
      for (const word of splitToWidth(token, fonts, size, maxWidth)) {
        const candidate = `${line}${word}`;
        if (line && lineWidth(candidate, fonts, size) > maxWidth) {
          lines.push(line.trimEnd());
          line = word.trimStart();
        } else line = candidate;
      }
    }
    if (line) lines.push(line.trimEnd());
  }
  if (lines.length > 12)
    throw new EvidenceWatermarkRenderError("renderer_unavailable");
  return lines;
}

function splitToWidth(
  value: string,
  fonts: ReadonlyMap<FontKind, PDFFont>,
  size: number,
  maxWidth: number,
) {
  if (lineWidth(value, fonts, size) <= maxWidth) return [value];
  const chunks: string[] = [];
  let chunk = "";
  for (const character of value) {
    const candidate = `${chunk}${character}`;
    if (chunk && lineWidth(candidate, fonts, size) > maxWidth) {
      chunks.push(chunk);
      chunk = character;
    } else chunk = candidate;
  }
  if (chunk) chunks.push(chunk);
  return chunks;
}

function lineWidth(
  line: string,
  fonts: ReadonlyMap<FontKind, PDFFont>,
  size: number,
) {
  return segments(line).reduce(
    (width, segment) =>
      width + fontFor(segment, fonts).widthOfTextAtSize(segment, size),
    0,
  );
}

const loadedFonts = new Map<FontKind, Promise<Buffer>>();
function loadFonts(kinds: readonly FontKind[]) {
  return Promise.all(
    kinds.map(async (kind) => [kind, await loadFont(kind)] as const),
  ).then((entries) => new Map(entries));
}
function loadFont(kind: FontKind): Promise<Buffer> {
  const existing = loadedFonts.get(kind);
  if (existing) return existing;
  // resolve keeps the font package in the production dependency graph. The
  // worker never falls back to a host-installed font, which keeps results
  // deterministic across environments.
  const loaded = readFile(require.resolve(fontPackages[kind]));
  loadedFonts.set(kind, loaded);
  return loaded;
}
