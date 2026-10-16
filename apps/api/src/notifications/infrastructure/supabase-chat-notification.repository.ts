import { createHash, randomInt } from "node:crypto";
import {
  chatChannelMutationResponseSchema,
  chatChannelTestResponseSchema,
  chatChannelsResponseSchema,
  chatDeliveriesResponseSchema,
  chatDeliveryMutationResponseSchema,
} from "@repo/contracts/notifications";
import type { SupabaseService } from "../../supabase/supabase.service";
import type { AesGcmConnectorVault } from "../../connectors/infrastructure/connector-vault";
import type { ConnectorSecretEnvelope } from "../../connectors/application/connector-vault.port";
import type { ChatCredential } from "../worker/chat-provider-delivery.adapter";
import type {
  CreateNotificationChatChannelInput,
  EnableNotificationChatChannelInput,
  ConfirmNotificationChatChannelInput,
  NotificationChatDeliveriesQuery,
  NotificationChatRepository,
  NotificationResult,
  RetryNotificationChatDeliveryInput,
  TestNotificationChatChannelInput,
  UpdateNotificationChatChannelInput,
} from "../application/notification.port";

type Rpc = {
  rpc(
    name: string,
    args: Readonly<Record<string, unknown>>,
  ): Promise<{ data: unknown; error: { message?: string } | null }>;
};
type Row = Record<string, unknown>;
type Schema<T> = { parse(value: unknown): T };
type ChatProviderMessage = Readonly<{
  eventClass: "test";
  severity: "test";
  displayName: string;
  confirmationCode: string;
}>;
type ChatProviderResult =
  | Readonly<{ outcome: "provider_accepted"; providerMessageId?: string }>
  | Readonly<{
      outcome: "failed";
      code: string;
      retryable: boolean;
      uncertain: boolean;
      retryAfterSeconds?: number | null;
    }>;
export type ChatProviderDeliveryPort = Readonly<{
  send(
    input: Readonly<{
      credential: ChatCredential;
      message: ChatProviderMessage;
    }>,
  ): Promise<ChatProviderResult>;
}>;

type DestinationParts = Readonly<{
  mode: string;
  targetMetadata: Readonly<Record<string, unknown>>;
  secret: string;
}>;
type PreparedTestChannel = Readonly<{
  testId: string;
  expiresAt: string;
  mode:
    | "slack_webhook"
    | "slack_bot"
    | "teams_workflow_webhook"
    | "teams_bot_proactive";
  displayName: string;
  targetMetadata: Record<string, unknown>;
  credentialEnvelope: ConnectorSecretEnvelope;
  credentialRevision: number;
}>;

const envelopeSchema: Schema<ConnectorSecretEnvelope> = {
  parse(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid envelope");
    }
    const record = value as Record<string, unknown>;
    if (
      record.format !== "aes-256-gcm-v1" ||
      typeof record.keyId !== "string" ||
      typeof record.ciphertext !== "string" ||
      typeof record.nonce !== "string" ||
      typeof record.authTag !== "string"
    ) {
      throw new Error("invalid envelope");
    }
    return {
      format: "aes-256-gcm-v1",
      keyId: record.keyId,
      ciphertext: record.ciphertext,
      nonce: record.nonce,
      authTag: record.authTag,
    };
  },
};

/** Service-role chat operations stay org-first and never expose stored secrets. */
export class SupabaseChatNotificationRepository implements NotificationChatRepository {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly vault: AesGcmConnectorVault,
    private readonly delivery: ChatProviderDeliveryPort,
    private readonly confirmationCode = randomConfirmationCode,
  ) {}

  listChatChannels(organizationId: string, actorId: string) {
    return this.call(
      "m12_05_list_chat_channels_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      },
      chatChannelsResponseSchema,
    );
  }

  createChatChannel(
    organizationId: string,
    actorId: string,
    input: CreateNotificationChatChannelInput,
  ) {
    const channelId = input.idempotencyKey;
    const destination = destinationParts(input.destination);
    const config = configuration(input, destination);
    return this.call(
      "m12_05_create_chat_channel_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_configuration: config,
        p_credential_envelope: this.encrypt(
          organizationId,
          channelId,
          1,
          destination.secret,
        ),
        p_credential_revision: 1,
        p_request_fingerprint: this.requestFingerprint(
          organizationId,
          channelId,
          config,
          destination.secret,
        ),
        p_idempotency_key: input.idempotencyKey,
      },
      chatChannelMutationResponseSchema,
    );
  }

  updateChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: UpdateNotificationChatChannelInput,
  ) {
    const destination = input.destination
      ? destinationParts(input.destination)
      : null;
    const nextCredentialRevision = destination
      ? input.expectedVersion + 1
      : null;
    const config = configuration(input, destination);
    return this.call(
      "m12_05_update_chat_channel_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_expected_version: input.expectedVersion,
        p_configuration: config,
        p_credential_envelope:
          destination && nextCredentialRevision
            ? this.encrypt(
                organizationId,
                channelId,
                nextCredentialRevision,
                destination.secret,
              )
            : null,
        p_credential_revision: nextCredentialRevision,
        p_request_fingerprint: this.requestFingerprint(
          organizationId,
          channelId,
          config,
          destination ? destination.secret : noDestinationSecret,
        ),
        p_idempotency_key: input.idempotencyKey,
      },
      chatChannelMutationResponseSchema,
    );
  }

  async testChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: TestNotificationChatChannelInput,
  ): Promise<
    NotificationResult<ReturnType<typeof chatChannelTestResponseSchema.parse>>
  > {
    const code = this.confirmationCode();
    const begin = await this.call(
      "m12_05_begin_chat_channel_test_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_expected_version: input.expectedVersion,
        p_test_code_hash: digest(code),
        p_idempotency_key: input.idempotencyKey,
      },
      preparedTestSchema,
    );
    let prepared: PreparedTestChannel;
    switch (begin.outcome) {
      case "found":
      case "updated":
      case "replayed":
        prepared = begin.data;
        break;
      case "not_found":
      case "forbidden":
      case "conflict":
      case "invalid_request":
        return begin;
    }

    const credential = this.providerCredential(
      organizationId,
      channelId,
      prepared,
    );
    const sent = await this.delivery.send({
      credential,
      message: {
        eventClass: "test",
        severity: "test",
        displayName: prepared.displayName,
        confirmationCode: code,
      },
    });
    if (sent.outcome !== "provider_accepted") {
      await this.completeTest(organizationId, actorId, channelId, prepared, {
        status: sent.uncertain ? "uncertain" : "failed",
        safeErrorCode: safeCode(sent.code),
        providerMessageIdHash: null,
      });
      throw new Error("Notification chat provider is unavailable");
    }
    return this.completeTest(organizationId, actorId, channelId, prepared, {
      status: "provider_accepted",
      safeErrorCode: null,
      providerMessageIdHash: sent.providerMessageId
        ? digest(sent.providerMessageId)
        : null,
    });
  }

  confirmChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: ConfirmNotificationChatChannelInput,
  ) {
    return this.call(
      "m12_05_confirm_chat_channel_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_test_id: input.testId,
        p_code_hash: digest(input.code),
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      chatChannelMutationResponseSchema,
    );
  }

  enableChatChannel(
    organizationId: string,
    actorId: string,
    channelId: string,
    input: EnableNotificationChatChannelInput,
  ) {
    return this.call(
      "m12_05_set_chat_channel_enabled_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_enabled: input.enabled,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      chatChannelMutationResponseSchema,
    );
  }

  listChatDeliveries(
    organizationId: string,
    actorId: string,
    query: NotificationChatDeliveriesQuery,
  ) {
    return this.call(
      "m12_05_list_chat_deliveries_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_status: query.status ?? null,
        p_event_class: query.eventClass ?? null,
        p_channel_id: query.channelId ?? null,
        p_cursor: query.cursor ?? null,
        p_limit: query.limit,
      },
      chatDeliveriesResponseSchema,
    );
  }

  retryChatDelivery(
    organizationId: string,
    actorId: string,
    deliveryId: string,
    input: RetryNotificationChatDeliveryInput,
  ) {
    return this.call(
      "m12_05_retry_chat_delivery_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_delivery_id: deliveryId,
        p_expected_version: input.expectedVersion,
        p_idempotency_key: input.idempotencyKey,
      },
      chatDeliveryMutationResponseSchema,
    );
  }

  private async completeTest(
    organizationId: string,
    actorId: string,
    channelId: string,
    test: PreparedTestChannel,
    result: Readonly<{
      status: "provider_accepted" | "failed" | "uncertain";
      safeErrorCode: string | null;
      providerMessageIdHash: string | null;
    }>,
  ) {
    return this.call(
      "m12_05_complete_chat_channel_test_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_test_id: test.testId,
        p_status: result.status,
        p_safe_error_code: result.safeErrorCode,
        p_provider_message_id_hash: result.providerMessageIdHash,
      },
      chatChannelTestResponseSchema,
    );
  }

  private requestFingerprint(
    organizationId: string,
    channelId: string,
    config: ReturnType<typeof configuration>,
    destinationSecret: string,
  ): string {
    return this.vault.fingerprint(
      organizationId,
      channelId,
      canonicalJson({ configuration: config, destinationSecret }),
    ).digest;
  }

  private encrypt(
    organizationId: string,
    channelId: string,
    credentialRevision: number,
    secret: string,
  ): ConnectorSecretEnvelope {
    return this.vault.encrypt(
      {
        orgId: organizationId,
        connectorId: channelId,
        secretId: channelId,
        credentialRevision,
      },
      secret,
    );
  }

  private providerCredential(
    organizationId: string,
    channelId: string,
    prepared: PreparedTestChannel,
  ): ChatCredential {
    const secret = this.vault.decrypt(
      {
        orgId: organizationId,
        connectorId: channelId,
        secretId: channelId,
        credentialRevision: prepared.credentialRevision,
      },
      prepared.credentialEnvelope,
    );
    switch (prepared.mode) {
      case "slack_webhook":
        return { mode: prepared.mode, webhookUrl: secret };
      case "slack_bot":
        return {
          mode: prepared.mode,
          botToken: secret,
          channelId: text(prepared.targetMetadata.channelId),
        };
      case "teams_workflow_webhook":
        return { mode: prepared.mode, webhookUrl: secret };
      case "teams_bot_proactive":
        return {
          mode: prepared.mode,
          tenantId: text(prepared.targetMetadata.tenantId),
          appId: text(prepared.targetMetadata.appId),
          appSecret: secret,
          serviceUrl: text(prepared.targetMetadata.serviceUrl),
          conversationId: text(prepared.targetMetadata.conversationId),
        };
    }
  }

  private async call<T>(
    name: string,
    args: Readonly<Record<string, unknown>>,
    schema: Schema<T>,
  ): Promise<NotificationResult<T>> {
    const response = await (this.supabase.admin() as unknown as Rpc).rpc(
      name,
      args,
    );
    if (response.error)
      throw new Error("Notification chat storage is unavailable");
    const data: unknown = response.data;
    const row = Array.isArray(data) ? (data as unknown[])[0] : data;
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      throw new Error("Notification chat storage returned an invalid response");
    }
    return parseResult(row as Row, schema);
  }
}

const noDestinationSecret = "__cra_chat_destination_secret_unchanged__";

function destinationParts(
  destination: CreateNotificationChatChannelInput["destination"],
): DestinationParts {
  switch (destination.mode) {
    case "slack_webhook":
      return {
        mode: destination.mode,
        targetMetadata: {},
        secret: destination.webhookUrl,
      };
    case "slack_bot":
      return {
        mode: destination.mode,
        targetMetadata: { channelId: destination.channelId },
        secret: destination.botToken,
      };
    case "teams_workflow_webhook":
      return {
        mode: destination.mode,
        targetMetadata: {},
        secret: destination.webhookUrl,
      };
    case "teams_bot_proactive":
      return {
        mode: destination.mode,
        targetMetadata: {
          tenantId: destination.tenantId,
          appId: destination.appId,
          serviceUrl: destination.serviceUrl,
          conversationId: destination.conversationId,
        },
        secret: destination.clientSecret,
      };
  }
}

function configuration(
  input: Pick<
    CreateNotificationChatChannelInput,
    "displayName" | "eventClasses" | "productIds" | "includeOrganizationWide"
  >,
  destination: DestinationParts | null,
) {
  const common = {
    displayName: input.displayName,
    eventClasses: input.eventClasses,
    productIds: input.productIds,
    includeOrganizationWide: input.includeOrganizationWide,
  };
  return destination
    ? {
        mode: destination.mode,
        ...common,
        targetMetadata: destination.targetMetadata,
      }
    : common;
}

const preparedTestSchema: Schema<PreparedTestChannel> = {
  parse(value: unknown) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("invalid prepared channel");
    }
    const row = value as Record<string, unknown>;
    const mode = row.mode;
    if (
      mode !== "slack_webhook" &&
      mode !== "slack_bot" &&
      mode !== "teams_workflow_webhook" &&
      mode !== "teams_bot_proactive"
    ) {
      throw new Error("invalid prepared channel");
    }
    if (
      typeof row.testId !== "string" ||
      typeof row.expiresAt !== "string" ||
      typeof row.displayName !== "string" ||
      row.displayName.length < 1 ||
      row.displayName.length > 120 ||
      typeof row.credentialRevision !== "number" ||
      !row.targetMetadata ||
      typeof row.targetMetadata !== "object" ||
      Array.isArray(row.targetMetadata)
    ) {
      throw new Error("invalid prepared channel");
    }
    return {
      testId: row.testId,
      expiresAt: row.expiresAt,
      mode,
      displayName: row.displayName,
      targetMetadata: row.targetMetadata as Record<string, unknown>,
      credentialEnvelope: envelopeSchema.parse(row.credentialEnvelope),
      credentialRevision: row.credentialRevision,
    };
  },
};

function parseResult<T>(row: Row, schema: Schema<T>): NotificationResult<T> {
  const parse = (value: unknown): T => {
    try {
      return schema.parse(value);
    } catch {
      throw new Error("Notification chat storage returned an invalid response");
    }
  };
  if (!("outcome" in row)) return { outcome: "found", data: parse(row) };
  switch (row.outcome) {
    case "found":
    case "updated":
    case "replayed":
      return { outcome: row.outcome, data: parse(row.result) };
    case "queued":
      return { outcome: "updated", data: parse(row.result) };
    case "not_found":
    case "forbidden":
    case "conflict":
    case "invalid_request":
      return { outcome: row.outcome };
    case "invalid_state":
      return { outcome: "invalid_request" };
    case "idempotency_conflict":
    case "limit_reached":
      return { outcome: "conflict" };
    default:
      throw new Error("Notification chat storage returned an invalid outcome");
  }
}

function text(value: unknown): string {
  if (typeof value !== "string" || value.length < 1) {
    throw new Error("Notification chat storage returned an invalid response");
  }
  return value;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function safeCode(value: string): string {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value) ? value : "provider_unavailable";
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function randomConfirmationCode(): string {
  return `${randomInt(0, 1_000_000)}`.padStart(6, "0");
}
