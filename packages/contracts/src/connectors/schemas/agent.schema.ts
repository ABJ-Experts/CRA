import { z } from "zod";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { connectorExternalRecordSchema } from "./sync-operations.schema.js";

const uuid = z.uuid();
const safeCount = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveSequence = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const pem = z.string().min(64).max(16_000).regex(/^-----BEGIN [A-Z ]+-----/);
const keyId = z.string().regex(/^[A-Za-z0-9_.-]{1,80}$/);
const safeErrorCode = z.enum([
  "source_unavailable",
  "source_changed",
  "source_invalid",
  "queue_full",
  "backpressure",
  "rotation_in_progress",
  "network_unavailable",
  "proxy_failed",
  "tls_failed",
  "clock_skew",
  "credential_expired",
  "unknown",
]);
const capability = z.enum(["canonical_file", "https_read"]);
const backlog = {
  backlogCount: safeCount,
  backlogBytes: safeCount,
};
const identity = {
  version: z.literal(1),
  organizationId: uuid,
  connectorId: uuid,
  agentId: uuid,
};

export const agentParamsSchema = z.object({ connectorId: uuid }).strict();
export const agentIdentityParamsSchema = z.object({ connectorId: uuid, agentId: uuid }).strict();
export const agentStatusQuerySchema = z.object({ cursor: z.string().min(1).max(200).optional() }).strict();
export const issueAgentEnrollmentInputSchema = z.object({ idempotencyKey: uuid }).strict();
export const issueAgentEnrollmentResponseSchema = z.object({
  token: z.string().min(32).max(256),
  expiresAt: utcZDateTimeSchema,
}).strict();
export const revokeAgentInputSchema = z.object({ idempotencyKey: uuid }).strict();
export const agentStatusSchema = z.object({
  id: uuid,
  status: z.enum(["pending", "active", "revoked"]),
  lastContactAt: utcZDateTimeSchema.nullable(),
  version: z.string().max(100).nullable(),
  capabilities: z.array(capability).max(2),
  ...backlog,
  lastErrorCode: safeErrorCode.nullable(),
}).strict();
export const revokeAgentResponseSchema = z.object({ agent: agentStatusSchema }).strict();
export const agentStatusResponseSchema = z.object({
  agent: agentStatusSchema.nullable(),
  batches: z.object({
    rows: z.array(z.object({
      id: uuid,
      sequence: positiveSequence,
      status: z.enum(["staged", "committed"]),
      receivedAt: utcZDateTimeSchema,
      recordCount: z.number().int().min(0).max(200),
    }).strict()).max(20),
    nextCursor: z.string().max(200).nullable(),
  }).strict(),
}).strict();

export const agentEnrollInputSchema = z.object({
  token: z.string().min(32).max(256),
  csrPem: pem,
}).strict();
export const agentEnrollResponseSchema = z.object({
  agentId: uuid,
  organizationId: uuid,
  connectorId: uuid,
  clientCertificatePem: pem,
  caCertificatePem: pem,
  signingKey: z.string().min(32).max(256),
  signingKeyId: keyId,
  expiresAt: utcZDateTimeSchema,
}).strict();

const frameBase = z.object(identity);
const heartbeat = frameBase.extend({
  kind: z.literal("heartbeat"),
  agentVersion: z.string().regex(/^\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?$/).max(100),
  capabilities: z.array(capability).min(1).max(2),
  ...backlog,
  safeErrorCode: safeErrorCode.nullable(),
}).strict();
const batch = frameBase.extend({
  kind: z.literal("batch"),
  batchId: uuid,
  sequence: positiveSequence,
  sourceId: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,119}$/),
  cursorFrom: z.string().max(8_000).nullable(),
  cursorTo: z.string().min(1).max(8_000),
  records: z.array(connectorExternalRecordSchema.strict()).max(200),
  ...backlog,
}).strict();
const rotate = frameBase.extend({
  kind: z.literal("rotate"),
  csrPem: pem,
  idempotencyKey: uuid,
}).strict();
export const agentFrameBodySchema = z.discriminatedUnion("kind", [heartbeat, batch, rotate]);
export const agentFrameResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("heartbeat"), acceptedAt: utcZDateTimeSchema }).strict(),
  z.object({ kind: z.literal("batch"), batchId: uuid, sequence: positiveSequence, acceptedAt: utcZDateTimeSchema }).strict(),
  z.object({
    kind: z.literal("rotate"),
    clientCertificatePem: pem,
    caCertificatePem: pem,
    signingKey: z.string().min(32).max(256),
    signingKeyId: keyId,
    expiresAt: utcZDateTimeSchema,
  }).strict(),
]);
