import { Logger } from "@nestjs/common";
import { webhookEnvelopeSchema } from "@repo/contracts/connectors/schemas";
import type { OutgoingHttpHeaders } from "node:http";
import type { ConnectorAuthorizationPort } from "../application/connector-authorization.port";
import type { WebhookVaultPort } from "../application/webhook-vault.port";
import type {
  WebhookRepositoryPort,
  ClaimedWebhookDelivery,
  WebhookFailureResult,
} from "../application/webhook-repository.port";
import {
  assertWebhookScope,
  webhookPayload,
  webhookReadPermissions,
} from "../application/webhook-policy";
import { signWebhookBytes } from "../infrastructure/webhook-signature";

export type WebhookTransportPort = Readonly<{
  post(input: {
    url: string;
    body: Buffer;
    headers: OutgoingHttpHeaders;
    beforeSend?: () => Promise<void | boolean>;
  }): Promise<
    | {
        outcome: "succeeded";
        status: number;
        durationMs: number;
        responseBytes: number;
      }
    | (WebhookFailureResult & { outcome: "failed" })
  >;
}>;
export class WebhookDeliveryWorker {
  private readonly logger = new Logger(WebhookDeliveryWorker.name);
  constructor(
    private readonly repository: WebhookRepositoryPort,
    private readonly vault: WebhookVaultPort,
    private readonly transport: WebhookTransportPort,
    private readonly authorization: ConnectorAuthorizationPort,
    private readonly workerId = `webhook-delivery-${process.pid}`,
    private readonly leaseSeconds = 60,
  ) {}
  async tick(limit = 50): Promise<number> {
    const organizations = await this.repository.dueOrganizations(
      Math.min(50, Math.max(1, limit)),
    );
    let processed = 0;
    for (const orgId of organizations) {
      try {
        const claimed = await this.repository.claim(
          orgId,
          this.workerId,
          this.leaseSeconds,
        );
        if (!claimed) continue;
        await this.deliver(orgId, claimed);
        processed += 1;
      } catch {
        this.logger.warn("Webhook tenant cycle interrupted safely");
      }
    }
    return processed;
  }
  private async deliver(
    orgId: string,
    claimed: ClaimedWebhookDelivery,
  ): Promise<void> {
    let body: Buffer;
    let keys: ReadonlyArray<{ keyId: string; secret: string }>;
    try {
      const { scope } = await this.authorizedScope(orgId, claimed);
      const text =
        claimed.payloadBytes ?? webhookPayload(orgId, claimed.delivery, scope);
      const envelope = webhookEnvelopeSchema.parse(JSON.parse(text));
      if (
        Buffer.byteLength(text) > 8192 ||
        envelope.organizationId !== orgId ||
        envelope.eventId !== claimed.delivery.eventId ||
        envelope.deliveryId !== claimed.delivery.deliveryId ||
        JSON.stringify(envelope.resource) !== JSON.stringify(scope.resource)
      )
        throw new Error("invalid retained projection");
      body = Buffer.from(text, "utf8");
    } catch {
      await this.failure(orgId, claimed, "authorization");
      return;
    }
    try {
      const slots = [
        claimed.endpoint.active,
        ...(claimed.endpoint.previous &&
        Date.parse(claimed.endpoint.previous.expiresAt) > Date.now()
          ? [claimed.endpoint.previous]
          : []),
      ];
      keys = slots.map((slot) => ({
        keyId: slot.keyId,
        secret: this.vault.decrypt(
          {
            orgId,
            endpointId: claimed.endpoint.id,
            signingKeyId: slot.keyId,
            secretRevision: slot.revision,
          },
          slot.envelope,
        ),
      }));
    } catch {
      await this.failure(orgId, claimed, "vault_unavailable");
      return;
    }
    const headers = signWebhookBytes({
      body,
      eventId: claimed.delivery.eventId,
      deliveryId: claimed.delivery.deliveryId,
      keys,
    });
    const result = await this.transport.post({
      url: claimed.endpoint.url,
      body,
      headers,
      beforeSend: async () => {
        const { scope, authorization } = await this.authorizedScope(
          orgId,
          claimed,
        );
        await this.repository.permit(
          orgId,
          claimed,
          authorization,
          scope,
          body.toString("utf8"),
        );
      },
    });
    if (result.outcome === "succeeded")
      await this.repository.complete(
        orgId,
        claimed.delivery.id,
        claimed.workerId,
        claimed.leaseGeneration,
        result,
      );
    else
      await this.repository.fail(
        orgId,
        claimed.delivery.id,
        claimed.workerId,
        claimed.leaseGeneration,
        result,
      );
  }
  private async authorizedScope(
    orgId: string,
    claimed: ClaimedWebhookDelivery,
  ) {
    const authorization = await this.authorization.authorize(
      orgId,
      claimed.authorizationActorId,
      [
        "can_edit_connectors",
        ...webhookReadPermissions([claimed.delivery.eventType]),
      ],
    );
    if (claimed.endpointAuthorizationActorId !== claimed.authorizationActorId) {
      const principal = await this.authorization.authorize(
        orgId,
        claimed.endpointAuthorizationActorId,
        [
          "can_edit_connectors",
          ...webhookReadPermissions([claimed.delivery.eventType]),
        ],
      );
      if (principal.permissionVersion !== authorization.permissionVersion)
        throw new Error("authorization changed");
    }
    const scope = await this.repository.sourceScope(orgId, claimed);
    assertWebhookScope(claimed.productIds, scope.productIds);
    if (scope.productIds.length !== claimed.productIds.length)
      throw new Error("source scope changed");
    await this.repository.validateProducts(orgId, scope.productIds);
    return { scope, authorization };
  }
  private failure(
    orgId: string,
    claim: ClaimedWebhookDelivery,
    category: string,
  ) {
    return this.repository.fail(
      orgId,
      claim.delivery.id,
      claim.workerId,
      claim.leaseGeneration,
      {
        category,
        code: category,
        status: null,
        durationMs: 0,
        responseBytes: 0,
        retryAfterSeconds: null,
      },
    );
  }
}
