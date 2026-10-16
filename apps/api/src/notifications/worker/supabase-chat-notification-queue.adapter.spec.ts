import { SupabaseChatNotificationQueueAdapter } from "./supabase-chat-notification-queue.adapter";

const organizationId = "11111111-1111-4111-8111-111111111111";
const organizationId2 = "11111111-1111-4111-8111-111111111112";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const workerId = "44444444-4444-4444-8444-444444444444";
const findingId = "55555555-5555-4555-8555-555555555555";
const tenantId = "66666666-6666-4666-8666-666666666666";
const appId = "77777777-7777-4777-8777-777777777777";
const checkpointVersion = 2;
const providerMessageIdHash =
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const envelope = {
  format: "aes-256-gcm-v1",
  keyId: "test",
  ciphertext: "YQ==",
  nonce: "AAAAAAAAAAAAAAAA",
  authTag: "AAAAAAAAAAAAAAAAAAAAAA==",
} as const;

function setup(result: unknown = null) {
  const rpc = jest.fn().mockResolvedValue({ data: result, error: null });
  const decrypt = jest.fn().mockReturnValue("test-bot-token");
  const queue = new SupabaseChatNotificationQueueAdapter(
    { admin: () => ({ rpc }) } as never,
    { decrypt } as never,
    "https://cra.test",
  );
  return { queue, rpc, decrypt };
}

function prepareInput() {
  return { organizationId, deliveryId, workerId, checkpointVersion };
}

function preparedResult(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    outcome: "ready",
    result: {
      channelId,
      mode: "slack_bot",
      targetMetadata: { channelId: "C123" },
      credentialEnvelope: envelope,
      credentialRevision: 1,
      eventClass: "high_severity_alert",
      severity: "critical",
      effectiveAt: "2026-10-02T00:00:00.000Z",
      appPath: `/findings?findingId=${findingId}`,
      ...overrides,
    },
  };
}

describe("SupabaseChatNotificationQueueAdapter", () => {
  it("decrypts a scoped credential and builds only an allowlisted application link", async () => {
    const { queue, rpc, decrypt } = setup(preparedResult());

    const result = await queue.prepare(prepareInput());

    expect(result).toEqual({
      outcome: "ready",
      credential: {
        mode: "slack_bot",
        botToken: "test-bot-token",
        channelId: "C123",
      },
      message: {
        eventClass: "high_severity_alert",
        severity: "critical",
        eventAt: "2026-10-02T00:00:00.000Z",
        link: `https://cra.test/findings?findingId=${findingId}`,
      },
    });
    expect(decrypt).toHaveBeenCalledWith(
      {
        orgId: organizationId,
        connectorId: channelId,
        secretId: channelId,
        credentialRevision: 1,
      },
      envelope,
    );
    expect(rpc).toHaveBeenCalledWith(
      "m12_05_prepare_chat_delivery_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_delivery_id: deliveryId,
        p_lease_owner: workerId,
        p_checkpoint_version: checkpointVersion,
      }),
    );
  });

  it.each([
    [
      "slack_webhook",
      { mode: "slack_webhook", targetMetadata: {} },
      { mode: "slack_webhook", webhookUrl: "test-bot-token" },
    ],
    [
      "teams_workflow_webhook",
      { mode: "teams_workflow_webhook", targetMetadata: {} },
      { mode: "teams_workflow_webhook", webhookUrl: "test-bot-token" },
    ],
    [
      "teams_bot_proactive",
      {
        mode: "teams_bot_proactive",
        targetMetadata: {
          tenantId,
          appId,
          conversationId: "conversation-id",
          serviceUrl: "https://smba.trafficmanager.net/amer/",
        },
      },
      {
        mode: "teams_bot_proactive",
        appSecret: "test-bot-token",
        tenantId,
        appId,
        conversationId: "conversation-id",
        serviceUrl: "https://smba.trafficmanager.net/amer/",
      },
    ],
  ])(
    "decrypts %s credentials from parsed target metadata",
    async (_, override, credential) => {
      const { queue } = setup(preparedResult(override));

      await expect(queue.prepare(prepareInput())).resolves.toMatchObject({
        outcome: "ready",
        credential,
      });
    },
  );

  it("rejects executable routes, invalid targets, and malformed prepared rows before decrypting", async () => {
    const { queue, rpc, decrypt } = setup(
      preparedResult({ appPath: "https://evil.test/steal" }),
    );

    await expect(queue.prepare(prepareInput())).rejects.toThrow(
      "Chat queue returned an invalid response",
    );
    expect(decrypt).not.toHaveBeenCalled();

    rpc.mockResolvedValueOnce({
      data: preparedResult({ targetMetadata: { channelId: "bad" } }),
      error: null,
    });
    await expect(queue.prepare(prepareInput())).rejects.toThrow(
      "Chat queue returned an invalid response",
    );

    rpc.mockResolvedValueOnce({
      data: preparedResult({
        credentialEnvelope: { ...envelope, authTag: "" },
      }),
      error: null,
    });
    await expect(queue.prepare(prepareInput())).rejects.toThrow(
      "Chat queue returned an invalid response",
    );

    rpc.mockResolvedValueOnce({ data: { outcome: "ready" }, error: null });
    await expect(queue.prepare(prepareInput())).rejects.toThrow(
      "Chat queue returned an invalid response",
    );
  });

  it("rejects invalid tenant scope before querying", async () => {
    const { queue, rpc } = setup({ outcome: "none_available" });

    await expect(
      queue.claim({ organizationId: "other", workerId, leaseSeconds: 120 }),
    ).rejects.toThrow("Chat queue returned an invalid response");
    await expect(queue.bridge("other")).rejects.toThrow(
      "Chat queue returned an invalid response",
    );
    await expect(
      queue.complete({
        organizationId,
        deliveryId: "bad",
        workerId,
        checkpointVersion,
        status: "provider_accepted",
        safeErrorCode: null,
        providerMessageIdHash: null,
        retryAfterSeconds: null,
      }),
    ).rejects.toThrow("Chat queue returned an invalid response");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("pages due organizations with ordered tenant ids and rejects malformed pagination", async () => {
    const { queue, rpc } = setup([
      { organization_id: organizationId },
      { organization_id: organizationId2 },
    ]);

    await expect(queue.dueOrganizations(null)).resolves.toEqual({
      organizationIds: [organizationId, organizationId2],
      nextOrganizationId: null,
    });
    expect(rpc).toHaveBeenCalledWith("m12_05_due_chat_organizations", {
      p_limit: 100,
      p_after_org: null,
    });

    rpc.mockResolvedValueOnce({
      data: [{ organization_id: organizationId }],
      error: null,
    });
    await expect(queue.dueOrganizations(organizationId2)).rejects.toThrow(
      "Chat queue returned an invalid response",
    );

    rpc.mockResolvedValueOnce({
      data: [{ organization_id: "bad" }],
      error: null,
    });
    await expect(queue.dueOrganizations(null)).rejects.toThrow(
      "Chat queue returned an invalid response",
    );
  });

  it("bridges tenant deliveries and rejects invalid storage counts", async () => {
    const { queue, rpc } = setup(3);

    await expect(queue.bridge(organizationId)).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith("m12_05_bridge_chat_deliveries_atomic", {
      p_organization_id: organizationId,
      p_limit: 100,
    });

    rpc.mockResolvedValueOnce({ data: 101, error: null });
    await expect(queue.bridge(organizationId)).rejects.toThrow(
      "Chat queue returned an invalid response",
    );
  });

  it("parses claim outcomes and enforces tenant scoped RPC arguments", async () => {
    const { queue, rpc } = setup({
      outcome: "claimed",
      result: { deliveryId, checkpointVersion },
    });

    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).resolves.toEqual({
      outcome: "claimed",
      deliveryId,
      checkpointVersion,
    });
    expect(rpc).toHaveBeenCalledWith("m12_05_claim_chat_delivery_atomic", {
      p_organization_id: organizationId,
      p_lease_owner: workerId,
      p_lease_seconds: 120,
    });

    rpc.mockResolvedValueOnce({
      data: { outcome: "none_available" },
      error: null,
    });
    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).resolves.toEqual({ outcome: "none_available" });

    rpc.mockResolvedValueOnce({ data: { outcome: "conflict" }, error: null });
    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).resolves.toEqual({ outcome: "conflict" });

    rpc.mockResolvedValueOnce({
      data: { outcome: "claimed", result: {} },
      error: null,
    });
    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).rejects.toThrow("Chat queue returned an invalid response");

    rpc.mockResolvedValueOnce({ data: { outcome: "unknown" }, error: null });
    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).rejects.toThrow("Chat queue returned an invalid response");
  });

  it("returns terminal prepare outcomes without decrypting", async () => {
    const { queue, rpc, decrypt } = setup({ outcome: "cancelled" });

    await expect(queue.prepare(prepareInput())).resolves.toEqual({
      outcome: "cancelled",
    });

    rpc.mockResolvedValueOnce({ data: { outcome: "conflict" }, error: null });
    await expect(queue.prepare(prepareInput())).resolves.toEqual({
      outcome: "conflict",
    });

    rpc.mockResolvedValueOnce({ data: { outcome: "not_found" }, error: null });
    await expect(queue.prepare(prepareInput())).resolves.toEqual({
      outcome: "not_found",
    });

    rpc.mockResolvedValueOnce({ data: { outcome: "unknown" }, error: null });
    await expect(queue.prepare(prepareInput())).rejects.toThrow(
      "Chat queue returned an invalid response",
    );
    expect(decrypt).not.toHaveBeenCalled();
  });

  it("parses complete outcomes and protects provider message hash shape", async () => {
    const { queue, rpc } = setup({ outcome: "completed" });
    const input = {
      organizationId,
      deliveryId,
      workerId,
      checkpointVersion,
      status: "provider_accepted" as const,
      safeErrorCode: null,
      providerMessageIdHash,
      retryAfterSeconds: null,
    };

    await expect(queue.complete(input)).resolves.toEqual({
      outcome: "completed",
    });
    expect(rpc).toHaveBeenCalledWith("m12_05_complete_chat_delivery_atomic", {
      p_organization_id: organizationId,
      p_delivery_id: deliveryId,
      p_lease_owner: workerId,
      p_checkpoint_version: checkpointVersion,
      p_status: "provider_accepted",
      p_safe_error_code: null,
      p_provider_message_id_hash: providerMessageIdHash,
      p_retry_after_seconds: null,
    });

    rpc.mockResolvedValueOnce({ data: { outcome: "replayed" }, error: null });
    await expect(queue.complete(input)).resolves.toEqual({
      outcome: "completed",
    });

    rpc.mockResolvedValueOnce({ data: { outcome: "conflict" }, error: null });
    await expect(queue.complete(input)).resolves.toEqual({
      outcome: "conflict",
    });

    rpc.mockResolvedValueOnce({ data: { outcome: "not_found" }, error: null });
    await expect(queue.complete(input)).resolves.toEqual({
      outcome: "conflict",
    });

    await expect(
      queue.complete({ ...input, providerMessageIdHash: "bad" }),
    ).rejects.toThrow("Chat queue returned an invalid response");

    rpc.mockResolvedValueOnce({ data: { outcome: "unknown" }, error: null });
    await expect(
      queue.complete({ ...input, providerMessageIdHash: null }),
    ).rejects.toThrow("Chat queue returned an invalid response");
  });

  it("requires a current source and route check immediately before network write", async () => {
    const { queue, rpc } = setup(false);

    await expect(queue.revalidate(prepareInput())).resolves.toBe(false);
    expect(rpc).toHaveBeenCalledWith("m12_05_revalidate_chat_delivery_atomic", {
      p_organization_id: organizationId,
      p_delivery_id: deliveryId,
      p_lease_owner: workerId,
      p_checkpoint_version: checkpointVersion,
    });

    rpc.mockResolvedValueOnce({ data: "yes", error: null });
    await expect(queue.revalidate(prepareInput())).rejects.toThrow(
      "Chat queue returned an invalid response",
    );
  });

  it("rejects invalid application origins and storage failures", async () => {
    expect(
      () =>
        new SupabaseChatNotificationQueueAdapter(
          { admin: () => ({ rpc: jest.fn() }) } as never,
          { decrypt: jest.fn() } as never,
          "https://cra.test/app",
        ),
    ).toThrow("Invalid chat application origin");

    const { queue } = setup();
    (queue as unknown as { supabase: { admin(): { rpc: jest.Mock } } }).supabase
      .admin()
      .rpc.mockResolvedValueOnce({ data: null, error: { message: "private" } });
    await expect(queue.bridge(organizationId)).rejects.toThrow(
      "Chat storage is unavailable",
    );
  });
});
