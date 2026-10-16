import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { ensureQueueKey, loadAgentConfig, readCredentials, readProtectedText, saveCredentials } from "./config.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

it("rejects inline credentials and permissive secret files", () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-config-")); roots.push(root);
  const configPath = join(root, "config.json");
  const base = { ingressUrl: "https://cra.example/", stateDir: join(root, "state"), serverCaFile: join(root, "ca.pem"), enrollmentTokenFile: join(root, "token"), sources: [{ id: "plm", type: "file", path: join(root, "source.ndjson") }] };
  writeFileSync(configPath, JSON.stringify({ ...base, signingKey: "inline-secret" }));
  expect(() => loadAgentConfig(configPath)).toThrow();
  writeFileSync(configPath, JSON.stringify(base));
  const config = loadAgentConfig(configPath);
  expect(config.sources).toHaveLength(1);
  writeFileSync(configPath, JSON.stringify({ ...base, sources: [base.sources[0], { id: "second", type: "file", path: join(root, "other.ndjson") }] }));
  expect(() => loadAgentConfig(configPath)).toThrow();
  writeFileSync(configPath, JSON.stringify({ ...base, sources: [{ id: "plm", type: "https", url: "https://internal.example/export?token=secret", allowedHost: "internal.example", allowedAddresses: ["10.0.0.1"] }] }));
  expect(() => loadAgentConfig(configPath)).toThrow();
  writeFileSync(join(root, "token"), "sensitive", { mode: 0o644 });
  expect(() => readProtectedText(join(root, "token"))).toThrow("insecure_file_permissions");
  const key = ensureQueueKey(config);
  expect(key).toHaveLength(32);
  expect(ensureQueueKey(config)).toEqual(key);
  const credentials = { agentId: "f77876e5-d692-4e44-b14e-78879665719d", organizationId: "72748c24-bccc-441d-bc14-8fccdc6be1dc", connectorId: "320487ff-cb72-4bbb-97ba-2bdb158ea7ac", privateKeyPem: "-----BEGIN PRIVATE KEY-----\ntest\n-----END PRIVATE KEY-----", clientCertificatePem: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----", caCertificatePem: "-----BEGIN CERTIFICATE-----\ntest\n-----END CERTIFICATE-----", signingKey: "k".repeat(32), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" };
  saveCredentials(config, credentials);
  expect(readCredentials(config)).toEqual(credentials);
});
