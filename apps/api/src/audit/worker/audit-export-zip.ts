import { createHash } from "node:crypto";
import { Readable } from "node:stream";

export type ZipFile = Readonly<{ name: string; bytes: Buffer }>;
export type ZipBuild = Readonly<{
  stream: Readable;
  sha256: string;
  byteSize: number;
}>;

const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0);
    table[index] = value >>> 0;
  }
  return table;
})();

export function buildStoredZipStream(files: readonly ZipFile[]): ZipBuild {
  const chunks = Array.from(zipChunks(files));
  const bytes = Buffer.concat(chunks);
  return Object.freeze({
    stream: Readable.from(chunks),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    byteSize: bytes.byteLength,
  });
}

function* zipChunks(files: readonly ZipFile[]): Iterable<Buffer> {
  const ordered = [...files].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const seen = new Set<string>();
  const central: Buffer[] = [];
  let offset = 0;
  for (const file of ordered) {
    if (!/^[a-z0-9][a-z0-9._-]*$/i.test(file.name) || seen.has(file.name))
      throw new Error("unsafe archive path");
    seen.add(file.name);
    const path = Buffer.from(file.name, "utf8");
    const checksum = crc32(file.bytes);
    const local = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(checksum),
      u32(file.bytes.length),
      u32(file.bytes.length),
      u16(path.length),
      u16(0),
      path,
    ]);
    yield local;
    yield file.bytes;
    central.push(
      Buffer.concat([
        u32(0x02014b50),
        u16(20),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(checksum),
        u32(file.bytes.length),
        u32(file.bytes.length),
        u16(path.length),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(0),
        u32(offset),
        path,
      ]),
    );
    offset += local.byteLength + file.bytes.byteLength;
  }
  const centralBytes = Buffer.concat(central);
  yield centralBytes;
  yield Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(ordered.length),
    u16(ordered.length),
    u32(centralBytes.byteLength),
    u32(offset),
    u16(0),
  ]);
}

function crcEntry(index: number): number {
  return crcTable[index] as number;
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes)
    value = (value >>> 8) ^ crcEntry((value ^ byte) & 0xff);
  return (value ^ 0xffffffff) >>> 0;
}

function u16(value: number): Buffer {
  const output = Buffer.allocUnsafe(2);
  output.writeUInt16LE(value, 0);
  return output;
}

function u32(value: number): Buffer {
  const output = Buffer.allocUnsafe(4);
  output.writeUInt32LE(value >>> 0, 0);
  return output;
}
import { createReadStream, createWriteStream } from "node:fs";
import { stat } from "node:fs/promises";
import { finished } from "node:stream/promises";

export type ZipPathFile = Readonly<{ name: string; path: string }>;
export type ZipPathBuild = Readonly<{
  path: string;
  sha256: string;
  byteSize: number;
}>;

export async function buildStoredZipFile(
  input: Readonly<{
    files: readonly ZipPathFile[];
    outputPath: string;
    maximumBytes: number;
  }>,
): Promise<ZipPathBuild> {
  const ordered = [...input.files].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
  const measured: Array<ZipPathFile & { crc: number; byteSize: number }> = [];
  for (const file of ordered)
    measured.push({
      ...file,
      ...(await measureFile(file.path, input.maximumBytes)),
    });
  const target = createWriteStream(input.outputPath, {
    flags: "wx",
    mode: 0o600,
  });
  const hash = createHash("sha256");
  let byteSize = 0;
  const write = async (chunk: Buffer) => {
    byteSize += chunk.byteLength;
    if (byteSize > input.maximumBytes) throw new Error("export_limit");
    hash.update(chunk);
    if (!target.write(chunk))
      await new Promise<void>((resolve) =>
        target.once("drain", () => resolve()),
      );
  };
  const central: Buffer[] = [];
  let offset = 0;
  try {
    for (const file of measured) {
      if (!/^[a-z0-9][a-z0-9._-]*$/i.test(file.name))
        throw new Error("unsafe archive path");
      const pathBytes = Buffer.from(file.name, "utf8");
      const local = Buffer.concat([
        u32(0x04034b50),
        u16(20),
        u16(0),
        u16(0),
        u16(0),
        u16(0),
        u32(file.crc),
        u32(file.byteSize),
        u32(file.byteSize),
        u16(pathBytes.length),
        u16(0),
        pathBytes,
      ]);
      await write(local);
      for await (const chunk of createReadStream(file.path))
        await write(chunk as Buffer);
      central.push(
        Buffer.concat([
          u32(0x02014b50),
          u16(20),
          u16(20),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32(file.crc),
          u32(file.byteSize),
          u32(file.byteSize),
          u16(pathBytes.length),
          u16(0),
          u16(0),
          u16(0),
          u16(0),
          u32(0),
          u32(offset),
          pathBytes,
        ]),
      );
      offset += local.byteLength + file.byteSize;
    }
    const centralBytes = Buffer.concat(central);
    await write(centralBytes);
    await write(
      Buffer.concat([
        u32(0x06054b50),
        u16(0),
        u16(0),
        u16(ordered.length),
        u16(ordered.length),
        u32(centralBytes.byteLength),
        u32(offset),
        u16(0),
      ]),
    );
    target.end();
    await finished(target);
  } catch (error) {
    target.destroy();
    throw error;
  }
  const metadata = await stat(input.outputPath);
  return Object.freeze({
    path: input.outputPath,
    sha256: hash.digest("hex"),
    byteSize: metadata.size,
  });
}

async function measureFile(
  path: string,
  maximumBytes: number,
): Promise<Readonly<{ crc: number; byteSize: number }>> {
  let crc = 0xffffffff;
  let byteSize = 0;
  for await (const chunkValue of createReadStream(path)) {
    const chunk = chunkValue as Buffer;
    byteSize += chunk.byteLength;
    if (byteSize > maximumBytes) throw new Error("export_limit");
    for (const byte of chunk) crc = (crc >>> 8) ^ crcEntry((crc ^ byte) & 0xff);
  }
  return Object.freeze({ crc: (crc ^ 0xffffffff) >>> 0, byteSize });
}
