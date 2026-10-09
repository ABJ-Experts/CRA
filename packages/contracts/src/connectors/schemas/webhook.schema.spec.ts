import { describe, expect, it } from "vitest";
import * as schemas from "./webhook.schema.js";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const now = "2026-09-29T10:00:00.000Z";
const digest = "a".repeat(64);
const eventType = "product.release.lifecycle_changed";
const secretValue = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
const input = {
  displayName: "Ops sink",
  url: "https://hooks.example.com/cra",
  eventTypes: [eventType],
  productIds: [id],
  idempotencyKey: id,
};
const endpoint = {
  ...input,
  id,
  organizationId: otherId,
  enabled: false,
  status: "disabled",
  hasSecret: true,
  signingKeyId: id,
  previousSigningKeyId: null,
  previousKeyExpiresAt: null,
  secretRevision: 1,
  version: 1,
  scopeRevision: 1,
  destinationRevision: 1,
  retryPolicy: { maxAttempts: 6, baseDelaySeconds: 5, maxDelaySeconds: 300 },
  lastDeliveredAt: null,
  lastFailureCategory: null,
  createdAt: now,
  updatedAt: now,
};
const { idempotencyKey: endpointCommandKey, ...endpointRead } = endpoint;
const resource = { type: "product", id, url: `/products/${id}` };
const delivery = {
  id,
  endpointId: otherId,
  eventId: `evt_${digest}`,
  deliveryId: id,
  eventType,
  status: "retrying",
  resource,
  occurredAt: now,
  nextAttemptAt: now,
  attemptCount: 1,
  lastHttpStatus: 503,
  lastFailureCategory: "receiver_unavailable",
  lastFailureCode: "http_503",
  version: 2,
  endpointVersion: 1,
  scopeRevision: 1,
  destinationRevision: 1,
  replayParentId: null,
  deadlineAt: now,
  completedAt: null,
  createdAt: now,
  updatedAt: now,
};
const page = (row: unknown) => ({
  rows: [row],
  total: 1,
  page: 1,
  pageSize: 15,
  pageCount: 1,
});

describe("webhook contracts", () => {
  it("canonicalizes approved HTTPS URLs without narrowing valid escaped paths", () => {
    expect(
      schemas.webhookUrlInputSchema.parse(
        "HTTPS://HOOKS.EXAMPLE.COM/hooks%20v1~",
      ),
    ).toBe("https://hooks.example.com/hooks%20v1~");
    expect(
      schemas.webhookUrlInputSchema.parse("https://hooks.example.com"),
    ).toBe("https://hooks.example.com/");
  });
  it("uses the exact catalogue and keeps tests unsubscribable", () => {
    expect(endpointCommandKey).toBe(id);
    expect(schemas.webhookEventTypeSchema.options).toHaveLength(15);
    expect(
      schemas.webhookEventTypeSchema.safeParse("webhook.test").success,
    ).toBe(false);
    expect(
      schemas.webhookEventTypeSchema.safeParse("product.regulatory_event")
        .success,
    ).toBe(false);
  });
  it("accepts disabled creation without a secret and canonical 32-byte credentials", () => {
    expect(
      schemas.createWebhookEndpointInputSchema.parse(input).retryPolicy,
    ).toEqual(endpoint.retryPolicy);
    expect(
      schemas.createWebhookEndpointInputSchema.parse({ ...input, secretValue })
        .secretValue,
    ).toBe(secretValue);
    for (const secret of [
      "x".repeat(32),
      secretValue.replace("A=", "B="),
      secretValue.slice(0, -1),
      `${secretValue}\n`,
    ]) {
      expect(
        schemas.createWebhookEndpointInputSchema.safeParse({
          ...input,
          secretValue: secret,
        }).success,
      ).toBe(false);
    }
  });
  it("rejects duplicate or unbounded subscriptions and forged fields", () => {
    for (const extra of [
      { productIds: [] },
      { productIds: [id, id] },
      { productIds: Array(101).fill(id) },
      { eventTypes: [eventType, eventType] },
      { eventTypes: [] },
      { organizationId: otherId },
    ]) {
      expect(
        schemas.createWebhookEndpointInputSchema.safeParse({
          ...input,
          ...extra,
        }).success,
      ).toBe(false);
    }
  });
  it("rejects unsafe URLs at every wire boundary", () => {
    for (const url of [
      "not a URL",
      "http://hooks.example.com",
      "https://user:pw@hooks.example.com",
      "https://hooks.example.com?token=canary",
      "https://hooks.example.com#canary",
      "https://hooks.example.com:8443/path",
      "https://127.0.0.1/hook",
      "https://8.8.8.8/hook",
      "https://[::1]/hook",
      "https://localhost/hook",
      "https://sink.localhost/hook",
    ]) {
      expect(
        schemas.createWebhookEndpointInputSchema.safeParse({ ...input, url })
          .success,
      ).toBe(false);
    }
  });
  it("bounds retry policies and rotation overlap", () => {
    for (const retryPolicy of [
      { maxAttempts: 0 },
      { maxAttempts: 11 },
      { baseDelaySeconds: 4 },
      { baseDelaySeconds: 61 },
      { maxDelaySeconds: 301 },
      { baseDelaySeconds: 60, maxDelaySeconds: 59 },
    ]) {
      expect(
        schemas.createWebhookEndpointInputSchema.safeParse({
          ...input,
          retryPolicy,
        }).success,
      ).toBe(false);
    }
    expect(
      schemas.rotateWebhookSecretInputSchema.parse({
        secretValue,
        expectedVersion: 1,
        idempotencyKey: id,
      }).overlapSeconds,
    ).toBe(3600);
    for (const overlapSeconds of [-1, 86401])
      expect(
        schemas.rotateWebhookSecretInputSchema.safeParse({
          secretValue,
          expectedVersion: 1,
          idempotencyKey: id,
          overlapSeconds,
        }).success,
      ).toBe(false);
    expect(
      schemas.updateWebhookEndpointInputSchema.parse({
        ...input,
        expectedVersion: 1,
      }).expectedVersion,
    ).toBe(1);
    expect(
      schemas.updateWebhookEndpointInputSchema.safeParse({
        ...input,
        expectedVersion: 1,
        enabled: true,
      }).success,
    ).toBe(false);
  });
  it("requires concurrency and action reason where appropriate", () => {
    const command = { expectedVersion: 1, idempotencyKey: id };
    expect(schemas.enableWebhookEndpointInputSchema.parse(command)).toEqual(
      command,
    );
    expect(schemas.testWebhookEndpointInputSchema.parse(command)).toEqual(
      command,
    );
    expect(
      schemas.disableWebhookEndpointInputSchema.parse({
        ...command,
        reason: "Retiring receiver",
      }).reason,
    ).toBe("Retiring receiver");
    expect(
      schemas.revokeWebhookSecretInputSchema.safeParse(command).success,
    ).toBe(false);
    expect(
      schemas.revokeWebhookSecretInputSchema.parse({
        ...command,
        reason: "Compromised key",
      }).reason,
    ).toBe("Compromised key");
  });
  it("never returns credentials, envelopes or upstream payloads", () => {
    expect(schemas.webhookEndpointSchema.parse(endpointRead).signingKeyId).toBe(
      id,
    );
    for (const key of ["secretValue", "ciphertext", "envelope", "keyId"])
      expect(
        schemas.webhookEndpointSchema.safeParse({
          ...endpointRead,
          [key]: "canary",
        }).success,
      ).toBe(false);
    expect(schemas.webhookDeliverySchema.parse(delivery).eventId).toBe(
      `evt_${digest}`,
    );
    expect(
      schemas.webhookDeliverySchema.safeParse({
        ...delivery,
        payload: { body: "secret report body" },
      }).success,
    ).toBe(false);
    expect(
      schemas.webhookDeliverySchema.safeParse({
        ...delivery,
        eventId: "evt_short",
      }).success,
    ).toBe(false);
    expect(
      schemas.webhookDeliverySchema.safeParse({
        ...delivery,
        deliveryId: "del_short",
      }).success,
    ).toBe(false);
  });
  it("parses a minimal envelope with real finding/reporting links", () => {
    for (const reference of [
      resource,
      { type: "finding", id, url: `/findings?findingId=${id}` },
      {
        type: "reporting_obligation",
        id,
        url: `/reporting?obligationId=${id}`,
      },
    ]) {
      const envelope = schemas.webhookEnvelopeSchema.parse({
        schemaVersion: 1,
        eventId: `evt_${digest}`,
        deliveryId: id,
        occurredAt: now,
        eventType: "webhook.test",
        organizationId: otherId,
        resource: reference,
      });
      expect(envelope.resource).toEqual(reference);
      expect(
        schemas.webhookEnvelopeSchema.safeParse({ ...envelope, body: "canary" })
          .success,
      ).toBe(false);
    }
    for (const url of [
      "//evil.test/path",
      "https://evil.test/path",
      "/findings?secret=canary",
      "/products/not-an-id",
    ])
      expect(
        schemas.webhookResourceReferenceSchema.safeParse({ ...resource, url })
          .success,
      ).toBe(false);
  });
  it("requires replay preview fences, reason and changed-destination confirmation", () => {
    const preview = {
      deliveryRowId: id,
      endpointId: otherId,
      deliveryVersion: 2,
      endpointVersion: 3,
      previewDigest: digest,
      receiverChanged: true,
      currentHost: "hooks.example.com",
      previousHost: "old-hooks.example.com",
      currentDestination: "https://hooks.example.com/new-hook",
      previousDestination: "https://old-hooks.example.com/old-hook",
      eventType,
      resource,
      payloadSha256: digest,
    };
    expect(
      schemas.webhookReplayPreviewSchema.parse(preview).receiverChanged,
    ).toBe(true);
    const fences = { expectedDeliveryVersion: 2, expectedEndpointVersion: 3 };
    expect(schemas.webhookReplayPreviewInputSchema.parse(fences)).toEqual(
      fences,
    );
    expect(
      schemas.replayWebhookDeliveryInputSchema.safeParse({
        ...fences,
        previewDigest: digest,
        idempotencyKey: id,
      }).success,
    ).toBe(false);
    expect(
      schemas.replayWebhookDeliveryInputSchema.parse({
        ...fences,
        previewDigest: digest,
        idempotencyKey: id,
        reason: "Receiver restored",
      }).confirmDestinationChange,
    ).toBe(false);
    expect(
      schemas.replayWebhookDeliveryInputSchema.parse({
        ...fences,
        previewDigest: digest,
        idempotencyKey: id,
        reason: "Moved receiver",
        confirmDestinationChange: true,
      }).confirmDestinationChange,
    ).toBe(true);
  });
  it("bounds strict query/path and response envelopes", () => {
    expect(
      schemas.webhookPageQuerySchema.parse({ page: "2", pageSize: "25" }),
    ).toEqual({ page: 2, pageSize: 25 });
    expect(schemas.webhookPageQuerySchema.parse({})).toEqual({
      page: 1,
      pageSize: 15,
    });
    for (const query of [
      { page: "-1" },
      { pageSize: "101" },
      { page: "2x" },
      { organizationId: id },
    ])
      expect(schemas.webhookPageQuerySchema.safeParse(query).success).toBe(
        false,
      );
    expect(
      schemas.webhookEndpointParamsSchema.parse({ endpointId: id }).endpointId,
    ).toBe(id);
    expect(
      schemas.webhookDeliveryParamsSchema.parse({
        endpointId: id,
        deliveryId: otherId,
      }).deliveryId,
    ).toBe(otherId);
    const attempt = {
      id,
      deliveryRowId: id,
      attemptNumber: 1,
      leaseGeneration: 1,
      startedAt: now,
      finishedAt: now,
      outcome: "interrupted",
      httpStatus: null,
      durationMs: null,
      failureCategory: "interrupted",
      failureCode: "lease_expired",
      responseBytes: null,
    };
    const detail = { delivery, attempts: page(attempt) };
    expect(
      schemas.webhookEndpointResponseSchema.parse({ endpoint: endpointRead })
        .endpoint.id,
    ).toBe(id);
    expect(
      schemas.webhookEndpointsResponseSchema.parse({
        endpoints: page(endpointRead),
      }).endpoints.total,
    ).toBe(1);
    expect(
      schemas.webhookDeliveriesResponseSchema.parse({
        deliveries: page(delivery),
      }).deliveries.total,
    ).toBe(1);
    expect(
      schemas.webhookDeliveryDetailResponseSchema.parse({ detail }).detail
        .attempts.rows[0]?.outcome,
    ).toBe("interrupted");
    expect(
      schemas.webhookDeliveryResponseSchema.parse({ delivery }).delivery.id,
    ).toBe(id);
  });
  it("documents exact keyed signature headers and publishes the catalogue", () => {
    const verification = {
      algorithm: "HMAC-SHA-256",
      timestampHeader: "Cra-Webhook-Timestamp",
      eventIdHeader: "Cra-Webhook-Event-Id",
      deliveryIdHeader: "Cra-Webhook-Delivery-Id",
      signatureHeader: "Cra-Webhook-Signatures",
      replayWindowSeconds: 300,
      signedContent:
        "v1\\n<timestamp>\\n<key-id>\\n<event-id>\\n<delivery-id>\\n<exact-body-bytes>",
    };
    expect(
      schemas.webhookVerificationExampleResponseSchema.parse({ verification })
        .verification.signatureHeader,
    ).toBe("Cra-Webhook-Signatures");
    expect(
      schemas.webhookCatalogueResponseSchema.parse({
        eventTypes: [
          {
            eventType,
            displayName: "Release lifecycle changed",
            resourceType: "release",
          },
        ],
        verification,
      }).eventTypes,
    ).toHaveLength(1);
  });
});
