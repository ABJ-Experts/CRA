import { randomBytes } from "node:crypto";
import { AesGcmConnectorVault } from "../../connectors/infrastructure/connector-vault";
import { SupabaseChatNotificationRepository } from "./supabase-chat-notification.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const deliveryId = "44444444-4444-4444-8444-444444444444";
const productId = "55555555-5555-4555-8555-555555555555";
const idempotencyKey = channelId;
const now = "2026-10-02T00:00:00.000Z";
const channel = {
  id: channelId,
  organizationId,
  mode: "slack_bot",
  displayName: "Security alerts",
  eventClasses: ["high_severity_alert"],
  productIds: [productId],
  includeOrganizationWide: false,
  enabled: false,
  verified: false,
  safeErrorCode: null,
  version: 1,
  createdAt: now,
  updatedAt: now,
};
const delivery = {
  id: deliveryId,
  channelId,
  eventClass: "high_severity_alert",
  status: "failed",
  sourceType: "m5_triage",
  sourceId: productId,
  sourceRevision: "rev-1",
  attemptCount: 2,
  lastAttemptAt: now,
  nextAttemptAt: null,
  safeErrorCode: "provider_timeout",
  createdAt: now,
  updatedAt: now,
  version: 3,
};
const keyring = JSON.stringify({
  activeKeyId: "test",
  keys: { test: randomBytes(32).toString("base64") },
});

type RpcResponse = Readonly<{
  data: unknown;
  error: { message?: string } | null;
}>;
type RpcMock = jest.MockedFunction<
  (
    name: string,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<RpcResponse>
>;

function rpcArgs(rpc: RpcMock, index = 0): Readonly<Record<string, unknown>> {
  const call = rpc.mock.calls[index];
  if (!call) throw new Error(`Missing RPC call ${index}`);
  return call[1];
}

function rpcName(rpc: RpcMock, index = 0): string {
  const call = rpc.mock.calls[index];
  if (!call) throw new Error(`Missing RPC call ${index}`);
  return call[0];
}

function setup() {
  const rpc: RpcMock = jest.fn();
  const deliveryAdapter = { send: jest.fn() };
  const vault = new AesGcmConnectorVault(keyring);
  const repository = new SupabaseChatNotificationRepository(
    { admin: () => ({ rpc }) } as never,
    vault,
    deliveryAdapter,
    () => "123456",
  );
  return { repository, rpc, deliveryAdapter, vault };
}

describe("SupabaseChatNotificationRepository", () => {
  it("encrypts write-only credentials with the channel context before create", async () => {
    const { repository, rpc, vault } = setup();
    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result: { channel } }],
      error: null,
    });

    await expect(
      repository.createChatChannel(organizationId, actorId, {
        displayName: "Security alerts",
        eventClasses: ["high_severity_alert"],
        productIds: [productId],
        includeOrganizationWide: false,
        destination: {
          mode: "slack_bot",
          botToken: "xoxb-secret-token",
          channelId: "C12345678",
        },
        idempotencyKey,
      }),
    ).resolves.toEqual({ outcome: "updated", data: { channel } });

    const args = rpcArgs(rpc);
    expect(rpc).toHaveBeenCalledWith(
      "m12_05_create_chat_channel_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_credential_revision: 1,
        p_idempotency_key: idempotencyKey,
      }),
    );
    expect(args.p_request_fingerprint).toEqual(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(args.p_configuration).toEqual({
      mode: "slack_bot",
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      targetMetadata: { channelId: "C12345678" },
    });
    expect(
      vault.decrypt(
        {
          orgId: organizationId,
          connectorId: channelId,
          secretId: channelId,
          credentialRevision: 1,
        },
        args.p_credential_envelope as never,
      ),
    ).toBe("xoxb-secret-token");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("xoxb-secret-token");
  });

  it("uses stable request fingerprints for randomized envelopes and changes them for different secrets", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({
      data: [{ outcome: "replayed", result: { channel } }],
      error: null,
    });
    const input = {
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert" as const],
      productIds: [productId],
      includeOrganizationWide: false,
      destination: {
        mode: "slack_bot" as const,
        botToken: "xoxb-secret-token",
        channelId: "C12345678",
      },
      idempotencyKey,
    };

    await repository.createChatChannel(organizationId, actorId, input);
    await repository.createChatChannel(organizationId, actorId, input);
    const first = rpcArgs(rpc);
    const replay = rpcArgs(rpc, 1);
    expect(first.p_request_fingerprint).toBe(replay.p_request_fingerprint);
    expect(first.p_credential_envelope).not.toEqual(
      replay.p_credential_envelope,
    );

    await repository.createChatChannel(organizationId, actorId, {
      ...input,
      destination: { ...input.destination, botToken: "xoxb-other-secret" },
    });
    const changed = rpcArgs(rpc, 2);
    expect(changed.p_request_fingerprint).not.toBe(first.p_request_fingerprint);
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("xoxb-secret-token");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("xoxb-other-secret");
  });

  it("updates public configuration and rotates credentials only when destination changes", async () => {
    const { repository, rpc, vault } = setup();
    rpc.mockResolvedValue({
      data: [
        { outcome: "updated", result: { channel: { ...channel, version: 3 } } },
      ],
      error: null,
    });

    await repository.updateChatChannel(organizationId, actorId, channelId, {
      expectedVersion: 2,
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      destination: {
        mode: "slack_webhook",
        webhookUrl: "https://hooks.slack.com/services/T/B/secret",
      },
      idempotencyKey,
    });

    const args = rpcArgs(rpc);
    expect(rpc).toHaveBeenCalledWith(
      "m12_05_update_chat_channel_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_expected_version: 2,
        p_credential_revision: 3,
        p_idempotency_key: idempotencyKey,
      }),
    );
    expect(args.p_request_fingerprint).toEqual(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(args.p_configuration).toEqual({
      mode: "slack_webhook",
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      targetMetadata: {},
    });
    expect(
      vault.decrypt(
        {
          orgId: organizationId,
          connectorId: channelId,
          secretId: channelId,
          credentialRevision: 3,
        },
        args.p_credential_envelope as never,
      ),
    ).toBe("https://hooks.slack.com/services/T/B/secret");

    rpc.mockClear();
    await repository.updateChatChannel(organizationId, actorId, channelId, {
      expectedVersion: 3,
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      idempotencyKey,
    });
    const noDestinationArgs = rpcArgs(rpc);
    expect(noDestinationArgs).toEqual(
      expect.objectContaining({
        p_credential_envelope: null,
        p_credential_revision: null,
      }),
    );
    expect(noDestinationArgs.p_request_fingerprint).toEqual(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
  });

  it("does not resend a synthetic provider test when begin reports an idempotency conflict", async () => {
    const { repository, rpc, deliveryAdapter } = setup();
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "idempotency_conflict", result: null }],
      error: null,
    });

    await expect(
      repository.testChatChannel(organizationId, actorId, channelId, {
        expectedVersion: 2,
        idempotencyKey,
      }),
    ).resolves.toEqual({ outcome: "conflict" });
    expect(deliveryAdapter.send).not.toHaveBeenCalled();
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("runs a synthetic provider test with decrypted credentials and stores only a code hash", async () => {
    const { repository, rpc, deliveryAdapter, vault } = setup();
    const envelope = vault.encrypt(
      {
        orgId: organizationId,
        connectorId: channelId,
        secretId: channelId,
        credentialRevision: 2,
      },
      "xoxb-secret-token",
    );
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "found",
          result: {
            testId: deliveryId,
            expiresAt: "2026-10-02T00:10:00.000Z",
            mode: "slack_bot",
            displayName: "Security alerts",
            targetMetadata: { channelId: "C12345678" },
            credentialEnvelope: envelope,
            credentialRevision: 2,
          },
        },
      ],
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "updated",
          result: {
            testId: deliveryId,
            expiresAt: "2026-10-02T00:10:00.000Z",
            status: "provider_accepted",
          },
        },
      ],
      error: null,
    });
    deliveryAdapter.send.mockResolvedValue({
      outcome: "provider_accepted",
      providerMessageId: "provider-secret-id",
    });

    await expect(
      repository.testChatChannel(organizationId, actorId, channelId, {
        expectedVersion: 2,
        idempotencyKey,
      }),
    ).resolves.toEqual({
      outcome: "updated",
      data: {
        testId: deliveryId,
        expiresAt: "2026-10-02T00:10:00.000Z",
        status: "provider_accepted",
      },
    });

    const beginArgs = rpcArgs(rpc);
    expect(rpcName(rpc)).toBe("m12_05_begin_chat_channel_test_atomic");
    expect(beginArgs).toEqual(
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_expected_version: 2,
        p_idempotency_key: idempotencyKey,
      }),
    );
    expect(beginArgs.p_test_code_hash).toMatch(/^[a-f0-9]{64}$/);
    expect(beginArgs.p_test_code_hash).not.toBe("123456");
    expect(deliveryAdapter.send).toHaveBeenCalledWith({
      credential: {
        mode: "slack_bot",
        botToken: "xoxb-secret-token",
        channelId: "C12345678",
      },
      message: {
        eventClass: "test",
        severity: "test",
        displayName: "Security alerts",
        confirmationCode: "123456",
      },
    });
    expect(rpcName(rpc, 1)).toBe("m12_05_complete_chat_channel_test_atomic");
    const completeArgs = rpcArgs(rpc, 1);
    expect(completeArgs).toEqual(
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_test_id: deliveryId,
        p_status: "provider_accepted",
        p_safe_error_code: null,
      }),
    );
    expect(completeArgs.p_provider_message_id_hash).toEqual(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("provider-secret-id");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("xoxb-secret-token");
  });

  it("hashes confirmation codes, enables channels, lists deliveries and retries by organization", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result: { channel } }],
      error: null,
    });
    await repository.confirmChatChannel(organizationId, actorId, channelId, {
      expectedVersion: 1,
      testId: deliveryId,
      code: "123456",
      idempotencyKey,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "m12_05_confirm_chat_channel_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_channel_id: channelId,
        p_test_id: deliveryId,
        p_expected_version: 1,
        p_idempotency_key: idempotencyKey,
      }),
    );
    expect(rpcArgs(rpc).p_code_hash).toEqual(
      expect.stringMatching(/^[a-f0-9]{64}$/),
    );

    await repository.enableChatChannel(organizationId, actorId, channelId, {
      expectedVersion: 1,
      enabled: true,
      idempotencyKey,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "m12_05_set_chat_channel_enabled_atomic",
      expect.objectContaining({
        p_enabled: true,
        p_expected_version: 1,
      }),
    );

    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: { rows: [delivery], nextCursor: null },
        },
      ],
      error: null,
    });
    await expect(
      repository.listChatDeliveries(organizationId, actorId, {
        limit: 25,
        status: "failed",
        channelId,
      }),
    ).resolves.toEqual({
      outcome: "found",
      data: { rows: [delivery], nextCursor: null },
    });
    expect(rpc).toHaveBeenLastCalledWith("m12_05_list_chat_deliveries_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_status: "failed",
      p_event_class: null,
      p_channel_id: channelId,
      p_cursor: null,
      p_limit: 25,
    });

    rpc.mockResolvedValue({
      data: [{ outcome: "queued", result: { delivery } }],
      error: null,
    });
    await expect(
      repository.retryChatDelivery(organizationId, actorId, deliveryId, {
        expectedVersion: 3,
        idempotencyKey,
      }),
    ).resolves.toEqual({ outcome: "updated", data: { delivery } });
    expect(rpc).toHaveBeenLastCalledWith("m12_05_retry_chat_delivery_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_delivery_id: deliveryId,
      p_expected_version: 3,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("maps chat channel capacity to conflict for deterministic HTTP 409", async () => {
    const { repository, rpc } = setup();
    rpc.mockResolvedValue({
      data: [{ outcome: "limit_reached", result: null }],
      error: null,
    });

    await expect(
      repository.createChatChannel(organizationId, actorId, {
        displayName: "Security alerts",
        eventClasses: ["high_severity_alert"],
        productIds: [productId],
        includeOrganizationWide: false,
        destination: {
          mode: "slack_webhook",
          webhookUrl: "https://hooks.slack.com/services/T/B/secret",
        },
        idempotencyKey,
      }),
    ).resolves.toEqual({ outcome: "conflict" });
  });

  it("parses public responses and redacts storage and provider failures", async () => {
    const { repository, rpc, deliveryAdapter, vault } = setup();
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: { channels: [{ ...channel, secret: "leak" }] },
        },
      ],
      error: null,
    });
    await expect(
      repository.listChatChannels(organizationId, actorId),
    ).rejects.toThrow("Notification chat storage returned an invalid response");

    rpc.mockResolvedValue({
      data: null,
      error: { message: "private SQL detail" },
    });
    await expect(
      repository.listChatChannels(organizationId, actorId),
    ).rejects.toThrow("Notification chat storage is unavailable");

    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "found",
          result: {
            testId: deliveryId,
            expiresAt: "2026-10-02T00:10:00.000Z",
            mode: "slack_webhook",
            displayName: "Security alerts",
            targetMetadata: {},
            credentialEnvelope: vault.encrypt(
              {
                orgId: organizationId,
                connectorId: channelId,
                secretId: channelId,
                credentialRevision: 1,
              },
              "https://hooks.slack.com/services/T/B/secret",
            ),
            credentialRevision: 1,
          },
        },
      ],
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: [{ outcome: "invalid_request", result: null }],
      error: null,
    });
    deliveryAdapter.send.mockResolvedValue({
      outcome: "failed",
      code: "provider_rejected",
      retryable: false,
      uncertain: false,
    });
    await expect(
      repository.testChatChannel(organizationId, actorId, channelId, {
        expectedVersion: 1,
        idempotencyKey,
      }),
    ).rejects.toThrow("Notification chat provider is unavailable");
  });

  it("handles remaining chat destination modes and storage outcome edges", async () => {
    const { repository, rpc, deliveryAdapter, vault } = setup();
    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result: { channel } }],
      error: null,
    });

    await repository.createChatChannel(organizationId, actorId, {
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      destination: {
        mode: "teams_workflow_webhook",
        webhookUrl: "https://example.test/workflow",
      },
      idempotencyKey,
    });
    expect(rpcArgs(rpc).p_configuration).toEqual({
      mode: "teams_workflow_webhook",
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      targetMetadata: {},
    });

    await repository.updateChatChannel(organizationId, actorId, channelId, {
      expectedVersion: 4,
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      destination: {
        mode: "teams_bot_proactive",
        tenantId: "tenant-id",
        appId: "app-id",
        clientSecret: "teams-client-secret",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        conversationId: "conversation-id",
      },
      idempotencyKey,
    });
    expect(rpcArgs(rpc, 1).p_configuration).toEqual({
      mode: "teams_bot_proactive",
      displayName: "Security alerts",
      eventClasses: ["high_severity_alert"],
      productIds: [productId],
      includeOrganizationWide: false,
      targetMetadata: {
        tenantId: "tenant-id",
        appId: "app-id",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
        conversationId: "conversation-id",
      },
    });

    rpc.mockResolvedValueOnce({
      data: {
        channels: [channel],
      },
      error: null,
    });
    await expect(
      repository.listChatChannels(organizationId, actorId),
    ).resolves.toEqual({
      outcome: "found",
      data: { channels: [channel] },
    });

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "invalid_state", result: null }],
      error: null,
    });
    await expect(
      repository.enableChatChannel(organizationId, actorId, channelId, {
        expectedVersion: 1,
        enabled: true,
        idempotencyKey,
      }),
    ).resolves.toEqual({ outcome: "invalid_request" });

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "unexpected", result: null }],
      error: null,
    });
    await expect(
      repository.listChatChannels(organizationId, actorId),
    ).rejects.toThrow("Notification chat storage returned an invalid outcome");

    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(
      repository.listChatChannels(organizationId, actorId),
    ).rejects.toThrow("Notification chat storage returned an invalid response");

    const workflowEnvelope = vault.encrypt(
      {
        orgId: organizationId,
        connectorId: channelId,
        secretId: channelId,
        credentialRevision: 6,
      },
      "https://example.test/workflow",
    );
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "found",
          result: {
            testId: deliveryId,
            expiresAt: "2026-10-02T00:10:00.000Z",
            mode: "teams_workflow_webhook",
            displayName: "Security alerts",
            targetMetadata: {},
            credentialEnvelope: workflowEnvelope,
            credentialRevision: 6,
          },
        },
      ],
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "updated",
          result: {
            testId: deliveryId,
            expiresAt: "2026-10-02T00:10:00.000Z",
            status: "provider_accepted",
          },
        },
      ],
      error: null,
    });
    deliveryAdapter.send.mockResolvedValueOnce({
      outcome: "provider_accepted",
    });
    await repository.testChatChannel(organizationId, actorId, channelId, {
      expectedVersion: 6,
      idempotencyKey,
    });
    expect(deliveryAdapter.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        credential: {
          mode: "teams_workflow_webhook",
          webhookUrl: "https://example.test/workflow",
        },
      }),
    );
    expect(rpcArgs(rpc, 7).p_provider_message_id_hash).toBeNull();

    const proactiveEnvelope = vault.encrypt(
      {
        orgId: organizationId,
        connectorId: channelId,
        secretId: channelId,
        credentialRevision: 7,
      },
      "teams-client-secret",
    );
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "found",
          result: {
            testId: deliveryId,
            expiresAt: "2026-10-02T00:10:00.000Z",
            mode: "teams_bot_proactive",
            displayName: "Security alerts",
            targetMetadata: {
              tenantId: "tenant-id",
              appId: "app-id",
              serviceUrl: "https://smba.trafficmanager.net/amer/",
              conversationId: "conversation-id",
            },
            credentialEnvelope: proactiveEnvelope,
            credentialRevision: 7,
          },
        },
      ],
      error: null,
    });
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "updated",
          result: {
            testId: deliveryId,
            expiresAt: "2026-10-02T00:10:00.000Z",
            status: "provider_accepted",
          },
        },
      ],
      error: null,
    });
    deliveryAdapter.send.mockResolvedValueOnce({
      outcome: "provider_accepted",
    });
    await repository.testChatChannel(organizationId, actorId, channelId, {
      expectedVersion: 7,
      idempotencyKey,
    });
    expect(deliveryAdapter.send).toHaveBeenLastCalledWith(
      expect.objectContaining({
        credential: {
          mode: "teams_bot_proactive",
          tenantId: "tenant-id",
          appId: "app-id",
          appSecret: "teams-client-secret",
          serviceUrl: "https://smba.trafficmanager.net/amer/",
          conversationId: "conversation-id",
        },
      }),
    );
  });

  it("rejects malformed prepared tests before provider delivery", async () => {
    const { repository, rpc, deliveryAdapter } = setup();
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: null }],
      error: null,
    });

    await expect(
      repository.testChatChannel(organizationId, actorId, channelId, {
        expectedVersion: 1,
        idempotencyKey,
      }),
    ).rejects.toThrow("Notification chat storage returned an invalid response");
    expect(deliveryAdapter.send).not.toHaveBeenCalled();
  });
});
