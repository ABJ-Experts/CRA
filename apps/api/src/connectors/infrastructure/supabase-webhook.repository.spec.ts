import { SupabaseWebhookRepository } from "./supabase-webhook.repository";
import {
  fixtureWebhookDelivery,
  fixtureWebhookEndpoint,
  webhookFixtureIds as ids,
} from "../application/webhook-test-fixtures";
import type { SupabaseService } from "../../supabase/supabase.service";
import type {
  ClaimedWebhookDelivery,
  WebhookEndpointCommandRequest,
} from "../application/webhook-repository.port";
const page = { page: 1, pageSize: 15 };
function endpointRow() {
  const e = fixtureWebhookEndpoint();
  return {
    id: e.id,
    organization_id: e.organizationId,
    display_name: e.displayName,
    url: e.url,
    event_types: e.eventTypes,
    product_ids: e.productIds,
    enabled: e.enabled,
    secret_ciphertext: "cipher",
    signing_key_id: e.signingKeyId,
    previous_signing_key_id: null,
    previous_secret_expires_at: null,
    secret_revision: 1,
    scope_revision: 1,
    destination_revision: 1,
    version: 1,
    max_attempts: 6,
    base_delay_seconds: 5,
    max_delay_seconds: 300,
    last_delivered_at: null,
    last_failure_category: null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
  };
}
function deliveryRow() {
  const d = fixtureWebhookDelivery();
  return {
    id: d.id,
    endpoint_id: d.endpointId,
    event_id: d.eventId,
    delivery_id: d.deliveryId,
    event_type: d.eventType,
    status: d.status,
    resource_type: d.resource.type,
    resource_id: d.resource.id,
    resource_url: d.resource.url,
    occurred_at: d.occurredAt,
    next_attempt_at: d.nextAttemptAt,
    attempt_count: d.attemptCount,
    last_http_status: d.lastHttpStatus,
    last_failure_category: d.lastFailureCategory,
    last_failure_code: d.lastFailureCode,
    version: d.version,
    endpoint_version: 1,
    scope_revision: 1,
    destination_revision: 1,
    parent_delivery_id: null,
    deadline_at: d.deadlineAt,
    completed_at: d.completedAt,
    created_at: d.createdAt,
    updated_at: d.updatedAt,
    product_ids: [ids.product],
    source_kind: "product_event",
    source_id: ids.source,
    endpoint_url: "https://receiver.example/events",
  };
}
function fixture() {
  let result: { data: unknown; error: unknown; count?: number } = {
    data: null,
    error: null,
  };
  const query: {
    select: jest.Mock<unknown, []>;
    eq: jest.Mock<unknown, []>;
    in: jest.Mock<unknown, []>;
    order: jest.Mock<unknown, []>;
    range: jest.Mock<unknown, []>;
    maybeSingle: jest.Mock<Promise<typeof result>, []>;
    then: (resolve: (r: unknown) => unknown) => Promise<unknown>;
  } = {
    select: jest.fn(() => query),
    eq: jest.fn(() => query),
    in: jest.fn(() => query),
    order: jest.fn(() => query),
    range: jest.fn(() => query),
    maybeSingle: jest.fn(() => Promise.resolve(result)),
    then: (resolve: (r: unknown) => unknown) =>
      Promise.resolve(resolve(result)),
  };
  const client = {
    from: jest.fn(() => query),
    rpc: jest.fn().mockResolvedValue({
      data: [{ outcome: "updated", endpoint: fixtureWebhookEndpoint() }],
      error: null,
    }),
  };
  const repository = new SupabaseWebhookRepository({
    admin: () => client,
  } as unknown as SupabaseService);
  return {
    repository,
    query,
    client,
    set: (value: typeof result) => {
      result = value;
    },
  };
}
const request: WebhookEndpointCommandRequest = {
  authorization: {
    organizationId: ids.org,
    actorId: ids.actor,
    permissionVersion: 1,
    role: "owner",
  },
  endpointId: ids.endpoint,
  operation: "update",
  expectedVersion: 1,
  idempotencyKey: ids.idempotency,
  requestDigest: "a".repeat(64),
  requestDigestKeyId: "master",
  payload: {},
};
describe("SupabaseWebhookRepository tenant boundary", () => {
  it("returns unknown source scope as withheld metadata", async () => {
    const f = fixture();
    f.client.rpc.mockResolvedValue({
      data: [
        {
          delivery_id: ids.delivery,
          outcome: "scope_unknown",
          product_ids: [],
          resource: null,
        },
      ],
      error: null,
    });
    expect(
      await f.repository.deliveryScopes(ids.org, ids.endpoint, [ids.delivery]),
    ).toEqual([{ deliveryId: ids.delivery, scope: null }]);
    f.set({ data: { secret_id: null }, error: null });
    expect(await f.repository.signingSecrets(ids.org, ids.endpoint)).toEqual(
      [],
    );
  });

  it("only reads/decode encrypted keyslots within organization and honors overlap", async () => {
    const f = fixture();
    const hex = (bytes: number) =>
      "\\x" + Buffer.alloc(bytes, 1).toString("hex");
    const row = {
      secret_id: ids.key,
      signing_key_id: ids.key,
      secret_revision: 1,
      secret_ciphertext: hex(32),
      secret_key_id: "master",
      secret_nonce: hex(12),
      secret_auth_tag: hex(16),
      previous_secret_expires_at: "2099-01-01T00:00:00Z",
      previous_secret_id: ids.source,
      previous_signing_key_id: ids.source,
      previous_secret_revision: 1,
      previous_secret_ciphertext: hex(32),
      previous_secret_key_id: "old-master",
      previous_secret_nonce: hex(12),
      previous_secret_auth_tag: hex(16),
    };
    f.set({ data: row, error: null });
    expect(
      await f.repository.signingSecrets(ids.org, ids.endpoint),
    ).toHaveLength(2);
    expect(f.query.eq).toHaveBeenCalledWith("organization_id", ids.org);
    f.set({
      data: { ...row, previous_secret_expires_at: "2000-01-01T00:00:00Z" },
      error: null,
    });
    expect(
      await f.repository.signingSecrets(ids.org, ids.endpoint),
    ).toHaveLength(1);
    f.set({ data: { ...row, secret_ciphertext: "bad" }, error: null });
    await expect(
      f.repository.signingSecrets(ids.org, ids.endpoint),
    ).rejects.toMatchObject({ code: "unavailable" });
    f.set({ data: null, error: null });
    await expect(
      f.repository.signingSecrets(ids.org, ids.endpoint),
    ).rejects.toMatchObject({ code: "not_found" });
    f.set({ data: null, error: { message: "canary" } });
    await expect(
      f.repository.signingSecrets(ids.org, ids.endpoint),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("batch-validates bounded current scopes without cross-tenant substitutions", async () => {
    const f = fixture();
    expect(
      await f.repository.deliveryScopes(ids.org, ids.endpoint, []),
    ).toEqual([]);
    f.client.rpc.mockResolvedValue({
      data: [
        {
          delivery_id: ids.delivery,
          outcome: "authorized_scope",
          product_ids: [ids.product],
          resource: fixtureWebhookDelivery().resource,
        },
      ],
      error: null,
    });
    expect(
      await f.repository.deliveryScopes(ids.org, ids.endpoint, [ids.delivery]),
    ).toEqual([
      {
        deliveryId: ids.delivery,
        scope: {
          productIds: [ids.product],
          resource: fixtureWebhookDelivery().resource,
        },
      },
    ]);
    f.client.rpc.mockResolvedValue({
      data: [
        {
          delivery_id: ids.source,
          outcome: "authorized_scope",
          product_ids: [ids.product],
          resource: fixtureWebhookDelivery().resource,
        },
      ],
      error: null,
    });
    await expect(
      f.repository.deliveryScopes(ids.org, ids.endpoint, [ids.delivery]),
    ).rejects.toMatchObject({ code: "unavailable" });
    f.client.rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      f.repository.deliveryScopes(ids.org, ids.endpoint, [ids.delivery]),
    ).rejects.toMatchObject({ code: "unavailable" });
  });

  it("normalizes PostgreSQL UTC offsets at the response boundary", async () => {
    const f = fixture();
    f.set({
      data: {
        ...endpointRow(),
        created_at: "2026-09-29T12:00:00+00:00",
        updated_at: "2026-09-29T12:00:00+00:00",
      },
      error: null,
    });
    expect((await f.repository.endpoint(ids.org, ids.endpoint)).createdAt).toBe(
      "2026-09-29T12:00:00.000Z",
    );
  });

  it("scopes endpoint list/detail reads and only returns safe metadata", async () => {
    const f = fixture();
    f.set({ data: [endpointRow()], error: null, count: 1 });
    expect((await f.repository.listEndpoints(ids.org, page)).rows[0]).toEqual(
      fixtureWebhookEndpoint(),
    );
    expect(f.query.eq).toHaveBeenCalledWith("organization_id", ids.org);
    f.set({ data: endpointRow(), error: null });
    expect(await f.repository.endpoint(ids.org, ids.endpoint)).toEqual(
      fixtureWebhookEndpoint(),
    );
    expect(
      JSON.stringify(await f.repository.endpoint(ids.org, ids.endpoint)),
    ).not.toContain("cipher");
  });
  it.each([
    { secret_ciphertext: null, status: "secret_required" },
    { enabled: false, status: "disabled" },
    { last_failure_category: "timeout", status: "degraded" },
  ])("projects status $status", async (input) => {
    const f = fixture();
    f.set({ data: { ...endpointRow(), ...input }, error: null });
    expect((await f.repository.endpoint(ids.org, ids.endpoint)).status).toBe(
      input.status,
    );
  });
  it("validates every selected product in organization", async () => {
    const f = fixture();
    f.set({ data: [{ id: ids.product }], error: null, count: 1 });
    await f.repository.validateProducts(ids.org, [ids.product]);
    expect(f.query.in).toHaveBeenCalledWith("id", [ids.product]);
    await expect(
      f.repository.validateProducts(ids.org, []),
    ).rejects.toMatchObject({ code: "invalid_request" });
    await expect(
      f.repository.validateProducts(ids.org, [ids.product, ids.product]),
    ).rejects.toMatchObject({ code: "invalid_request" });
    f.set({ data: [], error: null, count: 0 });
    await expect(
      f.repository.validateProducts(ids.org, [ids.product]),
    ).rejects.toMatchObject({ code: "not_found" });
  });
  it("retains command fingerprint key identity", async () => {
    const f = fixture();
    expect(
      await f.repository.existingCommandKeyId(ids.org, ids.actor, ""),
    ).toBeNull();
    expect(
      await f.repository.existingCommandKeyId(
        ids.org,
        ids.actor,
        ids.idempotency,
      ),
    ).toBeNull();
    f.set({ data: { request_digest_key_id: "old-master" }, error: null });
    expect(
      await f.repository.existingCommandKeyId(
        ids.org,
        ids.actor,
        ids.idempotency,
      ),
    ).toBe("old-master");
    expect(f.query.eq).toHaveBeenCalledWith("actor_user_id", ids.actor);
  });
  it("executes scoped commands and projects test/replay results", async () => {
    const f = fixture();
    expect(await f.repository.executeEndpointCommand(ids.org, request)).toEqual(
      fixtureWebhookEndpoint(),
    );
    expect(f.client.rpc).toHaveBeenCalledWith(
      "m1103_execute_webhook_endpoint_command_atomic",
      expect.objectContaining({
        p_organization_id: ids.org,
        p_expected_version: 1,
        p_actor_user_id: ids.actor,
      }),
    );
    for (const operation of ["test", "replay"] as const) {
      f.client.rpc.mockResolvedValue({
        data: [
          {
            outcome: "replayed",
            command: { delivery: fixtureWebhookDelivery() },
          },
        ],
        error: null,
      });
      expect(
        await f.repository.executeEndpointCommand(ids.org, {
          ...request,
          operation,
          reason: "Reviewed",
        }),
      ).toEqual(fixtureWebhookDelivery());
    }
    f.client.rpc.mockResolvedValue({
      data: [{ outcome: "queued", delivery: fixtureWebhookDelivery() }],
      error: null,
    });
    expect(
      await f.repository.executeEndpointCommand(ids.org, {
        ...request,
        operation: "test",
      }),
    ).toEqual(fixtureWebhookDelivery());
  });
  it("reads durable delivery context, history and attempt metadata", async () => {
    const f = fixture();
    f.set({ data: [deliveryRow()], error: null, count: 1 });
    expect(
      (await f.repository.listDeliveries(ids.org, ids.endpoint, page)).rows[0],
    ).toEqual(fixtureWebhookDelivery());
    f.set({ data: deliveryRow(), error: null });
    const context = await f.repository.deliveryContext(
      ids.org,
      ids.endpoint,
      ids.delivery,
    );
    expect(context.productIds).toEqual([ids.product]);
    expect(context.destinationUrl).toBe("https://receiver.example/events");
    const attempt = {
      id: ids.source,
      delivery_row_id: ids.delivery,
      attempt_number: 1,
      lease_generation: 1,
      started_at: "2026-09-29T12:00:00Z",
      finished_at: null,
      outcome: null,
      http_status: null,
      duration_ms: null,
      failure_category: null,
      failure_code: null,
      response_bytes: null,
    };
    f.query.maybeSingle.mockImplementation(() =>
      Promise.resolve({
        data: deliveryRow(),
        error: null,
      }),
    );
    f.set({ data: [attempt], error: null, count: 1 });
    const detail = await f.repository.delivery(
      ids.org,
      ids.endpoint,
      ids.delivery,
      page,
    );
    expect(detail.attempts.rows[0]?.outcome).toBe("running");
    expect(detail.attempts.rows[0]?.leaseGeneration).toBe(1);
  });
  it("gets current source scope and authoritative replay preview", async () => {
    const f = fixture();
    const d = fixtureWebhookDelivery();
    const context = {
      delivery: d,
      productIds: [ids.product],
      sourceKind: "product_event",
      sourceId: ids.source,
      destinationRevision: 1,
      scopeRevision: 1,
      destinationUrl: "https://receiver.example/events",
    };
    f.client.rpc.mockResolvedValue({
      data: [
        {
          outcome: "authorized_scope",
          product_ids: [ids.product],
          resource: d.resource,
        },
      ],
      error: null,
    });
    expect(await f.repository.sourceScope(ids.org, context)).toEqual({
      productIds: [ids.product],
      resource: d.resource,
    });
    const preview = {
      deliveryRowId: ids.delivery,
      endpointId: ids.endpoint,
      deliveryVersion: 2,
      endpointVersion: 1,
      previewDigest: "a".repeat(64),
      receiverChanged: false,
      currentHost: "receiver.example",
      currentDestination: "https://receiver.example/events",
      previousDestination: "https://receiver.example/events",
      previousHost: "receiver.example",
      eventType: d.eventType,
      resource: d.resource,
      payloadSha256: "b".repeat(64),
    };
    f.client.rpc.mockResolvedValue({
      data: [{ outcome: "previewed", preview }],
      error: null,
    });
    expect(
      await f.repository.previewReplay(
        ids.org,
        ids.endpoint,
        ids.delivery,
        request.authorization,
        1,
        2,
      ),
    ).toEqual(preview);
  });
  it("claims real actor and fences final preparation", async () => {
    const f = fixture();
    const claim: ClaimedWebhookDelivery = {
      delivery: fixtureWebhookDelivery(),
      productIds: [ids.product],
      sourceKind: "product_event",
      sourceId: ids.source,
      destinationRevision: 1,
      scopeRevision: 1,
      destinationUrl: "https://receiver.example/events",
      authorizationActorId: ids.actor,
      endpointAuthorizationActorId: ids.actor,
      permissionVersion: 1,
      payloadBytes: null,
      endpoint: {
        id: ids.endpoint,
        url: "https://receiver.example/events",
        secretRevision: 1,
        active: {
          keyId: ids.key,
          secretId: ids.key,
          revision: 1,
          envelope: {
            format: "aes-256-gcm-v1",
            keyId: "master",
            ciphertext: "cipher",
            nonce: "nonce",
            authTag: "tag",
          },
        },
        previous: null,
      },
      leaseGeneration: 1,
      workerId: "worker",
    };
    f.client.rpc.mockResolvedValue({
      data: [{ outcome: "claimed", result: claim }],
      error: null,
    });
    expect(await f.repository.claim(ids.org, "worker", 60)).toEqual(claim);
    f.client.rpc.mockResolvedValue({
      data: [{ outcome: "prepared" }],
      error: null,
    });
    await f.repository.permit(
      ids.org,
      claim,
      request.authorization,
      { productIds: [ids.product], resource: claim.delivery.resource },
      "bytes",
    );
    expect(f.client.rpc).toHaveBeenLastCalledWith(
      "m1103_prepare_webhook_delivery",
      expect.objectContaining({
        p_generation: 1,
        p_permission_version: 1,
        p_secret_revision: 1,
        p_payload_bytes: "bytes",
      }),
    );
    for (const outcome of ["empty", "canceled"]) {
      f.client.rpc.mockResolvedValue({ data: [{ outcome }], error: null });
      expect(await f.repository.claim(ids.org, "worker", 60)).toBeNull();
    }
  });
  it("records only safe completion/failure fields", async () => {
    const f = fixture();
    f.client.rpc.mockResolvedValue({
      data: [{ outcome: "succeeded" }],
      error: null,
    });
    await f.repository.complete(ids.org, ids.delivery, "worker", 1, {
      status: 204,
      durationMs: 5,
      responseBytes: 0,
    });
    f.client.rpc.mockResolvedValue({
      data: [{ outcome: "retrying" }],
      error: null,
    });
    await f.repository.fail(ids.org, ids.delivery, "worker", 1, {
      category: "rate_limit",
      code: "rate_limit",
      status: 429,
      durationMs: 5,
      responseBytes: 0,
      retryAfterSeconds: 60,
    });
    expect(f.client.rpc).toHaveBeenLastCalledWith(
      "m1103_fail_webhook_delivery",
      expect.objectContaining({
        p_retry_after_seconds: 60,
        p_organization_id: ids.org,
      }),
    );
  });
  it("lists due organizations and rejects storage failures", async () => {
    const f = fixture();
    f.client.rpc.mockResolvedValue({
      data: [{ organization_id: ids.org }, { bad: true }, null],
      error: null,
    });
    expect(await f.repository.dueOrganizations(10)).toEqual([ids.org]);
    f.client.rpc.mockResolvedValue({
      data: null,
      error: { message: "secret-canary" },
    });
    await expect(f.repository.dueOrganizations(10)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
  it.each([
    "not_found",
    "forbidden",
    "conflict",
    "idempotency_conflict",
    "invalid_request",
    "lease_lost",
    "scope_unknown",
    "stale_preview",
    "already_running",
    "invalid_state",
    "unknown",
  ])("maps %s to safe application error", async (outcome) => {
    const f = fixture();
    f.client.rpc.mockResolvedValue({ data: [{ outcome }], error: null });
    await expect(
      f.repository.executeEndpointCommand(ids.org, request),
    ).rejects.toThrow(/^Connector request failed:/);
  });
  it.each([
    { data: null, error: null },
    { data: [null], error: null },
    { data: [], error: null },
    { data: [{ outcome: "updated" }], error: { message: "canary" } },
  ])("fails closed on malformed RPC results", async (result) => {
    const f = fixture();
    f.client.rpc.mockResolvedValue(result);
    await expect(
      f.repository.executeEndpointCommand(ids.org, request),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
  it("maps missing/error reads without exposing arbitrary messages", async () => {
    const f = fixture();
    await expect(
      f.repository.endpoint(ids.org, ids.endpoint),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.repository.deliveryContext(ids.org, ids.endpoint, ids.delivery),
    ).rejects.toMatchObject({ code: "not_found" });
    await expect(
      f.repository.delivery(ids.org, ids.endpoint, ids.delivery, page),
    ).rejects.toMatchObject({ code: "not_found" });
    f.set({ data: null, error: { message: "canary" } });
    for (const call of [
      () => f.repository.endpoint(ids.org, ids.endpoint),
      () => f.repository.listEndpoints(ids.org, page),
      () => f.repository.validateProducts(ids.org, [ids.product]),
      () =>
        f.repository.existingCommandKeyId(ids.org, ids.actor, ids.idempotency),
      () => f.repository.deliveryContext(ids.org, ids.endpoint, ids.delivery),
      () => f.repository.listDeliveries(ids.org, ids.endpoint, page),
      () => f.repository.delivery(ids.org, ids.endpoint, ids.delivery, page),
    ])
      await expect(call()).rejects.toMatchObject({ code: "unavailable" });
  });
});
