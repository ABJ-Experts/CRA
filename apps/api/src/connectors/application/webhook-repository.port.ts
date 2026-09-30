import type { WebhookPageQuery as PageParams } from "@repo/contracts/connectors/types";
import type {
  WebhookAttempt,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookReplayPreview,
  WebhookResourceReference,
} from "@repo/contracts/connectors/types";
import type { Paged } from "@repo/contracts/pagination";
import type { ConnectorAuthorization } from "./connector-authorization.port";
import type { ConnectorSecretEnvelope } from "./connector-vault.port";

export type WebhookEndpointCommandRequest = Readonly<{
  authorization: ConnectorAuthorization;
  endpointId: string;
  operation:
    | "create"
    | "update"
    | "rotate_secret"
    | "disable"
    | "enable"
    | "revoke_secret"
    | "test"
    | "replay";
  expectedVersion: number | null;
  idempotencyKey: string;
  requestDigest: string;
  requestDigestKeyId: string;
  payload: Readonly<Record<string, unknown>>;
  reason?: string;
}>;
export type WebhookSigningSecret = Readonly<{
  keyId: string;
  secretId: string;
  revision: number;
  envelope: ConnectorSecretEnvelope;
}>;
export type WebhookSourceScope = Readonly<{
  productIds: readonly string[];
  resource: WebhookResourceReference;
}>;
export type WebhookDeliveryContext = Readonly<{
  delivery: WebhookDelivery;
  productIds: readonly string[];
  sourceKind: string;
  sourceId: string;
  destinationRevision: number;
  scopeRevision: number;
  destinationUrl: string;
}>;
export type ClaimedWebhookDelivery = WebhookDeliveryContext &
  Readonly<{
    endpoint: Readonly<{
      id: string;
      url: string;
      secretRevision: number;
      active: WebhookSigningSecret;
      previous: (WebhookSigningSecret & { expiresAt: string }) | null;
    }>;
    authorizationActorId: string;
    endpointAuthorizationActorId: string;
    permissionVersion: number;
    payloadBytes: string | null;
    leaseGeneration: number;
    workerId: string;
  }>;
export type WebhookFailureResult = Readonly<{
  category: string;
  code: string;
  status: number | null;
  durationMs: number;
  responseBytes: number;
  retryAfterSeconds: number | null;
}>;
export interface WebhookRepositoryPort {
  listEndpoints(
    orgId: string,
    params: PageParams,
  ): Promise<Paged<WebhookEndpoint>>;
  endpoint(orgId: string, endpointId: string): Promise<WebhookEndpoint>;
  signingSecrets(
    orgId: string,
    endpointId: string,
  ): Promise<readonly WebhookSigningSecret[]>;
  validateProducts(orgId: string, productIds: readonly string[]): Promise<void>;
  existingCommandKeyId(
    orgId: string,
    actorId: string,
    idempotencyKey: string,
  ): Promise<string | null>;
  executeEndpointCommand(
    orgId: string,
    request: WebhookEndpointCommandRequest,
  ): Promise<WebhookEndpoint | WebhookDelivery>;
  previewReplay(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    authorization: ConnectorAuthorization,
    expectedEndpointVersion: number,
    expectedDeliveryVersion: number,
  ): Promise<WebhookReplayPreview>;
  deliveryScopes(
    orgId: string,
    endpointId: string,
    deliveryIds: readonly string[],
  ): Promise<
    ReadonlyArray<{ deliveryId: string; scope: WebhookSourceScope | null }>
  >;
  sourceScope(
    orgId: string,
    context: WebhookDeliveryContext,
  ): Promise<WebhookSourceScope>;
  deliveryContext(
    orgId: string,
    endpointId: string,
    deliveryId: string,
  ): Promise<WebhookDeliveryContext>;
  listDeliveries(
    orgId: string,
    endpointId: string,
    params: PageParams,
  ): Promise<Paged<WebhookDelivery>>;
  delivery(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    params: PageParams,
  ): Promise<
    Readonly<{ delivery: WebhookDelivery; attempts: Paged<WebhookAttempt> }>
  >;
  dueOrganizations(limit: number): Promise<readonly string[]>;
  claim(
    orgId: string,
    workerId: string,
    leaseSeconds: number,
  ): Promise<ClaimedWebhookDelivery | null>;
  permit(
    orgId: string,
    claim: ClaimedWebhookDelivery,
    authorization: ConnectorAuthorization,
    scope: WebhookSourceScope,
    payload: string,
  ): Promise<void>;
  complete(
    orgId: string,
    deliveryId: string,
    workerId: string,
    generation: number,
    result: Readonly<{
      status: number;
      durationMs: number;
      responseBytes: number;
    }>,
  ): Promise<void>;
  fail(
    orgId: string,
    deliveryId: string,
    workerId: string,
    generation: number,
    result: WebhookFailureResult,
  ): Promise<void>;
}
