import { randomBytes, randomUUID } from "node:crypto";
import { link, readFile, unlink, writeFile } from "node:fs/promises";
import { z } from "zod";
const configuration = z
  .object({
    activeKeyId: z.literal("siem-browser-fixture"),
    keys: z.record(z.string(), z.string()).refine(
      (keys) =>
        Object.hasOwn(keys, "siem-browser-fixture") &&
        Object.keys(keys).length <= 64 &&
        Object.values(keys).every((value) => {
          const decoded = Buffer.from(value, "base64");
          return (
            decoded.byteLength === 32 && decoded.toString("base64") === value
          );
        }),
    ),
  })
  .strict();
function validate(raw: string): string {
  try {
    configuration.parse(JSON.parse(raw));
    return raw;
  } catch {
    throw new Error(
      "Invalid SIEM fixture keyring; existing file was preserved",
    );
  }
}
function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}
/** Test-only persisted keyring. Atomic exclusive publication never replaces an existing key. */
export async function loadSiemFixtureKeyring(path: string): Promise<string> {
  try {
    return validate(await readFile(path, "utf8"));
  } catch (error) {
    if (code(error) !== "ENOENT") throw error;
  }
  const candidate = JSON.stringify({
    activeKeyId: "siem-browser-fixture",
    keys: { "siem-browser-fixture": randomBytes(32).toString("base64") },
  });
  const temporary = `${path}.${randomUUID()}.new`;
  await writeFile(temporary, candidate, { mode: 0o600, flag: "wx" });
  try {
    try {
      await link(temporary, path);
    } catch (error) {
      if (code(error) !== "EEXIST") throw error;
    }
    return validate(await readFile(path, "utf8"));
  } finally {
    await unlink(temporary);
  }
}
