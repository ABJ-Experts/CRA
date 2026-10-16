import { z } from "zod";
import { idempotencyKeySchema } from "../../organizations/schemas/organization-input.schema.js";
import { utcZDateTimeSchema } from "../../products/schemas/release-market-lifecycle.schema.js";
import { pagedSchema } from "../../pagination/schemas/pagination.schema.js";

const text = (maximum: number) => z.string().trim().min(1).max(maximum);
const version = z.number().int().nonnegative();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const safeCode = z.string().regex(/^[a-z][a-z0-9_]{0,99}$/);
export const webhookEventIdSchema = z.string().regex(/^evt_[a-f0-9]{64}$/);

export const webhookEventTypeSchema = z.enum([
  "product.release.market_availability_changed",
  "product.release.lifecycle_changed",
  "product.release.placed_on_market_changed",
  "product.relationship.graph_changed",
  "vulnerability.assessment.submitted",
  "vulnerability.assessment.approved",
  "vulnerability.assessment.rejected",
  "vulnerability.assessment.superseded",
  "vulnerability.remediation_anchor.recorded",
  "vulnerability.remediation_anchor.corrected",
  "reporting.deadline.threshold_crossed",
  "reporting.deadline.breached",
  "reporting.filing.recorded",
  "connector.sync_completed",
  "connector.sync_failed",
]);
export const webhookDeliveryEventTypeSchema = z.enum([
  ...webhookEventTypeSchema.options,
  "webhook.test",
]);
export const webhookResourceTypeSchema = z.enum([
  "product",
  "release",
  "finding",
  "reporting_obligation",
  "connector",
  "sync_run",
]);
const uuidPath =
  "[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}";
const resourceLink = new RegExp(
  `^(?:/products/${uuidPath}(?:/releases/${uuidPath})?|/findings\\?findingId=${uuidPath}|/reporting\\?obligationId=${uuidPath}|/connectors/${uuidPath}(?:\\?runId=${uuidPath})?|/connectors/webhooks)$`,
);
export const webhookResourceReferenceSchema = z
  .object({
    type: webhookResourceTypeSchema,
    id: z.uuid(),
    url: z.string().max(500).regex(resourceLink),
  })
  .strict();
export const webhookEnvelopeSchema = z
  .object({
    schemaVersion: z.literal(1),
    eventId: webhookEventIdSchema,
    deliveryId: z.uuid(),
    occurredAt: utcZDateTimeSchema,
    eventType: webhookDeliveryEventTypeSchema,
    organizationId: z.uuid(),
    resource: webhookResourceReferenceSchema,
  })
  .strict();

export const webhookEventEnvelopeSchema = webhookEnvelopeSchema;

/** DNS and approved-host checks remain the server egress policy's responsibility. */
export const webhookUrlInputSchema = z
  .string()
  .trim()
  .min(8)
  .max(2048)
  .refine(
    (value) => /^https:\/\/[^/?#@:]+(?:\/[^?#]*)?$/i.test(value),
    "Use an HTTPS hostname without credentials, query, fragment, port or IP literal",
  )
  .pipe(
    z.url({
      protocol: /^https$/,
      hostname:
        /^(?!.*(?:^|\.)localhost$)(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z](?:[a-z0-9-]*[a-z0-9])?$/i,
      normalize: true,
    }),
  )
  .pipe(z.string().max(2048));
/** 32 bytes => 43 base64 symbols plus padding; final symbol has two zero bits. */
export const webhookSecretValueSchema = z
  .string()
  .regex(
    /^[A-Za-z0-9+/]{42}[AEIMQUYcgkosw048]=$/,
    "Supply a canonical base64-encoded 32-byte signing secret",
  );
export const webhookRetryPolicySchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(10).default(6),
    baseDelaySeconds: z.number().int().min(5).max(60).default(5),
    maxDelaySeconds: z.number().int().min(5).max(300).default(300),
  })
  .strict()
  .refine(
    (value) => value.maxDelaySeconds >= value.baseDelaySeconds,
    "Maximum delay must be at least the initial delay",
  );
const eventTypes = z
  .array(webhookEventTypeSchema)
  .min(1)
  .max(15)
  .refine(
    (values) => new Set(values).size === values.length,
    "Event types must be unique",
  );
const productIds = z
  .array(z.uuid())
  .min(1)
  .max(100)
  .refine(
    (values) => new Set(values).size === values.length,
    "Products must be unique",
  );
const subscriptionShape = {
  displayName: text(120),
  url: webhookUrlInputSchema,
  eventTypes,
  productIds,
  retryPolicy: webhookRetryPolicySchema.default({
    maxAttempts: 6,
    baseDelaySeconds: 5,
    maxDelaySeconds: 300,
  }),
};
const commandShape = {
  expectedVersion: version,
  idempotencyKey: idempotencyKeySchema,
};
export const createWebhookEndpointInputSchema = z
  .object({
    ...subscriptionShape,
    secretValue: webhookSecretValueSchema.optional(),
    idempotencyKey: idempotencyKeySchema,
  })
  .strict();
export const updateWebhookEndpointInputSchema = z
  .object({ ...subscriptionShape, ...commandShape })
  .strict();
export const rotateWebhookSecretInputSchema = z
  .object({
    ...commandShape,
    secretValue: webhookSecretValueSchema,
    overlapSeconds: z.number().int().min(0).max(86400).default(3600),
  })
  .strict();
export const enableWebhookEndpointInputSchema = z.object(commandShape).strict();
export const testWebhookEndpointInputSchema = z.object(commandShape).strict();
export const disableWebhookEndpointInputSchema = z
  .object({ ...commandShape, reason: text(500) })
  .strict();
export const revokeWebhookSecretInputSchema = z
  .object({ ...commandShape, reason: text(500) })
  .strict();
export const webhookEndpointStatusSchema = z.enum([
  "active",
  "disabled",
  "secret_required",
  "degraded",
]);
export const webhookFailureCategorySchema = z.enum([
  "timeout",
  "rate_limit",
  "receiver_unavailable",
  "receiver_rejected",
  "egress_blocked",
  "authorization",
  "configuration",
  "vault_unavailable",
  "payload_unavailable",
  "scope_unknown",
  "interrupted",
  "unknown",
]);
export const webhookEndpointSchema = z
  .object({
    id: z.uuid(),
    organizationId: z.uuid(),
    ...subscriptionShape,
    enabled: z.boolean(),
    status: webhookEndpointStatusSchema,
    hasSecret: z.boolean(),
    signingKeyId: z.uuid().nullable(),
    previousSigningKeyId: z.uuid().nullable(),
    previousKeyExpiresAt: utcZDateTimeSchema.nullable(),
    secretRevision: version,
    version,
    scopeRevision: version,
    destinationRevision: version,
    lastDeliveredAt: utcZDateTimeSchema.nullable(),
    lastFailureCategory: webhookFailureCategorySchema.nullable(),
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
  })
  .strict();
export const webhookDeliveryStatusSchema = z.enum([
  "pending",
  "delivering",
  "retrying",
  "succeeded",
  "failed",
  "canceled",
]);
export const webhookDeliverySchema = z
  .object({
    id: z.uuid(),
    endpointId: z.uuid(),
    eventId: webhookEventIdSchema,
    deliveryId: z.uuid(),
    eventType: webhookDeliveryEventTypeSchema,
    status: webhookDeliveryStatusSchema,
    resource: webhookResourceReferenceSchema,
    occurredAt: utcZDateTimeSchema,
    nextAttemptAt: utcZDateTimeSchema.nullable(),
    attemptCount: z.number().int().nonnegative(),
    lastHttpStatus: z.number().int().min(100).max(599).nullable(),
    lastFailureCategory: webhookFailureCategorySchema.nullable(),
    lastFailureCode: safeCode.nullable(),
    version,
    endpointVersion: version,
    scopeRevision: version,
    destinationRevision: version,
    replayParentId: z.uuid().nullable(),
    deadlineAt: utcZDateTimeSchema,
    completedAt: utcZDateTimeSchema.nullable(),
    createdAt: utcZDateTimeSchema,
    updatedAt: utcZDateTimeSchema,
  })
  .strict();
export const webhookAttemptSchema = z
  .object({
    id: z.uuid(),
    deliveryRowId: z.uuid(),
    attemptNumber: z.number().int().positive(),
    leaseGeneration: z.number().int().positive(),
    startedAt: utcZDateTimeSchema,
    finishedAt: utcZDateTimeSchema.nullable(),
    outcome: z.enum([
      "running",
      "succeeded",
      "retrying",
      "failed",
      "interrupted",
      "uncertain",
      "canceled",
    ]),
    httpStatus: z.number().int().min(100).max(599).nullable(),
    durationMs: z.number().int().nonnegative().max(120000).nullable(),
    failureCategory: webhookFailureCategorySchema.nullable(),
    failureCode: safeCode.nullable(),
    responseBytes: z.number().int().nonnegative().max(4096).nullable(),
  })
  .strict();
export const webhookDeliveryDetailSchema = z
  .object({
    delivery: webhookDeliverySchema,
    attempts: pagedSchema(webhookAttemptSchema),
  })
  .strict();
export const webhookReplayPreviewInputSchema = z
  .object({
    expectedDeliveryVersion: version,
    expectedEndpointVersion: version,
  })
  .strict();
export const webhookReplayPreviewSchema = z
  .object({
    deliveryRowId: z.uuid(),
    endpointId: z.uuid(),
    deliveryVersion: version,
    endpointVersion: version,
    previewDigest: digest,
    receiverChanged: z.boolean(),
    currentHost: text(253),
    previousHost: text(253).nullable(),
    currentDestination: webhookUrlInputSchema,
    previousDestination: webhookUrlInputSchema.nullable(),
    eventType: webhookDeliveryEventTypeSchema,
    resource: webhookResourceReferenceSchema,
    payloadSha256: digest,
  })
  .strict();
export const replayWebhookDeliveryInputSchema = z
  .object({
    expectedDeliveryVersion: version,
    expectedEndpointVersion: version,
    previewDigest: digest,
    idempotencyKey: idempotencyKeySchema,
    reason: text(500),
    confirmDestinationChange: z.boolean().default(false),
  })
  .strict();
export const webhookEndpointParamsSchema = z
  .object({ endpointId: z.uuid() })
  .strict();
export const webhookDeliveryParamsSchema = z
  .object({ endpointId: z.uuid(), deliveryId: z.uuid() })
  .strict();
const positiveQueryNumber = (maximum: number) =>
  z
    .union([
      z.number(),
      z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number),
    ])
    .pipe(z.number().int().min(1).max(maximum));
export const webhookPageQuerySchema = z
  .object({
    page: positiveQueryNumber(1000000).default(1),
    pageSize: positiveQueryNumber(100).default(15),
  })
  .strict();
export const webhookVerificationExampleSchema = z
  .object({
    algorithm: z.literal("HMAC-SHA-256"),
    timestampHeader: z.literal("Cra-Webhook-Timestamp"),
    eventIdHeader: z.literal("Cra-Webhook-Event-Id"),
    deliveryIdHeader: z.literal("Cra-Webhook-Delivery-Id"),
    signatureHeader: z.literal("Cra-Webhook-Signatures"),
    replayWindowSeconds: z.literal(300),
    signedContent: z.literal(
      "v1\\n<timestamp>\\n<key-id>\\n<event-id>\\n<delivery-id>\\n<exact-body-bytes>",
    ),
  })
  .strict();
export const webhookCatalogueEntrySchema = z
  .object({
    eventType: webhookEventTypeSchema,
    displayName: text(120),
    resourceType: webhookResourceTypeSchema,
  })
  .strict();
export const webhookCatalogueResponseSchema = z
  .object({
    eventTypes: z.array(webhookCatalogueEntrySchema).max(15),
    verification: webhookVerificationExampleSchema,
  })
  .strict();
export const webhookEndpointsResponseSchema = z
  .object({ endpoints: pagedSchema(webhookEndpointSchema) })
  .strict();
export const webhookEndpointResponseSchema = z
  .object({ endpoint: webhookEndpointSchema })
  .strict();
export const webhookDeliveriesResponseSchema = z
  .object({ deliveries: pagedSchema(webhookDeliverySchema) })
  .strict();
export const webhookDeliveryResponseSchema = z
  .object({ delivery: webhookDeliverySchema })
  .strict();
export const webhookDeliveryDetailResponseSchema = z
  .object({ detail: webhookDeliveryDetailSchema })
  .strict();
export const webhookReplayPreviewResponseSchema = z
  .object({ preview: webhookReplayPreviewSchema })
  .strict();
export const webhookVerificationExampleResponseSchema = z
  .object({ verification: webhookVerificationExampleSchema })
  .strict();
