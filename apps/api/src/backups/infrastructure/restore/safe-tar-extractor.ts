import { constants } from "node:fs";
import { open, mkdir, lstat } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { assertRecoveryArchiveEntry } from "./restore-safety";

function text(bytes: Buffer): string {
  const end = bytes.indexOf(0);
  return bytes.subarray(0, end < 0 ? bytes.length : end).toString("utf8");
}
function octal(bytes: Buffer): number {
  const value = text(bytes).trim();
  if (!/^[0-7]+$/.test(value)) throw new Error("recovery_archive_unsafe");
  const parsed = Number.parseInt(value, 8);
  if (!Number.isSafeInteger(parsed)) throw new Error("recovery_archive_unsafe");
  return parsed;
}
async function privateDirectories(root: string, path: string): Promise<void> {
  const target = resolve(path);
  if (target !== root && !target.startsWith(root + sep))
    throw new Error("recovery_archive_unsafe");
  const relative = target.slice(root.length).split(sep).filter(Boolean);
  await mkdir(root, { mode: 0o700, recursive: true });
  for (let depth = 0; depth <= relative.length; depth += 1) {
    const directory = join(root, ...relative.slice(0, depth));
    await mkdir(directory, { mode: 0o700 }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      },
    );
    const stat = await lstat(directory);
    if (!stat.isDirectory() || stat.isSymbolicLink())
      throw new Error("recovery_archive_unsafe");
  }
}

/** Extract only after complete ciphertext authentication. No native tar parser or link following. */
export async function extractRecoveryTar(
  archive: string,
  destination: string,
  limits: { readonly maxEntries: number; readonly maxExpandedBytes: number },
  signal?: AbortSignal,
): Promise<{ readonly entries: number; readonly bytes: number }> {
  signal?.throwIfAborted();
  const source = await open(archive, constants.O_RDONLY | constants.O_NOFOLLOW);
  const root = resolve(destination);
  let offset = 0;
  let count = 0;
  let expanded = 0;
  // A private cursor index; no caller-owned state escapes or changes.
  const seen = new Set<string>();
  const read = async (size: number): Promise<Buffer> => {
    const bytes = Buffer.alloc(size);
    const result = await source.read(bytes, 0, size, offset);
    offset += result.bytesRead;
    if (result.bytesRead !== size) throw new Error("recovery_archive_unsafe");
    return bytes;
  };
  try {
    const archiveSize = (await source.stat()).size;
    if (
      archiveSize >
      limits.maxExpandedBytes + limits.maxEntries * 1024 + 1024 * 1024
    )
      throw new Error("recovery_archive_unsafe");
    while (offset < archiveSize) {
      signal?.throwIfAborted();
      const header = await read(512);
      if (header.every((byte) => byte === 0)) {
        if (!(await read(512)).every((byte) => byte === 0))
          throw new Error("recovery_archive_unsafe");
        while (offset < archiveSize)
          if (
            !(await read(Math.min(65536, archiveSize - offset))).every(
              (byte) => byte === 0,
            )
          )
            throw new Error("recovery_archive_unsafe");
        return { entries: count, bytes: expanded };
      }
      const stored = octal(header.subarray(148, 156));
      const sum = header.reduce(
        (total, byte, index) =>
          total + (index >= 148 && index < 156 ? 32 : byte),
        0,
      );
      if (sum !== stored) throw new Error("recovery_archive_unsafe");
      const prefix = text(header.subarray(345, 500));
      const name = [prefix, text(header.subarray(0, 100))]
        .filter(Boolean)
        .join("/");
      const kind = text(header.subarray(156, 157));
      const size = octal(header.subarray(124, 136));
      if ((name === "." || name === "./") && kind === "5" && size === 0)
        continue;
      if (count >= limits.maxEntries)
        throw new Error("recovery_archive_unsafe");
      const normalized = assertRecoveryArchiveEntry(
        {
          path: name,
          type:
            kind === "5"
              ? "directory"
              : kind === "0" || kind === ""
                ? "file"
                : "rejected",
          size,
        },
        seen,
        expanded,
        limits.maxExpandedBytes,
      );
      seen.add(normalized);
      const target = join(root, normalized);
      if (kind === "5") {
        if (size !== 0) throw new Error("recovery_archive_unsafe");
        await privateDirectories(root, target);
      } else {
        await privateDirectories(root, dirname(target));
        const output = await open(
          target,
          constants.O_WRONLY |
            constants.O_CREAT |
            constants.O_EXCL |
            constants.O_NOFOLLOW,
          0o600,
        );
        try {
          let remaining = size;
          while (remaining > 0) {
            signal?.throwIfAborted();
            const chunk = await read(Math.min(65536, remaining));
            await output.write(chunk);
            remaining -= chunk.length;
          }
          await output.sync();
        } finally {
          await output.close();
        }
        if (size % 512) await read(512 - (size % 512));
        expanded += size;
      }
      count += 1;
    }
    throw new Error("recovery_archive_unsafe");
  } finally {
    await source.close();
  }
}
