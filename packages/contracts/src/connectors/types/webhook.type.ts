import type { z } from "zod";
import type {
  webhookEventTypeSchema,
  webhookDeliveryEventTypeSchema,
  webhookResourceReferenceSchema,
  webhookEnvelopeSchema,
  webhookEventEnvelopeSchema,
  webhookEndpointSchema,
  webhookEndpointStatusSchema,
  webhookDeliverySchema,
  webhookDeliveryStatusSchema,
  webhookAttemptSchema,
  webhookDeliveryDetailSchema,
  webhookFailureCategorySchema,
  webhookRetryPolicySchema,
  createWebhookEndpointInputSchema,
  updateWebhookEndpointInputSchema,
  rotateWebhookSecretInputSchema,
  enableWebhookEndpointInputSchema,
  testWebhookEndpointInputSchema,
  disableWebhookEndpointInputSchema,
  revokeWebhookSecretInputSchema,
  webhookReplayPreviewInputSchema,
  webhookReplayPreviewSchema,
  replayWebhookDeliveryInputSchema,
  webhookVerificationExampleSchema,
  webhookCatalogueResponseSchema,
  webhookCatalogueEntrySchema,
  webhookPageQuerySchema,
  webhookEndpointParamsSchema,
  webhookDeliveryParamsSchema,
  webhookEndpointsResponseSchema,
  webhookEndpointResponseSchema,
  webhookDeliveriesResponseSchema,
  webhookDeliveryResponseSchema,
  webhookDeliveryDetailResponseSchema,
  webhookReplayPreviewResponseSchema,
} from "../schemas/webhook.schema.js";

export type WebhookEventType = z.output<typeof webhookEventTypeSchema>;
export type WebhookDeliveryEventType = z.output<
  typeof webhookDeliveryEventTypeSchema
>;
export type WebhookResourceReference = z.output<
  typeof webhookResourceReferenceSchema
>;
export type WebhookEnvelope = z.output<typeof webhookEnvelopeSchema>;
export type WebhookEventEnvelope = z.output<typeof webhookEventEnvelopeSchema>;
export type WebhookEndpoint = z.output<typeof webhookEndpointSchema>;
export type WebhookEndpointStatus = z.output<
  typeof webhookEndpointStatusSchema
>;
export type WebhookDelivery = z.output<typeof webhookDeliverySchema>;
export type WebhookDeliveryStatus = z.output<
  typeof webhookDeliveryStatusSchema
>;
export type WebhookAttempt = z.output<typeof webhookAttemptSchema>;
export type WebhookDeliveryDetail = z.output<
  typeof webhookDeliveryDetailSchema
>;
export type WebhookFailureCategory = z.output<
  typeof webhookFailureCategorySchema
>;
export type WebhookRetryPolicy = z.output<typeof webhookRetryPolicySchema>;
export type CreateWebhookEndpointInput = z.output<
  typeof createWebhookEndpointInputSchema
>;
export type UpdateWebhookEndpointInput = z.output<
  typeof updateWebhookEndpointInputSchema
>;
export type RotateWebhookSecretInput = z.output<
  typeof rotateWebhookSecretInputSchema
>;
export type EnableWebhookEndpointInput = z.output<
  typeof enableWebhookEndpointInputSchema
>;
export type TestWebhookEndpointInput = z.output<
  typeof testWebhookEndpointInputSchema
>;
export type DisableWebhookEndpointInput = z.output<
  typeof disableWebhookEndpointInputSchema
>;
export type RevokeWebhookSecretInput = z.output<
  typeof revokeWebhookSecretInputSchema
>;
export type WebhookReplayPreviewInput = z.output<
  typeof webhookReplayPreviewInputSchema
>;
export type WebhookReplayPreview = z.output<typeof webhookReplayPreviewSchema>;
export type ReplayWebhookDeliveryInput = z.output<
  typeof replayWebhookDeliveryInputSchema
>;
export type WebhookVerificationExample = z.output<
  typeof webhookVerificationExampleSchema
>;
export type WebhookCatalogue = z.output<typeof webhookCatalogueResponseSchema>;
export type WebhookCatalogueEntry = z.output<
  typeof webhookCatalogueEntrySchema
>;
export type WebhookPageQuery = z.output<typeof webhookPageQuerySchema>;
export type WebhookEndpointParams = z.output<
  typeof webhookEndpointParamsSchema
>;
export type WebhookDeliveryParams = z.output<
  typeof webhookDeliveryParamsSchema
>;
export type WebhookEndpointsResponse = z.output<
  typeof webhookEndpointsResponseSchema
>;
export type WebhookEndpointResponse = z.output<
  typeof webhookEndpointResponseSchema
>;
export type WebhookDeliveriesResponse = z.output<
  typeof webhookDeliveriesResponseSchema
>;
export type WebhookDeliveryResponse = z.output<
  typeof webhookDeliveryResponseSchema
>;
export type WebhookDeliveryDetailResponse = z.output<
  typeof webhookDeliveryDetailResponseSchema
>;
export type WebhookReplayPreviewResponse = z.output<
  typeof webhookReplayPreviewResponseSchema
>;
