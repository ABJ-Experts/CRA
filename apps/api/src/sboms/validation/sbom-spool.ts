import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SbomNormalizationError } from "../normalization/sbom-normalizer";

/** A private, bounded temporary copy enables local streaming schema passes.
 * It is never a replacement evidence store and is removed on every outcome. */
export async function withSbomSpool<T>(
  source: AsyncIterable<Uint8Array>,
  maximumBytes: number,
  consume: (path: string) => Promise<T>,
  heartbeat?: () => Promise<void>,
): Promise<T> {
  let directory: string | undefined;
  try {
    directory = await mkdtemp(join(tmpdir(), "cra-sbom-"));
    const path = join(directory, "original");
    const file = await open(path, "wx", 0o600);
    let bytes = 0;
    let lastHeartbeat = Date.now();
    try {
      for await (const chunk of source) {
        bytes += chunk.byteLength;
        if (bytes > maximumBytes)
          throw new SbomNormalizationError(
            "normalization_byte_limit_exceeded",
            "SBOM exceeds the configured byte ceiling.",
          );
        // FileHandle.write can perform a short write; never discard its tail.
        let offset = 0;
        while (offset < chunk.byteLength) {
          const written = (
            await file.write(chunk, offset, chunk.byteLength - offset)
          ).bytesWritten;
          if (written === 0)
            throw new Error("Temporary SBOM write made no progress.");
          offset += written;
        }
        if (heartbeat && Date.now() - lastHeartbeat >= 15_000) {
          await heartbeat();
          lastHeartbeat = Date.now();
        }
      }
    } finally {
      await file.close();
    }
    return await consume(path);
  } finally {
    if (source instanceof Readable) source.destroy();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
}

export function openSbomSpool(path: string) {
  return createReadStream(path, { highWaterMark: 16 * 1024 });
}
