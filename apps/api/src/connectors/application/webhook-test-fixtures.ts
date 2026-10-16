import type {
  WebhookEndpoint,
  WebhookDelivery,
} from "@repo/contracts/connectors/types";
export const webhookFixtureIds = {
  org: "10000000-0000-4000-8000-000000000001",
  actor: "10000000-0000-4000-8000-000000000002",
  endpoint: "10000000-0000-4000-8000-000000000003",
  product: "10000000-0000-4000-8000-000000000004",
  delivery: "10000000-0000-4000-8000-000000000005",
  key: "10000000-0000-4000-8000-000000000006",
  source: "10000000-0000-4000-8000-000000000007",
  idempotency: "10000000-0000-4000-8000-000000000008",
};
export function fixtureWebhookEndpoint(): WebhookEndpoint {
  return {
    id: webhookFixtureIds.endpoint,
    organizationId: webhookFixtureIds.org,
    displayName: "Receiver",
    url: "https://receiver.example/events",
    eventTypes: ["product.release.lifecycle_changed"],
    productIds: [webhookFixtureIds.product],
    retryPolicy: { maxAttempts: 6, baseDelaySeconds: 5, maxDelaySeconds: 300 },
    enabled: true,
    status: "active",
    hasSecret: true,
    signingKeyId: webhookFixtureIds.key,
    previousSigningKeyId: null,
    previousKeyExpiresAt: null,
    secretRevision: 1,
    version: 1,
    scopeRevision: 1,
    destinationRevision: 1,
    lastDeliveredAt: null,
    lastFailureCategory: null,
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:00.000Z",
  };
}
export function fixtureWebhookDelivery(): WebhookDelivery {
  return {
    id: webhookFixtureIds.delivery,
    endpointId: webhookFixtureIds.endpoint,
    eventId: `evt_${"a".repeat(64)}`,
    deliveryId: webhookFixtureIds.delivery,
    eventType: "product.release.lifecycle_changed",
    status: "failed",
    resource: {
      type: "product",
      id: webhookFixtureIds.product,
      url: `/products/${webhookFixtureIds.product}`,
    },
    occurredAt: "2026-09-29T12:00:00.000Z",
    nextAttemptAt: null,
    attemptCount: 1,
    lastHttpStatus: 503,
    lastFailureCategory: "receiver_unavailable",
    lastFailureCode: "receiver_unavailable",
    version: 2,
    endpointVersion: 1,
    scopeRevision: 1,
    destinationRevision: 1,
    replayParentId: null,
    deadlineAt: "2026-09-30T12:00:00.000Z",
    completedAt: "2026-09-29T12:00:01.000Z",
    createdAt: "2026-09-29T12:00:00.000Z",
    updatedAt: "2026-09-29T12:00:01.000Z",
  };
}
