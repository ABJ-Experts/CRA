import { z } from "zod";

export const LICENSE_CAPABILITIES = [
  "administration",
  "products",
  "sboms",
  "vulnerabilities",
  "findings",
  "reporting",
  "technical_files",
  "evidence",
  "suppliers",
  "frameworks",
  "connectors",
  "tasks",
  "notifications",
  "dashboards",
  "scheduled_reports",
  "portfolio",
  "ai",
] as const;
export const licenseCapabilitySchema = z.enum(LICENSE_CAPABILITIES);
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const timestamp = z.iso.datetime({ offset: false });
export const licenseLimitsSchema = z
  .object({
    activeMembers: integer.nullable(),
    products: integer.nullable(),
    storageBytes: integer.nullable(),
  })
  .strict();
export const licenseClaimsSchema = z
  .object({
    schemaVersion: z.literal(1),
    licenseId: z.uuid(),
    sequence: integer.min(1),
    issuer: z.string().min(1).max(200),
    organizationId: z.uuid(),
    instanceId: z.uuid(),
    issuedAt: timestamp,
    startsAt: timestamp,
    expiresAt: timestamp,
    graceDays: z.literal(30),
    entitlements: z
      .array(licenseCapabilitySchema)
      .max(LICENSE_CAPABILITIES.length)
      .refine(
        (items) => new Set(items).size === items.length,
        "Duplicate entitlements",
      ),
    limits: licenseLimitsSchema,
  })
  .strict()
  .refine(
    (claims) =>
      Date.parse(claims.issuedAt) <= Date.parse(claims.startsAt) &&
      Date.parse(claims.startsAt) < Date.parse(claims.expiresAt),
    "Invalid licence timestamp order",
  );
export const licenseArtifactSchema = z
  .string()
  .min(1)
  .max(32768)
  .regex(
    /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    "Invalid compact JWS",
  );
export const licenseActivationInputSchema = z
  .object({
    artifact: z
      .string()
      .min(1)
      .max(32768)
      .refine(
        (artifact) =>
          Array.from(artifact).every(
            (character) => character.charCodeAt(0) <= 127,
          ),
        "Artifact must be ASCII",
      ),
    expectedVersion: integer,
    idempotencyKey: z.uuid(),
  })
  .strict();
export const licenseStateSchema = z.enum([
  "missing",
  "active",
  "grace",
  "expired_read_only",
  "invalid",
  "clock_untrusted",
]);
export const licenseUsageSchema = z
  .object({
    activeMembers: integer,
    products: integer,
    storageBytes: integer,
    storageReservedBytes: integer,
    protectedStorageBytes: integer,
    availability: z.enum(["ready", "unavailable"]),
  })
  .strict();
export const licensePolicyResponseSchema = z
  .object({
    state: licenseStateSchema,
    reasons: z.array(z.string().min(1).max(200)).max(30),
    warnings: z.array(z.string().min(1).max(200)).max(30),
    effectiveCapabilities: z
      .array(licenseCapabilitySchema)
      .max(LICENSE_CAPABILITIES.length),
    disabledCapabilities: z
      .array(licenseCapabilitySchema)
      .max(LICENSE_CAPABILITIES.length),
    customerWritesAllowed: z.boolean(),
    evidenceExportAllowed: z.literal(true),
    evaluatedAt: timestamp,
    expiresAt: timestamp.nullable(),
    graceEndsAt: timestamp.nullable(),
  })
  .strict()
  .refine((policy) => {
    const writable = policy.state === "active" || policy.state === "grace";
    return (
      policy.customerWritesAllowed === writable &&
      (writable || policy.effectiveCapabilities.length === 0)
    );
  }, "Policy state contradicts access")
  .refine((policy) => {
    if (policy.expiresAt === null || policy.graceEndsAt === null)
      return (
        policy.expiresAt === null &&
        policy.graceEndsAt === null &&
        policy.state !== "active" &&
        policy.state !== "grace" &&
        policy.state !== "expired_read_only"
      );
    const expiry = Date.parse(policy.expiresAt);
    const grace = Date.parse(policy.graceEndsAt);
    const now = Date.parse(policy.evaluatedAt);
    if (grace - expiry !== 30 * 24 * 60 * 60 * 1000) return false;
    if (policy.state === "active") return now < expiry;
    if (policy.state === "grace") return now >= expiry && now < grace;
    if (policy.state === "expired_read_only") return now >= grace;
    return true;
  }, "Policy dates contradict state");
export const licenseCurrentResponseSchema = z
  .object({
    policy: licensePolicyResponseSchema,
    version: integer,
    instanceId: z.uuid(),
    claims: licenseClaimsSchema.nullable(),
    keyId: z.string().min(1).max(200).nullable(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
    usage: licenseUsageSchema,
    lastRejected: z
      .object({ reason: z.string().min(1).max(200), occurredAt: timestamp })
      .strict()
      .nullable(),
  })
  .strict();
export const licenseHistoryQuerySchema = z
  .object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().min(1).max(2048).optional(),
  })
  .strict();
export const licenseHistoryItemSchema = z
  .object({
    id: z.uuid(),
    occurredAt: timestamp,
    action: z.enum(["activated", "rejected"]),
    reason: z.string().max(200).nullable(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .nullable(),
  })
  .strict();
export const licenseHistoryResponseSchema = z
  .object({
    items: z.array(licenseHistoryItemSchema).max(100),
    nextCursor: z.string().max(2048).nullable(),
  })
  .strict();
export const licenseActivationResponseSchema = z
  .object({
    version: integer.min(1),
    digest: z.string().regex(/^[a-f0-9]{64}$/),
    licenseId: z.uuid(),
    replayed: z.boolean(),
  })
  .strict();

/** A narrow one-use upload authority; never an authenticated session identity. */
export const uploadPathSchema = z
  .object({
    operationId: z.uuid(),
    token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  })
  .strict();
