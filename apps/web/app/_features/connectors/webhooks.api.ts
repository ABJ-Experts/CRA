import * as schemas from "@repo/contracts/connectors/schemas";
import type {
  CreateWebhookEndpointInput,
  UpdateWebhookEndpointInput,
  RotateWebhookSecretInput,
  DisableWebhookEndpointInput,
  EnableWebhookEndpointInput,
  TestWebhookEndpointInput,
  WebhookReplayPreviewInput,
  ReplayWebhookDeliveryInput,
} from "@repo/contracts/connectors/types";
import { authenticatedRequestJson } from "../../_lib/http/authenticated-request";
import { apiClient } from "../../_lib/http/api-client";

const root = "/api/v1/connectors/webhooks" as const;
function endpointPath(endpointId: string, suffix = ""): `/${string}` {
  const input = apiClient.parseInput(schemas.webhookEndpointParamsSchema, {
    endpointId,
  });
  return `${root}/${input.endpointId}${suffix}`;
}
function deliveryPath(
  endpointId: string,
  deliveryId: string,
  suffix = "",
): `/${string}` {
  const input = apiClient.parseInput(schemas.webhookDeliveryParamsSchema, {
    endpointId,
    deliveryId,
  });
  return `${root}/${input.endpointId}/deliveries/${input.deliveryId}${suffix}`;
}
function paged(
  path: `/${string}`,
  input: Readonly<{ page?: number; pageSize?: number }>,
) {
  const query = apiClient.parseInput(schemas.webhookPageQuerySchema, input);
  return `${path}?${new URLSearchParams(Object.entries({ page: query.page, pageSize: query.pageSize }).map(([key, value]) => [key, String(value)]))}` as `/${string}`;
}
/** Browser transport boundary; no automatic mutation replay or storage access. */
export class WebhooksApi {
  async catalogue(signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: `${root}/catalogue`,
      schema: schemas.webhookCatalogueResponseSchema,
      signal,
    });
  }
  async list(
    input: Readonly<{ page?: number; pageSize?: number }> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: paged(root, input),
      schema: schemas.webhookEndpointsResponseSchema,
      signal,
    });
  }
  async get(endpointId: string, signal?: AbortSignal) {
    return authenticatedRequestJson({
      path: endpointPath(endpointId),
      schema: schemas.webhookEndpointResponseSchema,
      signal,
    });
  }
  async create(input: CreateWebhookEndpointInput) {
    return authenticatedRequestJson({
      path: root,
      method: "POST",
      body: input,
      inputSchema: schemas.createWebhookEndpointInputSchema,
      schema: schemas.webhookEndpointResponseSchema,
    });
  }
  async update(endpointId: string, input: UpdateWebhookEndpointInput) {
    return authenticatedRequestJson({
      path: endpointPath(endpointId),
      method: "PATCH",
      body: input,
      inputSchema: schemas.updateWebhookEndpointInputSchema,
      schema: schemas.webhookEndpointResponseSchema,
    });
  }
  async rotateSecret(endpointId: string, input: RotateWebhookSecretInput) {
    return authenticatedRequestJson({
      path: endpointPath(endpointId, "/secret"),
      method: "POST",
      body: input,
      inputSchema: schemas.rotateWebhookSecretInputSchema,
      schema: schemas.webhookEndpointResponseSchema,
    });
  }
  async revokeSecret(endpointId: string, input: DisableWebhookEndpointInput) {
    return authenticatedRequestJson({
      path: endpointPath(endpointId, "/secret/revoke"),
      method: "POST",
      body: input,
      inputSchema: schemas.revokeWebhookSecretInputSchema,
      schema: schemas.webhookEndpointResponseSchema,
    });
  }
  async enable(endpointId: string, input: EnableWebhookEndpointInput) {
    return authenticatedRequestJson({
      path: endpointPath(endpointId, "/enable"),
      method: "POST",
      body: input,
      inputSchema: schemas.enableWebhookEndpointInputSchema,
      schema: schemas.webhookEndpointResponseSchema,
    });
  }
  async disable(endpointId: string, input: DisableWebhookEndpointInput) {
    return authenticatedRequestJson({
      path: endpointPath(endpointId, "/disable"),
      method: "POST",
      body: input,
      inputSchema: schemas.disableWebhookEndpointInputSchema,
      schema: schemas.webhookEndpointResponseSchema,
    });
  }
  async test(endpointId: string, input: TestWebhookEndpointInput) {
    return authenticatedRequestJson({
      path: endpointPath(endpointId, "/test"),
      method: "POST",
      body: input,
      inputSchema: schemas.testWebhookEndpointInputSchema,
      schema: schemas.webhookDeliveryResponseSchema,
    });
  }
  async deliveries(
    endpointId: string,
    input: Readonly<{ page?: number; pageSize?: number }> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: paged(endpointPath(endpointId, "/deliveries"), input),
      schema: schemas.webhookDeliveriesResponseSchema,
      signal,
    });
  }
  async detail(
    endpointId: string,
    deliveryId: string,
    input: Readonly<{ page?: number; pageSize?: number }> = {},
    signal?: AbortSignal,
  ) {
    return authenticatedRequestJson({
      path: paged(deliveryPath(endpointId, deliveryId), input),
      schema: schemas.webhookDeliveryDetailResponseSchema,
      signal,
    });
  }
  async previewReplay(
    endpointId: string,
    deliveryId: string,
    input: WebhookReplayPreviewInput,
  ) {
    return authenticatedRequestJson({
      path: deliveryPath(endpointId, deliveryId, "/replay/preview"),
      method: "POST",
      body: input,
      inputSchema: schemas.webhookReplayPreviewInputSchema,
      schema: schemas.webhookReplayPreviewResponseSchema,
    });
  }
  async replay(
    endpointId: string,
    deliveryId: string,
    input: ReplayWebhookDeliveryInput,
  ) {
    return authenticatedRequestJson({
      path: deliveryPath(endpointId, deliveryId, "/replay"),
      method: "POST",
      body: input,
      inputSchema: schemas.replayWebhookDeliveryInputSchema,
      schema: schemas.webhookDeliveryResponseSchema,
    });
  }
}
export const webhooksApi = new WebhooksApi();
