import { createHash, createHmac } from "node:crypto";
import { expect, it } from "vitest";
import { enrollAgent, sendAgentFrame, signedFrameHeaders } from "./transport.js";

it("binds raw body and actual POST path with a fresh nonce", () => {
  const rawBody = JSON.stringify({ version: 1, kind: "heartbeat" });
  const headers = signedFrameHeaders({ agentId: "agent", signingKey: "secret", signingKeyId: "key1", rawBody, now: new Date("2026-01-01T00:00:00.000Z"), nonce: "unique-nonce" });
  const digest = createHash("sha256").update(rawBody).digest("hex");
  const expected = createHmac("sha256", "secret").update(`2026-01-01T00:00:00.000Z.unique-nonce.${digest}.POST./api/v1/agent/frames`).digest("hex");
  expect(headers["x-cra-signature"]).toBe(expected);
  expect(headers["x-cra-nonce"]).toBe("unique-nonce");
});

it("rejects invalid enrollment input and frame identity before network I/O", async () => {
  const config = { ingressUrl: "https://localhost:3443/", serverCaPem: "ca", timeoutMs: 5000 };
  await expect(enrollAgent(config, { token: "short", csrPem: "invalid" })).rejects.toThrow();
  const credentials = { agentId: "f77876e5-d692-4e44-b14e-78879665719d", organizationId: "72748c24-bccc-441d-bc14-8fccdc6be1dc", connectorId: "320487ff-cb72-4bbb-97ba-2bdb158ea7ac", privateKeyPem: "private", clientCertificatePem: "cert", caCertificatePem: "ca", signingKey: "k".repeat(32), signingKeyId: "key1", expiresAt: "2027-01-01T00:00:00.000Z" };
  await expect(sendAgentFrame(config, credentials, { version: 1, kind: "heartbeat", agentId: credentials.agentId, organizationId: "d4c27698-8a08-46ed-b2b7-ce3071e83341", connectorId: credentials.connectorId, agentVersion: "0.1.0", capabilities: ["canonical_file"], backlogCount: 0, backlogBytes: 0, safeErrorCode: null })).rejects.toThrow("frame_identity_mismatch");
  const csrPem = "-----BEGIN CERTIFICATE REQUEST-----\n" + "A".repeat(80);
  await expect(enrollAgent({ ...config, ingressUrl: "http://localhost:3443/" }, { token: "x".repeat(48), csrPem })).rejects.toThrow("invalid_ingress_url");
  await expect(enrollAgent({ ...config, proxyUrl: "https://proxy.example/" }, { token: "x".repeat(48), csrPem })).rejects.toThrow("invalid_proxy_url");
});
