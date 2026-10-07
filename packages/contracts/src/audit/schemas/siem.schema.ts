import { z } from "zod";
import { auditSequenceSchema } from "./audit-chain.schema.js";
const id = z.uuid();
const instant = z.iso.datetime({ offset: true });
const version = z.number().int().nonnegative();
const code = z.string().regex(/^[a-z][a-z0-9_]{0,79}$/);
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const siemEventClassSchema = z.enum([
  "access_control",
  "organization",
  "products",
  "sboms",
  "findings",
  "evidence",
  "technical_files",
  "suppliers",
  "frameworks",
  "reporting",
  "integrations",
  "audit_access",
]);
export const SIEM_PRODUCT_EVENT_CLASSES = [
  "products",
  "sboms",
  "findings",
  "evidence",
  "technical_files",
  "suppliers",
  "reporting",
] as const;
export const siemTransportSchema = z.enum(["https", "syslog_tls"]);
export const siemFormatSchema = z.enum(["json", "cef"]);
/** Public DNS/IP and deployment approval are rechecked by the transport. */
export const siemEndpointSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => {
    const match =
      /^(https|tls):\/\/((?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?)(?::([0-9]{1,5}))?(\/[^?#\\\s]*)?$/i.exec(
        value,
      );
    if (!match || /(?:^|\.)localhost$/i.test(match[2]!)) return false;
    const port = match[3] === undefined ? 443 : Number(match[3]);
    return (
      port >= 1 &&
      port <= 65535 &&
      (match[1] === "https" || match[4] === undefined || match[4] === "/")
    );
  }, "Use an HTTPS or TLS DNS hostname without credentials, query or fragment");
export const siemConfigSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    transport: siemTransportSchema,
    format: siemFormatSchema,
    endpoint: siemEndpointSchema,
    eventClasses: z
      .array(siemEventClassSchema)
      .min(1)
      .max(12)
      .refine((v) => new Set(v).size === v.length),
    productIds: z
      .array(id)
      .max(100)
      .refine((v) => new Set(v).size === v.length),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      !value.endpoint.startsWith(
        value.transport === "https" ? "https://" : "tls://",
      )
    )
      ctx.addIssue({
        code: "custom",
        path: ["endpoint"],
        message: "Endpoint must match transport",
      });
    if (
      value.eventClasses.some((v) =>
        (SIEM_PRODUCT_EVENT_CLASSES as readonly string[]).includes(v),
      ) &&
      value.productIds.length === 0
    )
      ctx.addIssue({
        code: "custom",
        path: ["productIds"],
        message: "Select explicit products",
      });
  });
export const siemCreateDestinationSchema = siemConfigSchema
  .extend({ requestId: id, destinationId: id })
  .strict();
export const siemOperationSchema = z
  .object({
    requestId: id,
    expectedVersion: version,
    reason: z.string().trim().min(1).max(200).optional(),
  })
  .strict();
export const siemUpdateDestinationSchema = siemConfigSchema
  .extend({
    requestId: id,
    expectedVersion: version,
    backlogPolicy: z.literal("cancel_pending_start_future"),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
const pem = z
  .string()
  .min(32)
  .max(65536)
  .refine(
    (v) => v.includes("-----BEGIN ") && v.includes("-----END "),
    "Supply PEM material",
  );
export const siemCredentialSchema = z
  .discriminatedUnion("mode", [
    z
      .object({
        mode: z.literal("bearer"),
        token: z
          .string()
          .min(1)
          .max(4096)
          .regex(/^[\x21-\x7e]+$/),
      })
      .strict(),
    z
      .object({
        mode: z.literal("mtls"),
        certificate: pem,
        privateKey: pem,
        ca: pem.optional(),
      })
      .strict(),
  ])
  .superRefine((credential, context) => {
    // The reused M11 vault accepts at most 20,000 serialized characters. Bound
    // UTF-8 bytes as well so every parsed wire bundle fits the installed vault.
    const serialized = JSON.stringify(credential);
    let bytes = 0;
    for (const character of serialized) {
      const point = character.codePointAt(0)!;
      bytes += point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4;
    }
    if (bytes > 20000)
      context.addIssue({
        code: "custom",
        message: "credential_bundle_too_large",
      });
  });
export const siemCredentialInputSchema = siemOperationSchema
  .extend({ credential: siemCredentialSchema })
  .strict();
export const siemDestinationParamsSchema = z.object({ id }).strict();
export const siemDeliveryParamsSchema = z
  .object({ id, deliveryId: id })
  .strict();
export const siemReadQuerySchema = z.object({ requestId: id }).strict();
export const siemPageQuerySchema = z
  .object({
    requestId: id,
    cursor: z
      .string()
      .min(1)
      .max(6000)
      .regex(/^[A-Za-z0-9_.~-]+$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
  })
  .strict();
export const siemEventSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: id,
    organizationId: id,
    occurredAt: instant,
    eventClass: siemEventClassSchema,
    action: z.string().regex(/^[a-z][a-z0-9_.]{0,119}$/),
    outcome: z.enum([
      "intent",
      "completed",
      "failed",
      "denied",
      "cancelled",
      "unknown",
    ]),
    actorType: z.enum([
      "user",
      "service_account",
      "system",
      "ai",
      "operator",
      "unknown",
    ]),
    actorId: id.nullable(),
    resourceType: z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),
    resourceId: id.nullable(),
    correlationId: id.nullable(),
    chainSequence: auditSequenceSchema.refine((v) => v !== "0"),
  })
  .strict();
export const siemDestinationSchema = siemConfigSchema
  .extend({
    id,
    version,
    state: z.enum(["draft", "enabled", "disabled", "paused"]),
    credentialState: z.enum(["missing", "active", "revoked"]),
    authorityUserId: id.nullable(),
    createdAt: instant,
    updatedAt: instant,
    health: z
      .object({
        pendingCount: z.number().int().nonnegative(),
        failedCount: z.number().int().nonnegative(),
        oldestPendingAt: instant.nullable(),
        lastAcceptedAt: instant.nullable(),
        safeFailureCode: code.nullable(),
      })
      .strict(),
  })
  .strict();
export const siemDestinationListSchema = z
  .object({ items: z.array(siemDestinationSchema).max(10) })
  .strict();
export const siemDeliveryStateSchema = z.enum([
  "queued",
  "processing",
  "retrying",
  "accepted",
  "sent_unacknowledged",
  "failed",
  "cancelled",
]);
export const siemAttemptSchema = z
  .object({
    id,
    attempt: z.number().int().min(1),
    state: siemDeliveryStateSchema,
    safeFailureCode: code.nullable(),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    startedAt: instant,
    finishedAt: instant.nullable(),
  })
  .strict();
export const siemDeliverySchema = z
  .object({
    id,
    destinationId: id,
    eventId: id,
    destinationRevision: version,
    state: siemDeliveryStateSchema,
    attemptCount: z.number().int().nonnegative(),
    createdAt: instant,
    updatedAt: instant,
    nextAttemptAt: instant.nullable(),
    safeFailureCode: code.nullable(),
    parentDeliveryId: id.nullable(),
    event: siemEventSchema,
  })
  .strict();
export const siemDeliveryDetailSchema = siemDeliverySchema
  .extend({ attempts: z.array(siemAttemptSchema).max(100) })
  .strict();
export const siemDeliveryPageSchema = z
  .object({
    items: z.array(siemDeliverySchema).max(200),
    nextCursor: z.string().max(6000).nullable(),
  })
  .strict();
export const siemReplayPreviewSchema = z
  .object({
    deliveryId: id,
    destinationId: id,
    expectedVersion: version,
    endpoint: siemEndpointSchema,
    format: siemFormatSchema,
    transport: siemTransportSchema,
    event: siemEventSchema,
    previewDigest: digest,
    expiresAt: instant,
  })
  .strict();
export const siemReplayInputSchema = siemOperationSchema
  .extend({
    previewDigest: digest,
    confirmRecipient: z.literal(true),
    reason: z.string().trim().min(1).max(200),
  })
  .strict();
export const siemTestResultSchema = z
  .object({
    destination: siemDestinationSchema,
    state: z.enum(["accepted", "sent_unacknowledged", "failed"]),
    safeFailureCode: code.nullable(),
  })
  .strict();
export const siemCatalogueSchema = z
  .object({
    version: z.literal(1),
    eventClasses: z
      .array(
        z
          .object({
            id: siemEventClassSchema,
            label: z.string().min(1).max(100),
            productScoped: z.boolean(),
          })
          .strict(),
      )
      .max(12),
    transports: z.array(siemTransportSchema).max(2),
    formats: z.array(siemFormatSchema).max(2),
  })
  .strict();
