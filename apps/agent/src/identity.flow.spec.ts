import { mkdtempSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./transport.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./transport.js")>();
  return { ...original, enrollAgent: vi.fn(), sendAgentFrame: vi.fn() };
});

import { loadAgentConfig, readCredentials } from "./config.js";
import { enroll, rotate } from "./identity.js";
import { enrollAgent, sendAgentFrame } from "./transport.js";

const roots: string[] = [];
afterEach(() => { vi.resetAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const agentId = "f77876e5-d692-4e44-b14e-78879665719d";
const organizationId = "72748c24-bccc-441d-bc14-8fccdc6be1dc";
const connectorId = "320487ff-cb72-4bbb-97ba-2bdb158ea7ac";
const cert = "-----BEGIN CERTIFICATE-----\n" + "A".repeat(80) + "\n-----END CERTIFICATE-----\n";

it("persists enrollment secrets before deleting token and rotates with stable idempotency", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-life-")); roots.push(root);
  const tokenPath = join(root, "token");
  writeFileSync(tokenPath, "t".repeat(48), {mode: 0o600});
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify({ ingressUrl: "https://localhost:3443/", stateDir: join(root, "state"), serverCaFile: join(root, "ca.pem"), enrollmentTokenFile: tokenPath, sources: [{ id: "file", type: "file", path: join(root, "source.ndjson") }] }));
  const config = loadAgentConfig(configPath);
  vi.mocked(enrollAgent).mockResolvedValue({ agentId, organizationId, connectorId, clientCertificatePem: cert, caCertificatePem: cert, signingKey: "k".repeat(48), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" });
  await enroll(config, { ingressUrl: config.ingressUrl, serverCaPem: cert, timeoutMs: 5000 });
  expect(existsSync(tokenPath)).toBe(false);
  expect(readCredentials(config).agentId).toBe(agentId);
  expect(readFileSync(join(config.stateDir, "credentials.json"), "utf8")).toContain("PRIVATE KEY");
  vi.mocked(sendAgentFrame).mockResolvedValue({ kind: "rotate", clientCertificatePem: cert, caCertificatePem: cert, signingKey: "n".repeat(48), signingKeyId: "key2", expiresAt: "2027-04-01T00:00:00.000Z" });
  const rotated = await rotate(config, { ingressUrl: config.ingressUrl, serverCaPem: cert, timeoutMs: 5000 });
  expect(rotated.signingKeyId).toBe("key2");
  expect(readCredentials(config).signingKeyId).toBe("key2");
  expect(existsSync(join(config.stateDir, "rotation-pending.json"))).toBe(false);
});

it("retains a pending rotation key and idempotency key across a failed request", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-rotate-")); roots.push(root);
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify({ ingressUrl: "https://localhost:3443/", stateDir: join(root, "state"), serverCaFile: join(root, "ca.pem"), sources: [{ id: "file", type: "file", path: join(root, "source.ndjson") }] }));
  const config = loadAgentConfig(configPath);
  const { saveCredentials } = await import("./config.js");
  saveCredentials(config, { agentId, organizationId, connectorId, clientCertificatePem: cert, caCertificatePem: cert, privateKeyPem: "-----BEGIN PRIVATE KEY-----\nkey", signingKey: "k".repeat(48), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" });
  vi.mocked(sendAgentFrame).mockRejectedValueOnce(new Error("network_timeout"));
  await expect(rotate(config, { ingressUrl: config.ingressUrl, serverCaPem: cert, timeoutMs: 5000 })).rejects.toThrow("network_timeout");
  const pendingBefore = readFileSync(join(config.stateDir, "rotation-pending.json"), "utf8");
  vi.mocked(sendAgentFrame).mockResolvedValueOnce({ kind: "rotate", clientCertificatePem: cert, caCertificatePem: cert, signingKey: "n".repeat(48), signingKeyId: "key2", expiresAt: "2027-04-01T00:00:00.000Z" });
  await rotate(config, { ingressUrl: config.ingressUrl, serverCaPem: cert, timeoutMs: 5000 });
  expect(vi.mocked(sendAgentFrame).mock.calls[0]?.[2]).toEqual(vi.mocked(sendAgentFrame).mock.calls[1]?.[2]);
  expect(pendingBefore).toContain("idempotencyKey");
  expect(readCredentials(config).signingKeyId).toBe("key2");
});

it("reuses the exact enrollment CSR after a lost response", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-enroll-retry-")); roots.push(root);
  const tokenPath = join(root, "token");
  writeFileSync(tokenPath, "t".repeat(48), { mode: 0o600 });
  const configPath = join(root, "config.json");
  writeFileSync(configPath, JSON.stringify({ ingressUrl: "https://localhost:3443/", stateDir: join(root, "state"), serverCaFile: join(root, "ca.pem"), enrollmentTokenFile: tokenPath, sources: [{ id: "file", type: "file", path: join(root, "source.ndjson") }] }));
  const config = loadAgentConfig(configPath);
  const transport = { ingressUrl: config.ingressUrl, serverCaPem: cert, timeoutMs: 5000 };
  vi.mocked(enrollAgent).mockRejectedValueOnce(new Error("network_timeout"));
  await expect(enroll(config, transport)).rejects.toThrow("network_timeout");
  const csrBefore = readFileSync(join(config.stateDir, "enrollment-csr.pem"), "utf8");
  vi.mocked(enrollAgent).mockResolvedValueOnce({ agentId, organizationId, connectorId, clientCertificatePem: cert, caCertificatePem: cert, signingKey: "k".repeat(48), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" });
  await enroll(config, transport);
  expect(vi.mocked(enrollAgent).mock.calls[0]?.[1].csrPem).toBe(csrBefore.trim());
  expect(vi.mocked(enrollAgent).mock.calls[1]?.[1].csrPem).toBe(csrBefore.trim());
  expect(existsSync(join(config.stateDir, "enrollment-csr.pem"))).toBe(false);
});
