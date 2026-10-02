import { SupabaseNotificationDigestQueueAdapter } from "./supabase-notification-digest-queue.adapter";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workerId = "22222222-2222-4222-8222-222222222222";
const batchId = "33333333-3333-4333-8333-333333333333";
const recipientId = "44444444-4444-4444-8444-444444444444";
const fence = {
  organizationId,
  batchId,
  leaseOwner: workerId,
  checkpointVersion: 2,
};

function subject(rpc: jest.Mock): SupabaseNotificationDigestQueueAdapter {
  return new SupabaseNotificationDigestQueueAdapter({
    admin: () => ({ rpc }),
  } as never);
}

describe("SupabaseNotificationDigestQueueAdapter", () => {
  it("reconciles ambiguous leases before digest work", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "reconciled", dispatches: 1, digests: 2 }],
      error: null,
    });
    await expect(subject(rpc).reconcileAmbiguousLeases()).resolves.toEqual({
      outcome: "reconciled",
      dispatches: 1,
      digests: 2,
    });
    expect(rpc).toHaveBeenCalledWith(
      "reconcile_notification_ambiguous_leases_atomic",
      { p_limit: 1000 },
    );
  });

  it("pages ordered due organizations and schedules per tenant", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ organization_id: organizationId }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "scheduled", created: 1, cancelled: 0, deferred: 0 }],
        error: null,
      });
    const adapter = subject(rpc);
    await expect(adapter.dueOrganizations(null)).resolves.toEqual({
      organizationIds: [organizationId],
      nextOrganizationId: null,
    });
    await expect(adapter.schedule(organizationId)).resolves.toEqual({
      outcome: "scheduled",
      created: 1,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "list_due_notification_digest_organizations_atomic",
      {
        p_after_organization_id: null,
        p_limit: 100,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "schedule_notification_digest_batches_atomic",
      {
        p_organization_id: organizationId,
        p_limit: 1000,
      },
    );
  });

  it("rejects a duplicate tenant page", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        { organization_id: organizationId },
        { organization_id: organizationId },
      ],
      error: null,
    });
    await expect(subject(rpc).dueOrganizations(null)).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("claims and parses only the same batch and lease owner", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "claimed",
            batch: { batchId, leaseOwner: workerId, checkpointVersion: 2 },
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "ready",
            delivery: {
              deliveryRef: batchId,
              idempotencyKey: `notification-digest:${batchId}`,
              recipient: { userId: recipientId, email: "owner@cra.test" },
              payload: {
                kind: "digest",
                items: [
                  {
                    title: "Evidence",
                    href: "/evidence",
                    date: "2026-11-01",
                    category: "evidence",
                  },
                ],
              },
            },
          },
        ],
        error: null,
      });
    const adapter = subject(rpc);
    await expect(
      adapter.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).resolves.toEqual({
      outcome: "claimed",
      batchId,
      leaseOwner: workerId,
      checkpointVersion: 2,
    });
    await expect(adapter.prepare(fence)).resolves.toMatchObject({
      outcome: "ready",
      recipient: { userId: recipientId },
      payload: { kind: "digest" },
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_notification_digest_batch_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: workerId,
        p_lease_seconds: 120,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "prepare_notification_digest_batch_atomic",
      {
        p_organization_id: organizationId,
        p_batch_id: batchId,
        p_worker_id: workerId,
        p_expected_version: 2,
      },
    );
  });

  it("rejects substituted delivery reference, excessive items, and unsafe links", async () => {
    for (const delivery of [
      {
        deliveryRef: organizationId,
        items: [
          {
            title: "Evidence",
            href: "/evidence",
            date: "2026-11-01",
            category: "evidence",
          },
        ],
      },
      {
        deliveryRef: batchId,
        items: Array.from({ length: 101 }, () => ({
          title: "Evidence",
          href: "/evidence",
          date: "2026-11-01",
          category: "evidence",
        })),
      },
      {
        deliveryRef: batchId,
        items: [
          {
            title: "Evidence",
            href: "//evil.test",
            date: "2026-11-01",
            category: "evidence",
          },
        ],
      },
    ]) {
      const rpc = jest.fn().mockResolvedValue({
        data: [
          {
            outcome: "ready",
            delivery: {
              deliveryRef: delivery.deliveryRef,
              idempotencyKey: `notification-digest:${batchId}`,
              recipient: { userId: recipientId, email: "owner@cra.test" },
              payload: { kind: "digest", items: delivery.items },
            },
          },
        ],
        error: null,
      });
      await expect(subject(rpc).prepare(fence)).rejects.toMatchObject({
        code: "malformed_provider",
      });
    }
  });

  it("rejects a substituted digest message identity", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "ready",
          delivery: {
            deliveryRef: batchId,
            idempotencyKey: `notification-digest:${organizationId}`,
            recipient: { userId: recipientId, email: "owner@cra.test" },
            payload: {
              kind: "digest",
              items: [
                {
                  title: "Evidence",
                  href: "/evidence",
                  date: "2026-11-01",
                  category: "evidence",
                },
              ],
            },
          },
        },
      ],
      error: null,
    });
    await expect(subject(rpc).prepare(fence)).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("commits provider acceptance and sanitizes failure codes", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ outcome: "completed" }], error: null })
      .mockResolvedValueOnce({
        data: [{ outcome: "retry_scheduled" }],
        error: null,
      });
    const adapter = subject(rpc);
    await expect(
      adapter.complete({ ...fence, messageIdHash: "a".repeat(64) }),
    ).resolves.toEqual({ outcome: "completed" });
    await expect(
      adapter.fail({
        ...fence,
        code: "secret-provider-error",
        retryable: true,
      }),
    ).resolves.toEqual({ outcome: "retry_scheduled" });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "complete_notification_digest_batch_atomic",
      {
        p_organization_id: organizationId,
        p_batch_id: batchId,
        p_worker_id: workerId,
        p_expected_version: 2,
        p_outcome: "provider_accepted",
        p_message_id_hash: "a".repeat(64),
        p_error_code: null,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "fail_notification_digest_batch_atomic",
      {
        p_organization_id: organizationId,
        p_batch_id: batchId,
        p_worker_id: workerId,
        p_expected_version: 2,
        p_error_code: "provider_unavailable",
        p_retryable: true,
      },
    );
  });

  it("redacts storage errors and rejects malformed rows", async () => {
    const outage = subject(
      jest.fn().mockRejectedValue(new Error("secret connection string")),
    );
    const malformed = subject(
      jest.fn().mockResolvedValue({ data: [null], error: null }),
    );
    await expect(outage.reconcileAmbiguousLeases()).rejects.toMatchObject({
      code: "provider_unavailable",
    });
    await expect(malformed.reconcileAmbiguousLeases()).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("rejects invalid pagination input and malformed schedule output", async () => {
    const rpc = jest.fn();
    await expect(subject(rpc).dueOrganizations("bad")).rejects.toMatchObject({
      code: "malformed_provider",
    });
    expect(rpc).not.toHaveBeenCalled();
    const invalidSchedule = subject(
      jest.fn().mockResolvedValue({
        data: [
          { outcome: "scheduled", created: "one", cancelled: 0, deferred: 0 },
        ],
        error: null,
      }),
    );
    await expect(
      invalidSchedule.schedule(organizationId),
    ).rejects.toMatchObject({ code: "malformed_provider" });
  });

  it.each(["none_available", "conflict"])(
    "preserves claim %s",
    async (outcome) => {
      const adapter = subject(
        jest.fn().mockResolvedValue({ data: [{ outcome }], error: null }),
      );
      await expect(
        adapter.claim({ organizationId, workerId, leaseSeconds: 120 }),
      ).resolves.toEqual({ outcome });
    },
  );

  it("rejects an invalid lease and substituted owner", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "claimed",
          batch: {
            batchId,
            leaseOwner: recipientId,
            checkpointVersion: 2,
          },
        },
      ],
      error: null,
    });
    const adapter = subject(rpc);
    await expect(
      adapter.claim({ organizationId, workerId, leaseSeconds: 15 }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      adapter.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
  });

  it.each(["cancelled", "deferred", "conflict", "not_found"])(
    "preserves prepare %s",
    async (outcome) => {
      const adapter = subject(
        jest.fn().mockResolvedValue({ data: [{ outcome }], error: null }),
      );
      await expect(adapter.prepare(fence)).resolves.toEqual({ outcome });
    },
  );

  it.each(["conflict", "not_found"])(
    "maps completion %s to conflict",
    async (outcome) => {
      const adapter = subject(
        jest.fn().mockResolvedValue({ data: [{ outcome }], error: null }),
      );
      await expect(
        adapter.complete({ ...fence, messageIdHash: null }),
      ).resolves.toEqual({ outcome: "conflict" });
    },
  );

  it("rejects raw message IDs and unknown completion and failure outcomes", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValue({ data: [{ outcome: "unknown" }], error: null });
    const adapter = subject(rpc);
    await expect(
      adapter.complete({ ...fence, messageIdHash: "raw-id" }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      adapter.complete({ ...fence, messageIdHash: null }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      adapter.fail({ ...fence, code: "delivery_failed", retryable: false }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
  });
});
