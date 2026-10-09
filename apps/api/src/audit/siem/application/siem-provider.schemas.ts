import { z } from "zod";
const envelope = z
  .object({
    format: z.literal("aes-256-gcm-v1"),
    keyId: z.string().min(1).max(80),
    ciphertext: z.string().max(300000),
    nonce: z.string().max(100),
    authTag: z.string().max(100),
  })
  .strict();
export const siemClaimSchema = z
  .object({
    organizationId: z.uuid(),
    deliveryId: z.uuid(),
    destinationId: z.uuid(),
    leaseToken: z.uuid(),
    version: z.number().int().nonnegative(),
    workerId: z.string().max(100),
    eventId: z.uuid(),
    payloadBytes: z.string().max(8192),
    protocol: z.enum(["https", "syslog_tls"]),
    endpoint: z.string().max(2048),
    format: z.enum(["json", "cef"]),
    credentials: envelope,
    credentialId: z.uuid(),
    credentialRevision: z.number().int().positive(),
  })
  .strict();
export const siemTestContextSchema = z
  .object({
    organizationId: z.uuid(),
    destinationId: z.uuid(),
    credentials: envelope,
    credentialId: z.uuid(),
    credentialRevision: z.number().int().positive(),
    endpoint: z.string().max(2048),
    format: z.enum(["json", "cef"]),
    transport: z.enum(["https", "syslog_tls"]),
    authorityUserId: z.uuid().nullable(),
  })
  .strict();
export const siemFingerprintKeySchema = z
  .object({ keyId: z.string().nullable() })
  .strict();
export const siemMutationSchema = z.object({ ok: z.literal(true) }).strict();
