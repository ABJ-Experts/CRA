import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { staticScriptHashes } from "./operator-static-policy";
it("hashes only nonempty trusted HTML inline scripts and caps document size", async () => {
  const directory = await mkdtemp(join(tmpdir(), "operator-static-"));
  try {
    await mkdir(join(directory, "nested"));
    await writeFile(
      join(directory, "nested", "index.html"),
      "<script></script><script>one()</script>",
    );
    await writeFile(join(directory, "ignored.js"), "ignored()");
    expect(await staticScriptHashes(directory)).toHaveLength(1);
    await writeFile(
      join(directory, "oversized.html"),
      "x".repeat(2 * 1024 * 1024 + 1),
    );
    await expect(staticScriptHashes(directory)).rejects.toThrow(
      "page exceeds bound",
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
