import { generateKeyPairSync, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { AgentConfig } from "./config.js";
import { readCredentials, readProtectedText, saveCredentials, writeProtected } from "./config.js";
import { enrollAgent, sendAgentFrame, type AgentCredentials, type TransportConfig } from "./transport.js";

export function prepareCertificateRequest(keyPath: string): string {
  if (!existsSync(keyPath)) {
    const pair = generateKeyPairSync("ec", {
      namedCurve: "prime256v1",
      privateKeyEncoding: { format: "pem", type: "pkcs8" },
      publicKeyEncoding: { format: "pem", type: "spki" },
    });
    writeProtected(keyPath, pair.privateKey);
  } else readProtectedText(keyPath);
  try {
    return execFileSync("openssl", ["req", "-new", "-sha256", "-batch", "-key", keyPath, "-subj", "/CN=cra-agent", "-outform", "PEM"], {
      encoding: "utf8", timeout: 10_000, maxBuffer: 32 * 1024, stdio: ["ignore", "pipe", "ignore"],
    });
  } catch { throw new Error("csr_generation_failed"); }
}

export async function enroll(config: AgentConfig, transport: TransportConfig): Promise<AgentCredentials> {
  if (!config.enrollmentTokenFile) throw new Error("missing_enrollment_token_file");
  const keyPath = join(config.stateDir, "enrollment-key.pem");
  const csrPath = join(config.stateDir, "enrollment-csr.pem");
  const csrPem = existsSync(csrPath) ? readProtectedText(csrPath) : prepareCertificateRequest(keyPath).trim();
  if (!existsSync(csrPath)) writeProtected(csrPath, csrPem);
  const token = readProtectedText(config.enrollmentTokenFile);
  const result = await enrollAgent(transport, { token, csrPem });
  const credentials: AgentCredentials = { ...result, privateKeyPem: readProtectedText(keyPath) };
  saveCredentials(config, credentials);
  unlinkSync(keyPath);
  unlinkSync(csrPath);
  unlinkSync(config.enrollmentTokenFile);
  return credentials;
}

const pendingRotationSchema = z.object({ idempotencyKey: z.uuid(), csrPem: z.string().min(64) }).strict();

export async function rotate(config: AgentConfig, transport: TransportConfig): Promise<AgentCredentials> {
  const current = readCredentials(config);
  const keyPath = join(config.stateDir, "rotation-key.pem");
  const pendingPath = join(config.stateDir, "rotation-pending.json");
  const pending = existsSync(pendingPath)
    ? pendingRotationSchema.parse(JSON.parse(readProtectedText(pendingPath)) as unknown)
    : (() => {
        const value = { idempotencyKey: randomUUID(), csrPem: prepareCertificateRequest(keyPath) };
        writeProtected(pendingPath, JSON.stringify(value));
        return value;
      })();
  const response = await sendAgentFrame(transport, current, {
    version: 1, kind: "rotate", organizationId: current.organizationId,
    connectorId: current.connectorId, agentId: current.agentId,
    csrPem: pending.csrPem, idempotencyKey: pending.idempotencyKey,
  });
  if (response.kind !== "rotate") throw new Error("rotation_response_mismatch");
  const next: AgentCredentials = {
    ...current,
    clientCertificatePem: response.clientCertificatePem,
    caCertificatePem: response.caCertificatePem,
    signingKey: response.signingKey,
    signingKeyId: response.signingKeyId,
    expiresAt: response.expiresAt,
    privateKeyPem: readFileSync(keyPath, "utf8"),
  };
  saveCredentials(config, next);
  unlinkSync(pendingPath);
  unlinkSync(keyPath);
  return next;
}
