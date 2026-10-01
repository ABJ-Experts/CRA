import { randomBytes, randomUUID } from "node:crypto";
import { closeSync, constants, existsSync, fstatSync, fsyncSync, mkdirSync, openSync, readFileSync, readSync, renameSync, statSync, writeSync } from "node:fs";
import { dirname, join } from "node:path";
import { isIP } from "node:net";
import { z } from "zod";
import type { AgentCredentials } from "./transport.js";

const fileSourceSchema = z.object({ id: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/), type: z.literal("file"), path: z.string().min(1) }).strict();
const httpsSourceSchema = z.object({
  id: fileSourceSchema.shape.id,
  type: z.literal("https"),
  url: z.url().startsWith("https://").refine((value) => {
    const url = new URL(value);
    return !url.username && !url.password && !url.search && !url.hash;
  }),
  allowedHost: z.string().min(1),
  allowedAddresses: z.array(z.string().refine((value) => isIP(value) !== 0)).min(1).max(16),
  authorizationFile: z.string().optional(),
  caFile: z.string().optional(),
}).strict();
const configSchema = z.object({
  ingressUrl: z.url().startsWith("https://"),
  stateDir: z.string().min(1),
  serverCaFile: z.string().min(1),
  enrollmentTokenFile: z.string().optional(),
  proxyUrl: z.url().startsWith("http://").optional(),
  sources: z.array(z.discriminatedUnion("type", [fileSourceSchema, httpsSourceSchema])).length(1),
  pollIntervalMs: z.number().int().min(1000).max(300_000).default(10_000),
  timeoutMs: z.number().int().min(1000).max(60_000).default(15_000),
  maxRecords: z.number().int().min(1).max(200).default(200),
  maxReadBytes: z.number().int().min(1024).max(3 * 1024 * 1024).default(1024 * 1024),
  maxQueueBytes: z.number().int().min(4 * 1024 * 1024).max(1024 * 1024 * 1024).default(256 * 1024 * 1024),
}).strict();
export type AgentConfig = z.output<typeof configSchema>;

export function loadAgentConfig(path: string): AgentConfig {
  const config = configSchema.parse(JSON.parse(readFileSync(path, "utf8")) as unknown);
  const state = config.stateDir;
  if (!state.startsWith("/")) throw new Error("state_dir_must_be_absolute");
  mkdirSync(state, { recursive: true, mode: 0o700 });
  const mode = statSync(state).mode & 0o777;
  if ((mode & 0o077) !== 0) throw new Error("insecure_state_directory");
  return config;
}

function readProtected(path: string): Buffer {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || (stat.mode & 0o077) !== 0 || (typeof process.geteuid === "function" && stat.uid !== process.geteuid())) throw new Error("insecure_file_permissions");
    if (stat.size > 128 * 1024) throw new Error("secret_file_too_large");
    const data = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < data.length) {
      const count = readSync(fd, data, offset, data.length - offset, offset);
      if (count === 0) throw new Error("short_secret_read");
      offset += count;
    }
    return data;
  } finally { closeSync(fd); }
}

export function readProtectedText(path: string): string { return readProtected(path).toString("utf8").trim(); }

export function writeProtected(path: string, data: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temp = `${path}.${randomUUID()}.tmp`;
  const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const bytes = typeof data === "string" ? Buffer.from(data) : data;
    let offset = 0;
    while (offset < bytes.length) offset += writeSync(fd, bytes, offset, bytes.length - offset);
    fsyncSync(fd);
  } finally { closeSync(fd); }
  renameSync(temp, path);
  const dirFd = openSync(dirname(path), constants.O_RDONLY);
  try { fsyncSync(dirFd); } finally { closeSync(dirFd); }
}

export function queueKeyPath(config: AgentConfig): string { return join(config.stateDir, "queue.key"); }
export function credentialsPath(config: AgentConfig): string { return join(config.stateDir, "credentials.json"); }
export function queuePath(config: AgentConfig): string { return join(config.stateDir, "queue.sqlite"); }

export function ensureQueueKey(config: AgentConfig): Buffer {
  const path = queueKeyPath(config);
  if (!existsSync(path)) {
    try {
      const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { const key = randomBytes(32); writeSync(fd, key); fsyncSync(fd); return key; }
      finally { closeSync(fd); }
    } catch (error) {
      if (!existsSync(path)) throw error;
    }
  }
  const key = readProtected(path);
  if (key.length !== 32) throw new Error("invalid_queue_key");
  return key;
}

export function readCredentials(config: AgentConfig): AgentCredentials {
  const value = JSON.parse(readProtectedText(credentialsPath(config))) as unknown;
  const schema = z.object({
    agentId: z.uuid(), organizationId: z.uuid(), connectorId: z.uuid(),
    privateKeyPem: z.string().startsWith("-----BEGIN PRIVATE KEY-----"),
    clientCertificatePem: z.string().startsWith("-----BEGIN CERTIFICATE-----"),
    caCertificatePem: z.string().startsWith("-----BEGIN CERTIFICATE-----"),
    signingKey: z.string().min(32), signingKeyId: z.string().min(1), expiresAt: z.iso.datetime(),
  }).strict();
  return schema.parse(value);
}

export function saveCredentials(config: AgentConfig, credentials: AgentCredentials): void {
  writeProtected(credentialsPath(config), JSON.stringify(credentials));
}
