import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { readCanonicalHttpsPage } from "./sources.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const record = { entityType: "product", externalId: "p-1", externalDisplayLabel: "Product", externalUpdatedAt: "2026-01-01T00:00:00.000Z", changeKind: "upsert", tombstoneReliability: "unknown", parentExternalId: null, fields: { name: "Product" } };

it("pins HTTPS DNS/TLS and rejects redirects, missing cursors and oversized pages", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-source-")); roots.push(root);
  const keyPath = join(root, "key.pem"); const certPath = join(root, "cert.pem");
  writeFileSync(keyPath, generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey, { mode: 0o600 });
  execFileSync("openssl", ["req", "-x509", "-new", "-key", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore" });
  let response = JSON.stringify({ records: [record], nextCursor: "second" });
  let redirect = false;
  const server = createServer({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, (_req, res) => {
    if (redirect) { res.writeHead(302, { Location: "https://evil.example/" }); res.end(); return; }
    res.setHeader("Content-Type", "application/json"); res.end(response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as {port: number}).port;
  const source = { url: `https://127.0.0.1:${port}/export`, allowedHost: "127.0.0.1", allowedAddresses: ["127.0.0.1"], caPem: readFileSync(certPath, "utf8") };
  try {
    const page = await readCanonicalHttpsPage(source, null, 4096, 5000);
    expect(page.records).toHaveLength(1);
    expect(page.nextCursor).toBe("second");
    await expect(readCanonicalHttpsPage({ ...source, allowedAddresses: ["127.0.0.2"] }, null, 4096, 5000)).rejects.toThrow("source_dns_mismatch");
    redirect = true;
    await expect(readCanonicalHttpsPage(source, null, 4096, 5000)).rejects.toThrow("source_http_error");
    redirect = false;
    response = JSON.stringify({ records: [record], nextCursor: null });
    await expect(readCanonicalHttpsPage(source, null, 4096, 5000)).rejects.toThrow("invalid_source_page");
    response = "x".repeat(5000);
    await expect(readCanonicalHttpsPage(source, null, 4096, 5000)).rejects.toThrow("source_page_too_large");
  } finally { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); }
});
