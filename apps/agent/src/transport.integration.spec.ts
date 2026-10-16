import { execFileSync } from "node:child_process";
import { generateKeyPairSync } from "node:crypto";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createSocketServer, connect } from "node:net";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Duplex } from "node:stream";
import type { TLSSocket } from "node:tls";
import { afterEach, expect, it } from "vitest";
import { enrollAgent, sendAgentFrame, type AgentCredentials } from "./transport.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
const agentId = "f77876e5-d692-4e44-b14e-78879665719d";
const organizationId = "72748c24-bccc-441d-bc14-8fccdc6be1dc";
const connectorId = "320487ff-cb72-4bbb-97ba-2bdb158ea7ac";

it("uses an HTTP CONNECT tunnel with verified TLS and a client certificate", async () => {
  const root = mkdtempSync(join(tmpdir(), "cra-agent-tls-")); roots.push(root);
  const keyPath = join(root, "key.pem"); const certPath = join(root, "cert.pem");
  writeFileSync(keyPath, generateKeyPairSync("ec", { namedCurve: "prime256v1", privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } }).privateKey, { mode: 0o600 });
  execFileSync("openssl", ["req", "-x509", "-new", "-key", keyPath, "-out", certPath, "-days", "1", "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1"], { stdio: "ignore" });
  const key = readFileSync(keyPath, "utf8"); const cert = readFileSync(certPath, "utf8");
  let peerCertificateSeen = false;
  let signatureSeen = false;
  let rejectCode: string | null = null;
  const ingress = createHttpsServer({ key, cert, requestCert: true, rejectUnauthorized: false }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (part: Buffer) => chunks.push(part));
    req.on("end", () => {
      peerCertificateSeen = Boolean((req.socket as TLSSocket).getPeerCertificate().raw);
      signatureSeen = typeof req.headers["x-cra-signature"] === "string" && req.headers["x-cra-signature"].length === 64;
      res.setHeader("Content-Type", "application/json");
      if (rejectCode) { res.statusCode = 429; res.end(JSON.stringify({ code: rejectCode, message: "Retry later" })); return; }
      if (req.url === "/api/v1/agent/enroll") {
        res.end(JSON.stringify({ agentId, organizationId, connectorId, clientCertificatePem: cert, caCertificatePem: cert, signingKey: "k".repeat(48), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" }));
      } else res.end(JSON.stringify({ kind: "heartbeat", acceptedAt: new Date().toISOString() }));
    });
  });
  await new Promise<void>((resolve) => ingress.listen(0, "127.0.0.1", resolve));
  const ingressPort = (ingress.address() as { port: number }).port;
  const proxy = createHttpServer();
  const tunneledSockets = new Set<Duplex>();
  proxy.on("connect", (_req, client, head) => {
    tunneledSockets.add(client);
    expect(head.length).toBe(0);
    const upstream = connect(ingressPort, "127.0.0.1");
    tunneledSockets.add(upstream);
    upstream.once("connect", () => { client.write("HTTP/1.1 200 Connection Established\r\n\r\n"); client.pipe(upstream); upstream.pipe(client); });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const proxyPort = (proxy.address() as { port: number }).port;
  const config = { ingressUrl: `https://127.0.0.1:${ingressPort}/`, proxyUrl: `http://127.0.0.1:${proxyPort}/`, serverCaPem: cert, timeoutMs: 5000 };
  const credentials: AgentCredentials = { agentId, organizationId, connectorId, privateKeyPem: key, clientCertificatePem: cert, caCertificatePem: cert, signingKey: "a".repeat(32), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" };
  try {
    const response = await sendAgentFrame(config, credentials, { version: 1, kind: "heartbeat", agentId, organizationId, connectorId, agentVersion: "0.1.0", capabilities: ["canonical_file"], backlogCount: 0, backlogBytes: 0, safeErrorCode: null });
    expect(response.kind).toBe("heartbeat");
    expect(peerCertificateSeen).toBe(true);
    expect(signatureSeen).toBe(true);
    const enrollment = await enrollAgent({ ...config, proxyUrl: undefined }, { token: "x".repeat(48), csrPem: "-----BEGIN CERTIFICATE REQUEST-----\n" + "A".repeat(80) });
    expect(enrollment.agentId).toBe(agentId);
    rejectCode = "backpressure";
    await expect(sendAgentFrame(config, credentials, { version: 1, kind: "heartbeat", agentId, organizationId, connectorId, agentVersion: "0.1.0", capabilities: ["canonical_file"], backlogCount: 0, backlogBytes: 0, safeErrorCode: null })).rejects.toMatchObject({ status: 429, code: "backpressure" });
    rejectCode = null;
    await expect(sendAgentFrame({ ...config, serverCaPem: "-----BEGIN CERTIFICATE-----\nwrong\n-----END CERTIFICATE-----" }, credentials, { version: 1, kind: "heartbeat", agentId, organizationId, connectorId, agentVersion: "0.1.0", capabilities: ["canonical_file"], backlogCount: 0, backlogBytes: 0, safeErrorCode: null })).rejects.toThrow();
  } finally {
    for (const socket of tunneledSockets) socket.destroy();
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await new Promise<void>((resolve) => ingress.close(() => resolve()));
  }
});

it("rejects a proxy that refuses CONNECT", async () => {
  const sockets = new Set<import("node:net").Socket>();
  const proxy = createSocketServer((socket) => { sockets.add(socket); socket.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\n\r\n", () => socket.destroy()); });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));
  const port = (proxy.address() as {port: number}).port;
  try {
    await expect(enrollAgent({ ingressUrl: "https://localhost:3443/", serverCaPem: "ca", proxyUrl: `http://127.0.0.1:${port}/`, timeoutMs: 1000 }, { token: "x".repeat(32), csrPem: "-----BEGIN CERTIFICATE REQUEST-----\n" + "A".repeat(80) })).rejects.toThrow("proxy_failed");
  } finally { for (const socket of sockets) socket.destroy(); await new Promise<void>((resolve) => proxy.close(() => resolve())); }
});
