import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

const maximumBytes = 2_147_483_647;

/** No object-store write occurs until the complete bounded stream is staged. */
export async function stageBoundedUpload(
  source: Readable,
  expectedBytes: number,
  signal?: AbortSignal,
) {
  if (
    !Number.isSafeInteger(expectedBytes) ||
    expectedBytes < 1 ||
    expectedBytes > maximumBytes
  )
    throw new Error("invalid_upload_size");
  const directory = await mkdtemp(join(tmpdir(), "cra-licence-upload-"));
  const path = join(directory, "object");
  const hash = createHash("sha256");
  let byteSize = 0;
  const probe: Buffer[] = [];
  let remaining = 8192;
  const bounded = new Transform({
    transform(value: Buffer, _encoding, done) {
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      byteSize += chunk.byteLength;
      if (byteSize > expectedBytes)
        return done(new Error("upload_length_mismatch"));
      hash.update(chunk);
      if (remaining > 0) {
        const part = Buffer.from(chunk.subarray(0, remaining));
        probe.push(part);
        remaining -= part.byteLength;
      }
      done(null, chunk);
    },
    flush(done) {
      done(
        byteSize === expectedBytes
          ? undefined
          : new Error("upload_length_mismatch"),
      );
    },
  });
  const dispose = () => rm(directory, { recursive: true, force: true });
  try {
    await pipeline(
      source,
      bounded,
      createWriteStream(path, { flags: "wx", mode: 0o600 }),
      { signal },
    );
    return Object.freeze({
      path,
      byteSize,
      sha256: hash.digest("hex"),
      probe: Buffer.concat(probe),
      dispose,
    });
  } catch (error) {
    await dispose();
    throw error;
  }
}
