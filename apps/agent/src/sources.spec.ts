import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readCanonicalFilePage } from "./sources.js";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const record = { entityType: "product", externalId: "p-1", externalDisplayLabel: "Product", externalUpdatedAt: "2026-01-01T00:00:00.000Z", changeKind: "upsert", tombstoneReliability: "unknown", parentExternalId: null, fields: { name: "Product" } };

it("reads only complete canonical NDJSON records and detects file replacement", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-file-")); roots.push(root);
  const path = join(root, "source.ndjson");
  writeFileSync(path, JSON.stringify(record));
  expect((await readCanonicalFilePage(path, null, 200, 4096)).records).toEqual([]);
  appendFileSync(path, "\n");
  const page = await readCanonicalFilePage(path, null, 200, 4096);
  expect(page.records).toHaveLength(1);
  writeFileSync(path, "", { flag: "w" });
  await expect(readCanonicalFilePage(path, page.nextCursor, 200, 4096)).rejects.toThrow("source_truncated");
});

it("rejects invalid UTF-8 instead of silently replacing source bytes", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-utf8-")); roots.push(root);
  const path = join(root, "source.ndjson");
  writeFileSync(path, Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 0x0a]));
  await expect(readCanonicalFilePage(path, null, 200, 4096)).rejects.toThrow();
});
