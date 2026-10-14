import { readdir, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
/** Hash trusted static export hydration scripts without permitting arbitrary inline code. */
export async function staticScriptHashes(root: string): Promise<string[]> {
  const files = await readdir(root, { withFileTypes: true, recursive: true });
  if (files.length > 20_000)
    throw new Error("Operator static export exceeds bound");
  const hashes = new Set<string>();
  for (const file of files.filter(
    (entry) => entry.isFile() && entry.name.endsWith(".html"),
  )) {
    const html = await readFile(join(file.parentPath, file.name), "utf8");
    if (Buffer.byteLength(html) > 2 * 1024 * 1024)
      throw new Error("Operator static page exceeds bound");
    for (const script of html.matchAll(
      /<script\b[^>]*>([\s\S]*?)<\/script>/gi,
    )) {
      if (script[1])
        hashes.add(
          `'sha256-${createHash("sha256").update(script[1]).digest("base64")}'`,
        );
    }
  }
  return [...hashes];
}
