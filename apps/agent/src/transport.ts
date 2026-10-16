import { createHash, createHmac, randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { request as httpsRequest, type RequestOptions } from "node:https";
import { isIP } from "node:net";
import { checkServerIdentity, connect as tlsConnect, type TLSSocket } from "node:tls";
import { agentEnrollInputSchema, agentEnrollResponseSchema, agentFrameBodySchema, agentFrameResponseSchema } from "@repo/contracts/connectors/schemas";
import type { z } from "zod";

const FRAME_PATH = "/api/v1/agent/frames";
const ENROLL_PATH = "/api/v1/agent/enroll";
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;

export type AgentCredentials = Readonly<{
  agentId: string;
  organizationId: string;
  connectorId: string;
  privateKeyPem: string;
  clientCertificatePem: string;
  caCertificatePem: string;
  signingKey: string;
  signingKeyId: string;
  expiresAt: string;
}>;

export type TransportConfig = Readonly<{
  ingressUrl: string;
  serverCaPem: string;
  proxyUrl?: string;
  timeoutMs: number;
}>;

export class AgentHttpError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
  }
}

export function signedFrameHeaders(input: Readonly<{
  agentId: string;
  signingKey: string;
  signingKeyId: string;
  rawBody: string;
  now?: Date;
  nonce?: string;
}>): Record<string, string> {
  const timestamp = (input.now ?? new Date()).toISOString();
  const nonce = input.nonce ?? randomBytes(24).toString("base64url");
  const bodyHash = createHash("sha256").update(input.rawBody).digest("hex");
  const signature = createHmac("sha256", input.signingKey)
    .update(`${timestamp}.${nonce}.${bodyHash}.POST.${FRAME_PATH}`)
    .digest("hex");
  return {
    "x-cra-agent-id": input.agentId,
    "x-cra-key-id": input.signingKeyId,
    "x-cra-timestamp": timestamp,
    "x-cra-nonce": nonce,
    "x-cra-signature": signature,
  };
}

export async function enrollAgent(config: TransportConfig, input: Readonly<{ token: string; csrPem: string }>): Promise<z.output<typeof agentEnrollResponseSchema>> {
  const raw = JSON.stringify(agentEnrollInputSchema.parse(input));
  const response = await postJson(config, ENROLL_PATH, raw, {}, null);
  return agentEnrollResponseSchema.parse(response);
}

export async function sendAgentFrame(
  config: TransportConfig,
  credentials: AgentCredentials,
  frame: z.input<typeof agentFrameBodySchema>,
): Promise<z.output<typeof agentFrameResponseSchema>> {
  const parsed = agentFrameBodySchema.parse(frame);
  if (parsed.agentId !== credentials.agentId || parsed.organizationId !== credentials.organizationId || parsed.connectorId !== credentials.connectorId) throw new Error("frame_identity_mismatch");
  const raw = JSON.stringify(parsed);
  if (Buffer.byteLength(raw) > 4 * 1024 * 1024) throw new Error("frame_too_large");
  const response = await postJson(config, FRAME_PATH, raw, signedFrameHeaders({ agentId: credentials.agentId, signingKey: credentials.signingKey, signingKeyId: credentials.signingKeyId, rawBody: raw }), credentials);
  return agentFrameResponseSchema.parse(response);
}

async function postJson(config: TransportConfig, path: string, rawBody: string, extraHeaders: Record<string, string>, credentials: AgentCredentials | null): Promise<unknown> {
  const base = new URL(config.ingressUrl);
  if (base.protocol !== "https:" || base.username || base.password || base.pathname !== "/" || base.search || base.hash) throw new Error("invalid_ingress_url");
  const target = new URL(path, base);
  let tunnel: TLSSocket | undefined;
  if (config.proxyUrl) tunnel = await openProxyTunnel(config.proxyUrl, target, config.serverCaPem, credentials, config.timeoutMs);
  const options: RequestOptions = {
    method: "POST",
    timeout: config.timeoutMs,
    ca: config.serverCaPem,
    cert: credentials?.clientCertificatePem,
    key: credentials?.privateKeyPem,
    rejectUnauthorized: true,
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(rawBody), ...extraHeaders },
    ...(tunnel ? { agent: false, createConnection: () => tunnel } : {}),
  };
  return await new Promise<unknown>((resolve, reject) => {
    const req = httpsRequest(target, options, (res) => {
      const parts: Buffer[] = [];
      let bytes = 0;
      res.on("data", (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > MAX_RESPONSE_BYTES) { req.destroy(new Error("response_too_large")); return; }
        parts.push(chunk);
      });
      res.on("end", () => {
        let parsed: unknown;
        try { parsed = JSON.parse(Buffer.concat(parts).toString("utf8")) as unknown; }
        catch { reject(new Error("invalid_ingress_response")); return; }
        if ((res.statusCode ?? 500) < 200 || (res.statusCode ?? 500) >= 300) {
          const errorCode = typeof parsed === "object" && parsed !== null && "code" in parsed && typeof parsed.code === "string" ? parsed.code : "ingress_rejected";
          reject(new AgentHttpError(res.statusCode ?? 500, errorCode));
          return;
        }
        resolve(parsed);
      });
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new Error("network_timeout")));
    req.on("error", reject);
    req.end(rawBody);
  });
}

async function openProxyTunnel(proxyUrl: string, target: URL, serverCaPem: string, credentials: AgentCredentials | null, timeoutMs: number): Promise<TLSSocket> {
  const proxy = new URL(proxyUrl);
  if (proxy.protocol !== "http:" || proxy.username || proxy.password || proxy.pathname !== "/" || proxy.search || proxy.hash) throw new Error("invalid_proxy_url");
  const authority = `${target.hostname}:${target.port || "443"}`;
  return await new Promise<TLSSocket>((resolve, reject) => {
    const req = httpRequest(proxy, { method: "CONNECT", path: authority, timeout: timeoutMs, headers: { Host: authority } });
    req.on("connect", (res, socket, head) => {
      if (res.statusCode !== 200 || head.length > 0) { socket.destroy(); reject(new Error("proxy_failed")); return; }
      const tlsSocket = tlsConnect({ socket, servername: isIP(target.hostname) ? undefined : target.hostname, checkServerIdentity: (_name, peer) => checkServerIdentity(target.hostname, peer), ca: serverCaPem, cert: credentials?.clientCertificatePem, key: credentials?.privateKeyPem, rejectUnauthorized: true });
      tlsSocket.once("secureConnect", () => resolve(tlsSocket));
      tlsSocket.once("error", reject);
    });
    req.on("response", (res) => { res.resume(); reject(new Error("proxy_failed")); });
    req.on("timeout", () => req.destroy(new Error("proxy_timeout")));
    req.on("error", reject);
    req.end();
  });
}
