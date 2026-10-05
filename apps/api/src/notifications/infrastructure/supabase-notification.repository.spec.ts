import { SupabaseNotificationRepository } from "./supabase-notification.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const userId = "33333333-3333-4333-8333-333333333333";
const idempotencyKey = "44444444-4444-4444-8444-444444444444";
const feedRef = `m6_${organizationId}_event`;
const fingerprint = "a".repeat(64);
const burstPolicy = {
  policy: {
    organizationId,
    enabled: false,
    version: 1,
    enabledAt: null,
    updatedAt: "2026-10-02T00:00:00Z",
    windowSeconds: 120,
    maxEmailMembers: 100,
  },
};

const preferences = {
  preferences: {
    organizationId,
    userId: actorId,
    version: 1,
    modes: {
      finding_triage: "immediate",
      evidence: "daily",
      supplier_owner: "off",
    },
    schedule: {
      timezone: "Europe/Berlin",
      localTime: "09:00",
      weekday: 1,
      quietHours: null,
    },
  },
};
const route = {
  route: {
    organizationId,
    userId,
    alternateUserId: null,
    version: 1,
  },
};
const delivery = {
  deliveryRef: "dGVzdF9kZWxpdmVyeQ",
  category: "evidence",
  status: "exhausted",
  sourceType: "evidence_validity",
  sourceId: "55555555-5555-4555-8555-555555555555",
  originalRecipientUserId: actorId,
  effectiveRecipientUserId: actorId,
  attemptCount: 4,
  lastAttemptAt: "2026-10-01T08:00:00.000Z",
  nextAttemptAt: null,
  safeErrorCode: "provider_timeout",
  createdAt: "2026-10-01T07:00:00.000Z",
  updatedAt: "2026-10-01T08:00:00.000Z",
  version: 2,
};

describe("Supabase notification repository", () => {
  const rpc = jest.fn();
  const repository = new SupabaseNotificationRepository({
    admin: () => ({ rpc }),
  } as never);

  beforeEach(() => rpc.mockReset());

  it("lists bounded burst batches in the verified organization and actor scope", async () => {
    const batch = {
      batchId: "55555555-5555-4555-8555-555555555555",
      category: "finding_triage",
      eventClass: "finding_suppression_expired",
      status: "queued",
      windowStartsAt: "2026-10-02T00:00:00Z",
      windowEndsAt: "2026-10-02T00:02:00Z",
      memberCount: 3,
      preparedCount: 0,
      attemptCount: 0,
      lastAttemptAt: null,
      nextAttemptAt: "2026-10-02T00:02:00Z",
      safeErrorCode: null,
      createdAt: "2026-10-02T00:00:00Z",
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { rows: [batch], nextCursor: null } }],
      error: null,
    });
    expect(
      await repository.listBurstBatches(organizationId, actorId, {
        limit: 25,
      }),
    ).toEqual({
      outcome: "found",
      data: { rows: [batch], nextCursor: null },
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "list_notification_burst_batches_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_cursor: null,
        p_limit: 25,
      },
    );
  });

  it("reads and updates the scoped organization burst policy with optimistic idempotency", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: burstPolicy }],
      error: null,
    });
    expect(await repository.getBurstPolicy(organizationId, actorId)).toEqual({
      outcome: "found",
      data: burstPolicy,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "get_notification_burst_policy_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      },
    );

    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result: burstPolicy }],
      error: null,
    });
    await repository.updateBurstPolicy(organizationId, actorId, {
      expectedVersion: 1,
      enabled: true,
      idempotencyKey,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "update_notification_burst_policy_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_expected_version: 1,
        p_enabled: true,
        p_idempotency_key: idempotencyKey,
      },
    );
  });

  it("reads and updates self preferences with the actor as target", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: preferences }],
      error: null,
    });
    expect(await repository.getPreferences(organizationId, actorId)).toEqual({
      outcome: "found",
      data: preferences,
    });
    expect(rpc).toHaveBeenCalledWith("get_notification_preferences_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_user_id: actorId,
    });

    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result: preferences }],
      error: null,
    });
    await repository.updatePreferences(organizationId, actorId, {
      expectedVersion: 1,
      idempotencyKey,
      modes: preferences.preferences.modes as never,
      schedule: preferences.preferences.schedule,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "update_notification_preferences_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_user_id: actorId,
        p_expected_version: 1,
        p_modes: preferences.preferences.modes,
        p_schedule: preferences.preferences.schedule,
        p_idempotency_key: idempotencyKey,
        p_reason: null,
      },
    );
  });

  it("passes a separately authorized target to critical route RPCs", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: route }],
      error: null,
    });
    expect(
      await repository.getCriticalRoute(organizationId, actorId, userId),
    ).toEqual({
      outcome: "found",
      data: route,
    });
    expect(rpc).toHaveBeenCalledWith("get_critical_notification_route_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_user_id: userId,
    });

    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result: route }],
      error: null,
    });
    await repository.updateCriticalRoute(organizationId, actorId, userId, {
      alternateUserId: null,
      expectedVersion: 1,
      idempotencyKey,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "update_critical_notification_route_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_user_id: userId,
        p_expected_version: 1,
        p_alternate_user_id: null,
        p_idempotency_key: idempotencyKey,
      },
    );
  });

  it("maps idempotency conflicts and rejects malformed success or storage errors", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "idempotency_conflict", result: null }],
      error: null,
    });
    expect(await repository.getPreferences(organizationId, actorId)).toEqual({
      outcome: "conflict",
    });

    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: {} }],
      error: null,
    });
    await expect(
      repository.getPreferences(organizationId, actorId),
    ).rejects.toThrow();
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(
      repository.getPreferences(organizationId, actorId),
    ).rejects.toThrow();
    rpc.mockResolvedValue({
      data: null,
      error: { message: "private SQL details" },
    });
    await expect(
      repository.getPreferences(organizationId, actorId),
    ).rejects.toThrow("Notification storage is unavailable");
  });

  it("bounds audit delivery reads and retries by organization, actor and revision", async () => {
    rpc.mockResolvedValue({
      data: [
        { outcome: "found", result: { rows: [delivery], nextCursor: null } },
      ],
      error: null,
    });
    expect(
      await repository.listDeliveries(organizationId, actorId, {
        status: "exhausted",
        category: "evidence",
        recipientUserId: actorId,
        limit: 10,
      }),
    ).toEqual({
      outcome: "found",
      data: { rows: [delivery], nextCursor: null },
    });
    expect(rpc).toHaveBeenCalledWith("list_notification_dispatches_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_status: "exhausted",
      p_category: "evidence",
      p_recipient_user_id: actorId,
      p_cursor: null,
      p_limit: 10,
    });

    rpc.mockResolvedValue({
      data: [{ outcome: "queued", result: { delivery } }],
      error: null,
    });
    expect(
      await repository.retryDelivery(
        organizationId,
        actorId,
        delivery.deliveryRef,
        {
          expectedVersion: 2,
          idempotencyKey,
        },
      ),
    ).toEqual({ outcome: "updated", data: { delivery } });
    expect(rpc).toHaveBeenLastCalledWith("retry_notification_dispatch_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_delivery_ref: delivery.deliveryRef,
      p_expected_version: 2,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("parses source-owned critical delivery metadata and passes its opaque retry ref", async () => {
    const critical = {
      ...delivery,
      deliveryRef: `m2_${delivery.sourceId}`,
      category: "support_period",
      sourceType: "support_period",
      effectiveRecipientUserId: null,
    };
    rpc.mockResolvedValue({
      data: [
        { outcome: "found", result: { rows: [critical], nextCursor: null } },
      ],
      error: null,
    });
    expect(
      await repository.listDeliveries(organizationId, actorId, {
        category: "support_period",
        status: "exhausted",
        limit: 50,
      }),
    ).toEqual({
      outcome: "found",
      data: { rows: [critical], nextCursor: null },
    });

    rpc.mockResolvedValue({
      data: [
        {
          outcome: "queued",
          result: { delivery: { ...critical, status: "queued", version: 3 } },
        },
      ],
      error: null,
    });
    expect(
      await repository.retryDelivery(
        organizationId,
        actorId,
        critical.deliveryRef,
        {
          expectedVersion: 2,
          idempotencyKey,
        },
      ),
    ).toEqual({
      outcome: "updated",
      data: { delivery: { ...critical, status: "queued", version: 3 } },
    });
    expect(rpc).toHaveBeenLastCalledWith("retry_notification_dispatch_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_delivery_ref: critical.deliveryRef,
      p_expected_version: 2,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("sends absent list filters as null and normalizes safe outcomes", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { rows: [], nextCursor: null } }],
      error: null,
    });
    await repository.listDeliveries(organizationId, actorId, { limit: 50 });
    expect(rpc).toHaveBeenCalledWith("list_notification_dispatches_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_status: null,
      p_category: null,
      p_recipient_user_id: null,
      p_cursor: null,
      p_limit: 50,
    });

    for (const outcome of [
      "not_found",
      "forbidden",
      "conflict",
      "invalid_request",
    ] as const) {
      rpc.mockResolvedValue({ data: [{ outcome, result: null }], error: null });
      expect(await repository.getPreferences(organizationId, actorId)).toEqual({
        outcome,
      });
    }
    rpc.mockResolvedValue({
      data: [{ outcome: "invalid_state", result: null }],
      error: null,
    });
    expect(await repository.getPreferences(organizationId, actorId)).toEqual({
      outcome: "invalid_request",
    });
    rpc.mockResolvedValue({
      data: [{ outcome: "replayed", result: preferences }],
      error: null,
    });
    expect(await repository.getPreferences(organizationId, actorId)).toEqual({
      outcome: "replayed",
      data: preferences,
    });
    rpc.mockResolvedValue({
      data: [{ outcome: "unrecognized", result: null }],
      error: null,
    });
    await expect(
      repository.getPreferences(organizationId, actorId),
    ).rejects.toThrow("Notification storage returned an invalid outcome");
    rpc.mockResolvedValue({ data: [null], error: null });
    await expect(
      repository.getPreferences(organizationId, actorId),
    ).rejects.toThrow("Notification storage returned an invalid response");
  });

  it("passes session scope to feed RPCs and parses only safe payloads", async () => {
    const item = {
      ref: feedRef,
      category: "reporting_deadline",
      severity: "critical",
      occurredAt: "2026-10-02T00:00:00Z",
      title: "Reporting deadline",
      summary: "A reporting deadline needs attention.",
      read: false,
      fingerprint,
      sourceState: "available",
      noticeKind: "event",
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { items: [item], nextCursor: null } }],
      error: null,
    });
    expect(
      await repository.listFeed(organizationId, actorId, {
        limit: 25,
        read: "all",
      }),
    ).toEqual({
      outcome: "found",
      data: { items: [item], nextCursor: null },
    });
    expect(rpc).toHaveBeenLastCalledWith("list_notification_feed_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_category: null,
      p_severity: null,
      p_read: "all",
      p_cursor: null,
      p_limit: 25,
    });

    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { count: 3 } }],
      error: null,
    });
    expect(await repository.countFeedUnread(organizationId, actorId)).toEqual({
      outcome: "found",
      data: { count: 3 },
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "count_notification_feed_unread_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
      },
    );

    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: { state: "available", url: `/products/${organizationId}` },
        },
      ],
      error: null,
    });
    expect(
      await repository.resolveFeedDestination(
        organizationId,
        actorId,
        feedRef as never,
      ),
    ).toEqual({
      outcome: "found",
      data: { state: "available", url: `/products/${organizationId}` },
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "resolve_notification_feed_destination_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_ref: feedRef,
      },
    );
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "found",
          result: { state: "available", url: "https://evil.test" },
        },
      ],
      error: null,
    });
    await expect(
      repository.resolveFeedDestination(
        organizationId,
        actorId,
        feedRef as never,
      ),
    ).rejects.toThrow();

    const input = {
      items: [{ ref: feedRef, expectedFingerprint: fingerprint }],
      idempotencyKey,
    };
    const result = {
      items: [{ ref: feedRef, fingerprint, readAt: "2026-10-02T00:00:00Z" }],
      replayed: false,
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "updated", result }],
      error: null,
    });
    expect(
      await repository.markFeedRead(organizationId, actorId, input as never),
    ).toEqual({ outcome: "updated", data: result });
    expect(rpc).toHaveBeenLastCalledWith("mark_notification_feed_read_atomic", {
      p_organization_id: organizationId,
      p_actor_user_id: actorId,
      p_items: input.items,
      p_idempotency_key: idempotencyKey,
    });
  });

  it("routes grouped and filtered reads without changing the default event RPC", async () => {
    rpc.mockResolvedValue({
      data: [{ outcome: "found", result: { items: [], nextCursor: null } }],
      error: null,
    });
    await repository.listFeed(organizationId, actorId, {
      view: "grouped",
      category: "finding_triage",
      severity: "warning",
      read: "unread",
      limit: 20,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "list_notification_feed_grouped_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_category: "finding_triage",
        p_severity: "warning",
        p_read: "unread",
        p_cursor: null,
        p_limit: 20,
      },
    );

    await repository.listFeed(organizationId, actorId, {
      batchId: "55555555-5555-4555-8555-555555555555",
      read: "all",
      limit: 25,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "list_notification_feed_batch_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_batch_id: "55555555-5555-4555-8555-555555555555",
        p_cursor: null,
        p_limit: 25,
      },
    );

    await repository.listFeed(organizationId, actorId, {
      eventClass: "finding_suppression_expired",
      windowStart: "2026-10-02T00:00:00Z",
      read: "all",
      limit: 25,
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "list_notification_feed_cohort_atomic",
      {
        p_organization_id: organizationId,
        p_actor_user_id: actorId,
        p_event_class: "finding_suppression_expired",
        p_window_start: "2026-10-02T00:00:00Z",
        p_cursor: null,
        p_limit: 25,
      },
    );
  });
});
