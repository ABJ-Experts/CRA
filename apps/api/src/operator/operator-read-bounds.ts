import { open } from "node:fs/promises";
/** Pre-stat the opened mount and cap reads even if it grows after stat. */
export async function readBoundedFile(
  path: string,
  limit: number,
  privateFile = false,
): Promise<Buffer> {
  const file = await open(path, "r");
  try {
    const details = await file.stat();
    if (!details.isFile() || details.size > limit)
      throw new Error("Operator mount exceeds bound");
    if (privateFile && (details.mode & 0o077) !== 0)
      throw new Error("Invalid operator mount permissions");
    const buffer = Buffer.alloc(limit + 1);
    let offset = 0;
    while (offset <= limit) {
      const result = await file.read(
        buffer,
        offset,
        Math.min(64 * 1024, limit + 1 - offset),
        null,
      );
      if (result.bytesRead === 0) return buffer.subarray(0, offset);
      offset += result.bytesRead;
    }
    throw new Error("Operator mount exceeds bound");
  } finally {
    await file.close();
  }
}
/** Cancellation is part of the bound, including responses without length headers. */
export async function readBoundedJson(
  response: Response,
  limit: number,
): Promise<unknown> {
  const body = response.body;
  if (!body) throw new Error("Operator response is empty");
  if (Number(response.headers.get("content-length") ?? 0) > limit) {
    await body.cancel();
    throw new Error("Operator response exceeds bound");
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      const value: unknown = result.value;
      if (!(value instanceof Uint8Array))
        throw new Error("Invalid operator response chunk");
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new Error("Operator response exceeds bound");
      }
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks, bytes).toString("utf8"));
  } finally {
    reader.releaseLock();
  }
}
