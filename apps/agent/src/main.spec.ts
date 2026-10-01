import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("./runtime.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./runtime.js")>();
  return { ...original, processSource: vi.fn() };
});
vi.mock("./transport.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./transport.js")>();
  return { ...original, sendAgentFrame: vi.fn() };
});
vi.mock("./identity.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("./identity.js")>();
  return { ...original, enroll: vi.fn(), rotate: vi.fn() };
});

import { loadAgentConfig, saveCredentials } from "./config.js";
import { enroll, rotate } from "./identity.js";
import { runAgentCli, serve } from "./main.js";
import { processSource } from "./runtime.js";
import { sendAgentFrame } from "./transport.js";

const roots: string[] = [];
afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const credentials = { agentId: "f77876e5-d692-4e44-b14e-78879665719d", organizationId: "72748c24-bccc-441d-bc14-8fccdc6be1dc", connectorId: "320487ff-cb72-4bbb-97ba-2bdb158ea7ac", privateKeyPem: "-----BEGIN PRIVATE KEY-----\nkey", clientCertificatePem: "-----BEGIN CERTIFICATE-----\ncert", caCertificatePem: "-----BEGIN CERTIFICATE-----\nca", signingKey: "k".repeat(32), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" };

function setup() {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-main-")); roots.push(root);
  const configPath = join(root, "config.json"); const caFile = join(root, "ca.pem");
  writeFileSync(caFile, "ca");
  writeFileSync(configPath, JSON.stringify({ ingressUrl: "https://localhost:3443/", stateDir: join(root, "state"), serverCaFile: caFile, sources: [{ id: "source", type: "file", path: join(root, "source.ndjson") }] }));
  const config = loadAgentConfig(configPath);
  saveCredentials(config, credentials);
  return { configPath, config };
}

it("runs local status, enrollment, rotation and rejects unsupported commands", async () => {
  const { configPath } = setup();
  const output = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
  vi.mocked(enroll).mockResolvedValue(credentials);
  vi.mocked(rotate).mockResolvedValue(credentials);
  await runAgentCli(["status", "--config", configPath]);
  await runAgentCli(["enroll", "--config", configPath]);
  await runAgentCli(["rotate", "--config", configPath]);
  expect(output).toHaveBeenCalledTimes(3);
  await expect(runAgentCli(["unknown", "--config", configPath])).rejects.toThrow("usage:");
});

it("reports a safe error in heartbeat while retaining the queued batch", async () => {
  const { config } = setup();
  const stop = new AbortController();
  vi.mocked(processSource).mockImplementation(async () => { stop.abort(); throw new Error("offline"); });
  vi.mocked(sendAgentFrame).mockResolvedValue({ kind: "heartbeat", acceptedAt: new Date().toISOString() });
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await serve(config, { ingressUrl: config.ingressUrl, serverCaPem: "ca", timeoutMs: 5000 }, stop.signal);
  expect(sendAgentFrame).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ agentId: credentials.agentId }), expect.objectContaining({ kind: "heartbeat", safeErrorCode: "network_unavailable" }));
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining("network_unavailable"));
});

it("rotates near-expiry credentials before a successful source cycle", async () => {
  const { config } = setup();
  saveCredentials(config, { ...credentials, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  const stop = new AbortController();
  vi.mocked(rotate).mockResolvedValue({ ...credentials, signingKeyId: "key2" });
  vi.mocked(processSource).mockImplementation(async () => { stop.abort(); });
  vi.mocked(sendAgentFrame).mockResolvedValue({ kind: "heartbeat", acceptedAt: new Date().toISOString() });
  await serve(config, { ingressUrl: config.ingressUrl, serverCaPem: "ca", timeoutMs: 5000 }, stop.signal);
  expect(rotate).toHaveBeenCalledOnce();
  expect(sendAgentFrame).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ signingKeyId: "key2" }), expect.objectContaining({ kind: "heartbeat", safeErrorCode: null }));
});

it("does not leak failed heartbeat details into process output", async () => {
  const { config } = setup();
  const stop = new AbortController();
  vi.mocked(processSource).mockImplementation(async () => { stop.abort(); });
  vi.mocked(sendAgentFrame).mockRejectedValue(new Error("private network details"));
  const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  await serve(config, { ingressUrl: config.ingressUrl, serverCaPem: "ca", timeoutMs: 5000 }, stop.signal);
  expect(stderr).toHaveBeenCalledWith(expect.stringContaining('"code":"network_unavailable"'));
  expect(stderr).not.toHaveBeenCalledWith(expect.stringContaining("private network details"));
});

it("exits an already-stopped service without opening network connections", async () => {
  const { config } = setup();
  const stop = new AbortController(); stop.abort();
  await serve(config, { ingressUrl: config.ingressUrl, serverCaPem: "ca", timeoutMs: 5000 }, stop.signal);
  expect(processSource).not.toHaveBeenCalled();
  expect(sendAgentFrame).not.toHaveBeenCalled();
});
