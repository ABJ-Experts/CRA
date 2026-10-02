import type {
  WebhookEndpoint,
  WebhookDelivery,
  WebhookReplayPreview,
} from "@repo/contracts/connectors/types";
export const endpointId = "11111111-1111-4111-8111-111111111111";
export const productId = "22222222-2222-4222-8222-222222222222";
export const organizationId = "33333333-3333-4333-8333-333333333333";
export const deliveryId = "44444444-4444-4444-8444-444444444444";
export const endpoint: WebhookEndpoint = {
  id: endpointId,
  organizationId,
  displayName: "Compliance receiver",
  url: "https://receiver.example/events",
  eventTypes: ["product.release.lifecycle_changed"],
  productIds: [productId],
  retryPolicy: { maxAttempts: 6, baseDelaySeconds: 5, maxDelaySeconds: 300 },
  enabled: false,
  status: "disabled",
  hasSecret: true,
  signingKeyId: "55555555-5555-4555-8555-555555555555",
  previousSigningKeyId: null,
  previousKeyExpiresAt: null,
  secretRevision: 1,
  version: 1,
  scopeRevision: 1,
  destinationRevision: 1,
  lastDeliveredAt: null,
  lastFailureCategory: null,
  createdAt: "2026-09-29T00:00:00Z",
  updatedAt: "2026-09-29T00:00:00Z",
};
export const delivery: WebhookDelivery = {
  id: deliveryId,
  endpointId,
  eventId: `evt_${"a".repeat(64)}`,
  deliveryId,
  eventType: "product.release.lifecycle_changed",
  status: "failed",
  resource: { type: "product", id: productId, url: `/products/${productId}` },
  occurredAt: "2026-09-29T00:00:00Z",
  nextAttemptAt: null,
  attemptCount: 1,
  lastHttpStatus: 503,
  lastFailureCategory: "receiver_unavailable",
  lastFailureCode: "http_503",
  version: 1,
  endpointVersion: 1,
  scopeRevision: 1,
  destinationRevision: 1,
  replayParentId: null,
  deadlineAt: "2026-09-30T00:00:00Z",
  completedAt: "2026-09-29T01:00:00Z",
  createdAt: "2026-09-29T00:00:00Z",
  updatedAt: "2026-09-29T00:00:00Z",
};
export const preview: WebhookReplayPreview = {
  deliveryRowId: deliveryId,
  endpointId,
  deliveryVersion: 1,
  endpointVersion: 1,
  previewDigest: "b".repeat(64),
  receiverChanged: true,
  currentHost: "receiver.example",
  currentDestination: "https://receiver.example/events",
  previousHost: "old.example",
  previousDestination: "https://old.example/events",
  eventType: delivery.eventType,
  resource: delivery.resource,
  payloadSha256: "c".repeat(64),
};
export function page<T>(rows: T[], current = 1, pageCount = 1) {
  return { rows, total: rows.length, page: current, pageSize: 15, pageCount };
}
export const secret = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";
