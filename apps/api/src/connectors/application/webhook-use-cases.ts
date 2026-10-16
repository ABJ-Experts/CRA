import { webhookSecretValueSchema } from "@repo/contracts/connectors/schemas";
import { randomUUID } from "node:crypto";
import type {
  CreateWebhookEndpointInput,
  WebhookDelivery,
  RotateWebhookSecretInput,
  UpdateWebhookEndpointInput,
  WebhookReplayPreviewInput,
  ReplayWebhookDeliveryInput,
} from "@repo/contracts/connectors/types";
import type { WebhookPageQuery as PageParams } from "@repo/contracts/connectors/types";
import type { PermissionKey } from "@repo/contracts/permissions";
import type { ConnectorAuthorizationPort } from "./connector-authorization.port";
import { ConnectorError } from "./connector-errors";
import { canonicalConnectorRequest } from "./connector-hub-use-cases";
import type { WebhookVaultPort } from "./webhook-vault.port";
import type {
  WebhookRepositoryPort,
  WebhookEndpointCommandRequest,
} from "./webhook-repository.port";
import {
  assertSafeWebhookMetadata,
  assertWebhookScope,
  webhookReadPermissions,
} from "./webhook-policy";

export type WebhookUrlPolicy = Readonly<{
  validate(url: string): Promise<void>;
}>;
export class WebhookUseCases {
  constructor(
    private readonly repository: WebhookRepositoryPort,
    private readonly authorization: ConnectorAuthorizationPort,
    private readonly vault: WebhookVaultPort,
    private readonly egress: WebhookUrlPolicy,
  ) {}

  async list(orgId: string, actorId: string, params: PageParams) {
    await this.authorization.authorize(orgId, actorId, ["can_view_connectors"]);
    const page = await this.repository.listEndpoints(orgId, params);
    for (const endpoint of page.rows)
      await this.scopeAuthorization(
        orgId,
        actorId,
        endpoint.eventTypes,
        endpoint.productIds,
        ["can_view_connectors"],
      );
    return page;
  }
  async get(orgId: string, endpointId: string, actorId: string) {
    await this.authorization.authorize(orgId, actorId, ["can_view_connectors"]);
    const endpoint = await this.repository.endpoint(orgId, endpointId);
    await this.scopeAuthorization(
      orgId,
      actorId,
      endpoint.eventTypes,
      endpoint.productIds,
      ["can_view_connectors"],
    );
    return endpoint;
  }
  async create(
    orgId: string,
    actorId: string,
    input: CreateWebhookEndpointInput,
  ) {
    assertSafeWebhookMetadata(withoutSecret(input));
    if (input.secretValue) {
      const metadata = JSON.stringify(withoutSecret(input));
      if (
        metadata.includes(input.secretValue) ||
        metadata.includes(encodeURIComponent(input.secretValue))
      )
        throw new ConnectorError("invalid_request");
    }
    await this.scopeAuthorization(
      orgId,
      actorId,
      input.eventTypes,
      input.productIds,
      input.secretValue
        ? ["can_create_connectors", "can_edit_connectors"]
        : ["can_create_connectors"],
      Boolean(input.secretValue),
    );
    await this.egress.validate(input.url);
    const endpointId = randomUUID();
    const request = await this.request(
      orgId,
      endpointId,
      actorId,
      "create",
      null,
      input,
      Boolean(input.secretValue),
      [
        "can_create_connectors",
        ...(input.secretValue ? ["can_edit_connectors" as const] : []),
        ...webhookReadPermissions(input.eventTypes),
      ],
    );
    return this.repository.executeEndpointCommand(orgId, {
      ...request,
      payload: {
        ...withoutSecret(input),
        ...(input.secretValue
          ? { secret: this.encrypt(orgId, endpointId, 1, input.secretValue) }
          : {}),
      },
    });
  }
  async update(
    orgId: string,
    endpointId: string,
    actorId: string,
    input: UpdateWebhookEndpointInput,
  ) {
    await this.scopeAuthorization(
      orgId,
      actorId,
      input.eventTypes,
      input.productIds,
      ["can_edit_connectors"],
    );
    await this.egress.validate(input.url);
    const request = await this.request(
      orgId,
      endpointId,
      actorId,
      "update",
      input.expectedVersion,
      input,
      false,
      ["can_edit_connectors", ...webhookReadPermissions(input.eventTypes)],
    );
    return this.repository.executeEndpointCommand(orgId, {
      ...request,
      payload: withoutSecret(input),
    });
  }
  async rotateSecret(
    orgId: string,
    endpointId: string,
    actorId: string,
    input: RotateWebhookSecretInput,
  ) {
    const current = await this.repository.endpoint(orgId, endpointId);
    await this.scopeAuthorization(
      orgId,
      actorId,
      current.eventTypes,
      current.productIds,
      ["can_edit_connectors"],
      true,
    );
    const request = await this.request(
      orgId,
      endpointId,
      actorId,
      "rotate_secret",
      input.expectedVersion,
      input,
      true,
      ["can_edit_connectors", ...webhookReadPermissions(current.eventTypes)],
    );
    return this.repository.executeEndpointCommand(orgId, {
      ...request,
      payload: {
        secret: this.encrypt(
          orgId,
          endpointId,
          current.secretRevision + 1,
          input.secretValue,
        ),
        overlapSeconds: input.overlapSeconds,
      },
    });
  }
  async control(
    orgId: string,
    endpointId: string,
    actorId: string,
    operation: "disable" | "enable" | "revoke_secret" | "test",
    input: { expectedVersion: number; idempotencyKey: string; reason?: string },
  ) {
    const current = await this.repository.endpoint(orgId, endpointId);
    const ownerOnly = operation === "revoke_secret";
    await this.scopeAuthorization(
      orgId,
      actorId,
      current.eventTypes,
      current.productIds,
      ["can_edit_connectors"],
      ownerOnly,
    );
    if (operation === "enable" || operation === "test") {
      if (!current.hasSecret) throw new ConnectorError("invalid_state");
      await this.egress.validate(current.url);
      try {
        const slots = await this.repository.signingSecrets(orgId, endpointId);
        if (slots.length === 0) throw new Error("missing credential");
        for (const slot of slots)
          webhookSecretValueSchema.parse(
            this.vault.decrypt(
              {
                orgId,
                endpointId,
                signingKeyId: slot.keyId,
                secretRevision: slot.revision,
              },
              slot.envelope,
            ),
          );
      } catch {
        throw new ConnectorError("unavailable");
      }
    }
    const request = await this.request(
      orgId,
      endpointId,
      actorId,
      operation,
      input.expectedVersion,
      input,
      ownerOnly,
      ["can_edit_connectors", ...webhookReadPermissions(current.eventTypes)],
    );
    return this.repository.executeEndpointCommand(orgId, {
      ...request,
      payload: {},
      reason: input.reason,
    });
  }
  async deliveries(
    orgId: string,
    endpointId: string,
    actorId: string,
    params: PageParams,
  ) {
    await this.get(orgId, endpointId, actorId);
    const page = await this.repository.listDeliveries(
      orgId,
      endpointId,
      params,
    );
    await this.authorization.authorize(orgId, actorId, [
      "can_view_connectors",
      ...webhookReadPermissions(page.rows.map((row) => row.eventType)),
    ]);
    const scopes = await this.repository.deliveryScopes(
      orgId,
      endpointId,
      page.rows.map((row) => row.id),
    );
    return {
      ...page,
      rows: page.rows.map((row) => {
        const scope = scopes.find(
          (scope) => scope.deliveryId === row.id,
        )?.scope;
        return scope
          ? { ...row, resource: scope.resource }
          : unavailableSource(row, endpointId);
      }),
    };
  }
  async delivery(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    actorId: string,
    params: PageParams,
  ) {
    const { scope } = await this.visibleDelivery(
      orgId,
      endpointId,
      deliveryId,
      actorId,
      "can_view_connectors",
    );
    const detail = await this.repository.delivery(
      orgId,
      endpointId,
      deliveryId,
      params,
    );
    return scope
      ? {
          ...detail,
          delivery: { ...detail.delivery, resource: scope.resource },
        }
      : { ...detail, delivery: unavailableSource(detail.delivery, endpointId) };
  }
  async replayPreview(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    actorId: string,
    input: WebhookReplayPreviewInput,
  ) {
    const { authorization } = await this.visibleDelivery(
      orgId,
      endpointId,
      deliveryId,
      actorId,
      "can_edit_connectors",
    );
    return this.repository.previewReplay(
      orgId,
      endpointId,
      deliveryId,
      authorization,
      input.expectedEndpointVersion,
      input.expectedDeliveryVersion,
    );
  }
  async replay(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    actorId: string,
    input: ReplayWebhookDeliveryInput,
  ) {
    const { context } = await this.visibleDelivery(
      orgId,
      endpointId,
      deliveryId,
      actorId,
      "can_edit_connectors",
    );
    const current = await this.repository.endpoint(orgId, endpointId);
    await this.egress.validate(current.url);
    const replayInput = { ...input, deliveryId } as {
      idempotencyKey: string;
      reason?: string;
    };
    const request = await this.request(
      orgId,
      endpointId,
      actorId,
      "replay",
      input.expectedEndpointVersion,
      replayInput,
      false,
      [
        "can_edit_connectors",
        ...webhookReadPermissions([context.delivery.eventType]),
      ],
    );
    return this.repository.executeEndpointCommand(orgId, {
      ...request,
      payload: {
        deliveryId,
        expectedDeliveryVersion: input.expectedDeliveryVersion,
        previewDigest: input.previewDigest,
        confirmDestinationChange: input.confirmDestinationChange,
      },
      reason: input.reason,
    });
  }
  private async visibleDelivery(
    orgId: string,
    endpointId: string,
    deliveryId: string,
    actorId: string,
    permission: PermissionKey,
  ) {
    await this.authorization.authorize(orgId, actorId, [permission]);
    const endpoint = await this.repository.endpoint(orgId, endpointId);
    const context = await this.repository.deliveryContext(
      orgId,
      endpointId,
      deliveryId,
    );
    const authorization = await this.scopeAuthorization(
      orgId,
      actorId,
      [context.delivery.eventType],
      endpoint.productIds,
      [permission],
    );
    const scope =
      permission === "can_edit_connectors"
        ? await this.repository.sourceScope(orgId, context)
        : ((
            await this.repository.deliveryScopes(orgId, endpointId, [
              deliveryId,
            ])
          )[0]?.scope ?? null);
    if (permission === "can_edit_connectors") {
      if (!scope) throw new ConnectorError("forbidden_by_policy");
      assertWebhookScope(endpoint.productIds, scope.productIds);
    } else if (scope)
      await this.repository.validateProducts(orgId, scope.productIds);
    return { authorization, scope, context };
  }
  private async scopeAuthorization(
    orgId: string,
    actorId: string,
    events: readonly string[],
    productIds: readonly string[],
    permissions: readonly PermissionKey[],
    ownerOnly = false,
  ) {
    const authorization = await this.authorization.authorize(
      orgId,
      actorId,
      [...permissions, ...webhookReadPermissions(events)],
      ownerOnly,
    );
    await this.repository.validateProducts(orgId, productIds);
    return authorization;
  }
  private async request(
    orgId: string,
    endpointId: string,
    actorId: string,
    operation: WebhookEndpointCommandRequest["operation"],
    expectedVersion: number | null,
    input: { idempotencyKey: string; reason?: string; deliveryId?: string },
    ownerOnly: boolean,
    permissions: readonly PermissionKey[] = ["can_edit_connectors"],
  ): Promise<Omit<WebhookEndpointCommandRequest, "payload">> {
    assertSafeWebhookMetadata(withoutSecret(input));
    const authorization = await this.authorization.authorize(
      orgId,
      actorId,
      permissions,
      ownerOnly,
    );
    const retainedKeyId = await this.repository.existingCommandKeyId(
      orgId,
      actorId,
      input.idempotencyKey,
    );
    let fingerprint;
    try {
      fingerprint = this.vault.fingerprint(
        orgId,
        operation === "create"
          ? "00000000-0000-0000-0000-000000000000"
          : endpointId,
        canonicalConnectorRequest({
          purpose: "webhook-command-v1",
          operation,
          input,
        }),
        retainedKeyId ?? undefined,
      );
    } catch {
      throw new ConnectorError("unavailable");
    }
    return {
      authorization,
      endpointId,
      operation,
      expectedVersion,
      idempotencyKey: input.idempotencyKey,
      requestDigest: fingerprint.digest,
      requestDigestKeyId: fingerprint.keyId,
      ...(input.reason ? { reason: input.reason } : {}),
    };
  }
  private encrypt(
    orgId: string,
    endpointId: string,
    revision: number,
    secret: string,
  ) {
    const keyId = randomUUID();
    try {
      return {
        keyId,
        secretId: keyId,
        revision,
        envelope: this.vault.encrypt(
          { orgId, endpointId, signingKeyId: keyId, secretRevision: revision },
          secret,
        ),
      };
    } catch {
      throw new ConnectorError("unavailable");
    }
  }
}
function withoutSecret(input: unknown): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(
      ([key]) =>
        !["secretValue", "idempotencyKey", "expectedVersion"].includes(key),
    ),
  );
}

function unavailableSource(
  delivery: WebhookDelivery,
  endpointId: string,
): WebhookDelivery {
  return {
    ...delivery,
    resource: {
      type: "connector",
      id: endpointId,
      url: "/connectors/webhooks",
    },
    lastFailureCategory: "scope_unknown",
    lastFailureCode: "source_scope_unknown",
  };
}
