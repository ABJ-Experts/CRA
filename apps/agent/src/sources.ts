import { lookup } from "node:dns/promises";
import { constants, closeSync, fstatSync, openSync, readSync } from "node:fs";
import { request } from "node:https";
import { isIP } from "node:net";
import { connectorExternalRecordSchema } from "@repo/contracts/connectors/schemas";
import { z } from "zod";

const fileCursorSchema = z.object({ device: z.number().int(), inode: z.number().int(), offset: z.number().int().nonnegative() }).strict();
const httpsPageSchema = z.object({
  records: z.array(connectorExternalRecordSchema).max(200),
  nextCursor: z.string().min(1).max(1024).nullable(),
}).strict();
const utf8 = new TextDecoder("utf-8", { fatal: true });
export type SourcePage = Readonly<{ records: readonly z.output<typeof connectorExternalRecordSchema>[]; nextCursor: string | null }>;

export async function readCanonicalFilePage(path: string, cursor: string | null, maxRecords: number, maxBytes: number): Promise<SourcePage> {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > 200 || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024) throw new Error("invalid_page_limit");
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("source_not_regular_file");
    const prior = cursor === null ? null : fileCursorSchema.parse(JSON.parse(cursor) as unknown);
    if (prior && (prior.device !== stat.dev || prior.inode !== stat.ino)) throw new Error("source_replaced");
    const offset = prior?.offset ?? 0;
    if (offset > stat.size) throw new Error("source_truncated");
    const chunk = Buffer.alloc(Math.min(maxBytes + 1, 4 * 1024 * 1024 + 1));
    const count = readSync(fd, chunk, 0, chunk.length, offset);
    const records: z.output<typeof connectorExternalRecordSchema>[] = [];
    let consumed = 0;
    while (records.length < maxRecords) {
      const newline = chunk.indexOf(10, consumed);
      if (newline < 0 || newline >= count) break;
      if (newline - consumed > maxBytes || newline + 1 > maxBytes) break;
      const rawLine = utf8.decode(chunk.subarray(consumed, newline));
      if (rawLine.length === 0) throw new Error("empty_source_record");
      records.push(connectorExternalRecordSchema.parse(JSON.parse(rawLine) as unknown));
      consumed = newline + 1;
    }
    if (records.length === 0 && count > maxBytes) throw new Error("source_record_too_large");
    if (records.length === 0) return { records, nextCursor: cursor };
    return { records, nextCursor: JSON.stringify({ device: stat.dev, inode: stat.ino, offset: offset + consumed }) };
  } finally {
    closeSync(fd);
  }
}

export type HttpsSource = Readonly<{
  url: string;
  allowedHost: string;
  allowedAddresses: readonly string[];
  caPem?: string;
  authorization?: string;
}>;

/** Requests only one configured HTTPS origin, through an explicitly approved resolved IP. */
export async function readCanonicalHttpsPage(source: HttpsSource, cursor: string | null, maxBytes: number, timeoutMs: number): Promise<SourcePage> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > 4 * 1024 * 1024 || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) throw new Error("invalid_page_limit");
  const url = new URL(source.url);
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash || url.hostname !== source.allowedHost || source.allowedAddresses.length === 0 || source.allowedAddresses.some((value) => !isIP(value))) throw new Error("source_not_allowlisted");
  const addresses = await lookup(url.hostname, { all: true, verbatim: true });
  const approved = addresses.find((item) => source.allowedAddresses.includes(item.address));
  if (!approved || addresses.some((item) => !source.allowedAddresses.includes(item.address))) throw new Error("source_dns_mismatch");
  if (cursor !== null) url.searchParams.set("cursor", cursor);
  return await new Promise<SourcePage>((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      timeout: timeoutMs,
      ca: source.caPem,
      rejectUnauthorized: true,
      headers: source.authorization ? { Authorization: source.authorization, Accept: "application/json" } : { Accept: "application/json" },
      lookup: (_host, _options, callback) => callback(null, approved.address, approved.family),
    }, (res) => {
      if (res.statusCode !== 200 || res.headers.location) { res.resume(); reject(new Error("source_http_error")); return; }
      const parts: Buffer[] = [];
      let bytes = 0;
      res.on("data", (part: Buffer) => {
        bytes += part.length;
        if (bytes > maxBytes) { res.destroy(); req.destroy(); reject(new Error("source_page_too_large")); return; }
        parts.push(part);
      });
      res.on("end", () => {
        try {
          const page = httpsPageSchema.parse(JSON.parse(utf8.decode(Buffer.concat(parts))) as unknown);
          if (page.records.length > 0 && page.nextCursor === null) throw new Error("missing_source_cursor");
          resolve(page);
        } catch { reject(new Error("invalid_source_page")); }
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("source_timeout")));
    req.on("error", reject);
    req.end();
  });
}
