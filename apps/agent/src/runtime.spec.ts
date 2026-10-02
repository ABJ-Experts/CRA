import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { AgentQueue } from "./queue.js";
import { processSource, safeErrorCode } from "./runtime.js";
import { AgentHttpError } from "./transport.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const record = { entityType: "product", externalId: "p-1", externalDisplayLabel: "Product", externalUpdatedAt: "2026-01-01T00:00:00.000Z", changeKind: "upsert", tombstoneReliability: "unknown", parentExternalId: null, fields: { name: "Product" } };
const credentials = { agentId: "f77876e5-d692-4e44-b14e-78879665719d", organizationId: "72748c24-bccc-441d-bc14-8fccdc6be1dc", connectorId: "320487ff-cb72-4bbb-97ba-2bdb158ea7ac", privateKeyPem: "private", clientCertificatePem: "cert", caCertificatePem: "ca", signingKey: "a".repeat(32), signingKeyId: "key-1", expiresAt: "2027-01-01T00:00:00.000Z" };

it("retries the same durable batch after an outage and advances only on a matching ACK", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-runtime-")); roots.push(root);
  const sourcePath = join(root, "source.ndjson");
  writeFileSync(sourcePath, JSON.stringify(record) + "\n");
  const queue = new AgentQueue({ path: join(root, "queue.sqlite"), key: Buffer.alloc(32, 4), maxBytes: 1024 * 1024 });
  const config = { maxRecords: 200, maxReadBytes: 1024 * 1024, timeoutMs: 5000 };
  const source = { id: "plm", type: "file" as const, path: sourcePath };
  await expect(processSource(config, source, queue, credentials, async () => { throw new Error("offline"); })).rejects.toThrow("offline");
  const original = queue.pending("plm");
  expect(original).not.toBeNull();
  expect(queue.checkpoint("plm")).toBeNull();
  await processSource(config, source, queue, credentials, async (frame) => ({ kind: "batch", batchId: frame.batchId, sequence: frame.sequence, acceptedAt: new Date().toISOString() }));
  expect(queue.checkpoint("plm")).toBe(original?.cursorTo);
  expect(queue.pending("plm")).toBeNull();
  queue.close();
});

it("keeps a staged page pending on a mismatched ACK", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-mismatch-")); roots.push(root);
  const sourcePath = join(root, "source.ndjson");
  writeFileSync(sourcePath, JSON.stringify(record) + "\n");
  const queue = new AgentQueue({ path: join(root, "queue.sqlite"), key: Buffer.alloc(32, 5), maxBytes: 1024 * 1024 });
  await expect(processSource({ maxRecords: 200, maxReadBytes: 1024 * 1024, timeoutMs: 5000 }, { id: "plm", type: "file", path: sourcePath }, queue, credentials, async (frame) => ({ kind: "batch", batchId: frame.batchId, sequence: 99, acceptedAt: new Date().toISOString() }))).rejects.toThrow("ack_mismatch");
  expect(queue.pending("plm")).not.toBeNull();
  expect(queue.checkpoint("plm")).toBeNull();
  queue.close();
});

it("maps only stable operational codes into health", () => {
  expect(safeErrorCode(new Error("source_replaced"))).toBe("source_changed");
  expect(safeErrorCode(new Error("source_record_too_large"))).toBe("source_invalid");
  expect(safeErrorCode(new Error("source_timeout"))).toBe("source_unavailable");
  expect(safeErrorCode(new Error("queue_full"))).toBe("queue_full");
  expect(safeErrorCode(new Error("backpressure"))).toBe("backpressure");
  expect(safeErrorCode(new Error("proxy_failed"))).toBe("proxy_failed");
  expect(safeErrorCode(new Error("tls_failed"))).toBe("tls_failed");
  expect(safeErrorCode(new Error("clock_skew"))).toBe("clock_skew");
  expect(safeErrorCode(new AgentHttpError(409, "rotation_in_progress"))).toBe("rotation_in_progress");
  expect(safeErrorCode(new Error("revoked"))).toBe("credential_expired");
  expect(safeErrorCode(new Error("network_timeout"))).toBe("network_unavailable");
  expect(safeErrorCode(Object.assign(new Error("details"), { code: "ECONNREFUSED" }))).toBe("network_unavailable");
  expect(safeErrorCode(Object.assign(new Error("details"), { code: "ERR_TLS_CERT_ALTNAME_INVALID" }))).toBe("tls_failed");
  expect(safeErrorCode(new Error("private details"))).toBe("unknown");
});

it("refuses an unallowlisted HTTPS source without staging a batch", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-https-policy-")); roots.push(root);
  const queue = new AgentQueue({ path: join(root, "queue.sqlite"), key: Buffer.alloc(32, 5), maxBytes: 1024 * 1024 });
  writeFileSync(join(root, "auth"), "Bearer local-token", { mode: 0o600 });
  writeFileSync(join(root, "ca"), "ca");
  await expect(processSource({ maxRecords: 200, maxReadBytes: 4096, timeoutMs: 5000 }, { id: "plm", type: "https", url: "http://insecure.example/", allowedHost: "insecure.example", allowedAddresses: ["127.0.0.1"], authorizationFile: join(root, "auth"), caFile: join(root, "ca") }, queue, credentials, async (frame) => ({ kind: "batch", batchId: frame.batchId, sequence: frame.sequence, acceptedAt: new Date().toISOString() }))).rejects.toThrow("source_not_allowlisted");
  expect(queue.pending("plm")).toBeNull();
  queue.close();
});
