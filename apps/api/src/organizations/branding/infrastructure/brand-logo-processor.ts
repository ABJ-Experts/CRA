import { createHash } from "node:crypto";

import { fromBuffer as fileTypeFromBuffer } from "file-type";
import sharp from "sharp";
import {
  BRANDING_MAX_LOGO_BYTES,
  BRANDING_MAX_LOGO_DIMENSION_PIXELS,
  BRANDING_MAX_LOGO_PIXELS,
  BRANDING_MIN_LOGO_DIMENSION_PIXELS,
} from "@repo/contracts/organizations";

import type {
  LogoProcessorPort,
  ProcessedLogo,
} from "../application/branding-use-cases";

type LogoProcessingErrorCode =
  "too_large" | "invalid_mime" | "invalid_image" | "invalid_dimensions";

export class LogoProcessingError extends Error {
  readonly name = "LogoProcessingError";

  constructor(readonly code: LogoProcessingErrorCode) {
    super(code);
  }
}

const allowedMimeTypes = new Set(["image/png", "image/jpeg", "image/webp"]);

export class BrandLogoProcessor implements LogoProcessorPort {
  async process(
    bytes: Buffer,
    declaredMimeType: string,
  ): Promise<ProcessedLogo> {
    if (bytes.byteLength > BRANDING_MAX_LOGO_BYTES) {
      throw new LogoProcessingError("too_large");
    }
    if (!allowedMimeTypes.has(declaredMimeType)) {
      throw new LogoProcessingError("invalid_mime");
    }
    const detected = await fileTypeFromBuffer(bytes);
    if (!detected) {
      throw new LogoProcessingError("invalid_image");
    }
    if (
      !allowedMimeTypes.has(detected.mime) ||
      detected.mime !== declaredMimeType
    ) {
      throw new LogoProcessingError("invalid_mime");
    }

    let image = sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: BRANDING_MAX_LOGO_PIXELS,
    });
    let metadata: sharp.Metadata;
    try {
      metadata = await image.metadata();
    } catch {
      throw new LogoProcessingError("invalid_image");
    }
    if (!metadata.width || !metadata.height) {
      throw new LogoProcessingError("invalid_image");
    }
    if (
      metadata.width < BRANDING_MIN_LOGO_DIMENSION_PIXELS ||
      metadata.height < BRANDING_MIN_LOGO_DIMENSION_PIXELS ||
      metadata.width > BRANDING_MAX_LOGO_DIMENSION_PIXELS ||
      metadata.height > BRANDING_MAX_LOGO_DIMENSION_PIXELS ||
      metadata.width * metadata.height > BRANDING_MAX_LOGO_PIXELS
    ) {
      throw new LogoProcessingError("invalid_dimensions");
    }
    if (!["png", "jpeg", "webp"].includes(metadata.format ?? "")) {
      throw new LogoProcessingError("invalid_image");
    }

    image = sharp(bytes, {
      animated: false,
      failOn: "warning",
      limitInputPixels: BRANDING_MAX_LOGO_PIXELS,
    }).rotate();
    const output = await image.webp({ quality: 90, effort: 4 }).toBuffer();
    return Object.freeze({
      bytes: output,
      width: metadata.width,
      height: metadata.height,
      sha256: createHash("sha256").update(output).digest("hex"),
      inputBytes: bytes.byteLength,
    });
  }
}
