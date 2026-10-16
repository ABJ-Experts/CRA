import { SupabaseNotificationBurstQueueAdapter } from "./supabase-notification-burst-queue.adapter";

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
const delivery = {
  deliveryRef: batchId,
  idempotencyKey: `notification-burst:${batchId}`,
  recipient: { userId: recipientId, email: "owner@cra.test" },
  payload: {
    kind: "burst",
    count: 7,
    href: `/notifications?batchId=${batchId}`,
    items: [
      {
        title: "Finding update",
        href: "/findings",
        date: "2026-10-05",
        category: "finding_triage",
      },
    ],
  },
};

function subject(rpc: jest.Mock): SupabaseNotificationBurstQueueAdapter {
  return new SupabaseNotificationBurstQueueAdapter({
    admin: () => ({ rpc }),
  } as never);
}

describe("SupabaseNotificationBurstQueueAdapter", () => {
  it("reconciles ambiguous leases through the existing shared batch RPC", async () => {
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

  it("pages tenant-fair due organizations and schedules bounded batches", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ organization_id: organizationId }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "scheduled",
            created: 2,
            reclassified: 1,
            released: 1,
          },
        ],
        error: null,
      });
    const queue = subject(rpc);
    await expect(queue.dueOrganizations(null)).resolves.toEqual({
      organizationIds: [organizationId],
      nextOrganizationId: null,
    });
    await expect(queue.schedule(organizationId)).resolves.toEqual({
      outcome: "scheduled",
      created: 2,
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "list_due_notification_burst_organizations_atomic",
      { p_after_organization_id: null, p_limit: 100 },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "schedule_notification_burst_batches_atomic",
      { p_organization_id: organizationId, p_limit: 1000 },
    );
  });

  it("claims a fenced burst and parses a truncated preview with exact count and link", async () => {
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
        data: [{ outcome: "ready", delivery }],
        error: null,
      });
    const queue = subject(rpc);
    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).resolves.toEqual({
      outcome: "claimed",
      batchId,
      leaseOwner: workerId,
      checkpointVersion: 2,
    });
    await expect(queue.prepare(fence)).resolves.toMatchObject({
      outcome: "ready",
      payload: { count: 7, items: [expect.any(Object)] },
    });
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "prepare_notification_burst_batch_atomic",
      {
        p_organization_id: organizationId,
        p_batch_id: batchId,
        p_worker_id: workerId,
        p_expected_version: 2,
      },
    );
  });

  it("revalidates all details against the same fenced batch immediately before SMTP", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "ready", delivery }],
      error: null,
    });
    await expect(subject(rpc).revalidate(fence)).resolves.toMatchObject({
      outcome: "ready",
      payload: { count: 7, href: delivery.payload.href },
    });
    expect(rpc).toHaveBeenCalledWith(
      "revalidate_notification_burst_batch_atomic",
      {
        p_organization_id: organizationId,
        p_batch_id: batchId,
        p_worker_id: workerId,
        p_expected_version: 2,
      },
    );
  });

  it.each([
    { deliveryRef: organizationId },
    { idempotencyKey: `notification-burst:${organizationId}` },
    { payload: { ...delivery.payload, href: "//evil.test" } },
    { payload: { ...delivery.payload, count: 0 } },
    { payload: { ...delivery.payload, count: 1 } },
    {
      payload: {
        ...delivery.payload,
        items: Array.from({ length: 6 }, () => delivery.payload.items[0]),
      },
    },
  ])("rejects malformed or substituted burst delivery %#", async (change) => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "ready", delivery: { ...delivery, ...change } }],
      error: null,
    });
    await expect(subject(rpc).prepare(fence)).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("commits acceptance and sanitizes failed provider codes", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ outcome: "completed" }], error: null })
      .mockResolvedValueOnce({
        data: [{ outcome: "retry_scheduled" }],
        error: null,
      });
    const queue = subject(rpc);
    await expect(
      queue.complete({ ...fence, messageIdHash: "a".repeat(64) }),
    ).resolves.toEqual({ outcome: "completed" });
    await expect(
      queue.fail({ ...fence, code: "secret provider error", retryable: true }),
    ).resolves.toEqual({ outcome: "retry_scheduled" });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "complete_notification_burst_batch_atomic",
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
      "fail_notification_burst_batch_atomic",
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

  it("rejects invalid pagination, duplicate tenants, and provider outages", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        { organization_id: organizationId },
        { organization_id: organizationId },
      ],
      error: null,
    });
    await expect(subject(rpc).dueOrganizations("bad")).rejects.toMatchObject({
      code: "malformed_provider",
    });
    expect(rpc).not.toHaveBeenCalled();
    await expect(subject(rpc).dueOrganizations(null)).rejects.toMatchObject({
      code: "malformed_provider",
    });
    await expect(
      subject(
        jest.fn().mockRejectedValue(new Error("private db error")),
      ).prepare(fence),
    ).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it.each(["none_available", "conflict"])(
    "preserves the %s claim outcome",
    async (outcome) => {
      const rpc = jest.fn().mockResolvedValue({
        data: [{ outcome }],
        error: null,
      });
      await expect(
        subject(rpc).claim({ organizationId, workerId, leaseSeconds: 120 }),
      ).resolves.toEqual({ outcome });
    },
  );

  it.each(["cancelled", "deferred", "conflict", "not_found"])(
    "preserves the %s revalidation outcome",
    async (outcome) => {
      const rpc = jest.fn().mockResolvedValue({
        data: [{ outcome, delivery: null }],
        error: null,
      });
      await expect(subject(rpc).revalidate(fence)).resolves.toEqual({
        outcome,
      });
    },
  );

  it.each(["replayed", "conflict", "not_found"])(
    "maps completion outcome %s safely",
    async (outcome) => {
      const rpc = jest.fn().mockResolvedValue({
        data: [{ outcome }],
        error: null,
      });
      await expect(
        subject(rpc).complete({ ...fence, messageIdHash: null }),
      ).resolves.toEqual({
        outcome: outcome === "replayed" ? "completed" : "conflict",
      });
    },
  );

  it.each(["retry_scheduled", "exhausted", "conflict"])(
    "preserves failure outcome %s",
    async (outcome) => {
      const rpc = jest.fn().mockResolvedValue({
        data: [{ outcome }],
        error: null,
      });
      await expect(
        subject(rpc).fail({
          ...fence,
          code: "delivery_failed",
          retryable: false,
        }),
      ).resolves.toEqual({ outcome });
    },
  );

  it("rejects malformed reconciliation, schedule, claims, and completion", async () => {
    const malformed = subject(
      jest
        .fn()
        .mockResolvedValue({ data: [{ outcome: "unknown" }], error: null }),
    );
    await expect(malformed.reconcileAmbiguousLeases()).rejects.toMatchObject({
      code: "malformed_provider",
    });
    await expect(malformed.schedule(organizationId)).rejects.toMatchObject({
      code: "malformed_provider",
    });
    await expect(
      malformed.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      malformed.complete({ ...fence, messageIdHash: null }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      malformed.fail({ ...fence, code: "delivery_failed", retryable: true }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(malformed.prepare(fence)).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("rejects invalid claim fencing and raw message identity before SQL", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "claimed",
          batch: { batchId, leaseOwner: recipientId, checkpointVersion: 2 },
        },
      ],
      error: null,
    });
    const queue = subject(rpc);
    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 15 }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      queue.complete({ ...fence, messageIdHash: "raw-id" }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    expect(rpc).not.toHaveBeenCalled();
    await expect(
      queue.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
  });

  it("rejects malformed RPC row cardinality", async () => {
    const queue = subject(
      jest.fn().mockResolvedValue({ data: [null], error: null }),
    );
    await expect(queue.reconcileAmbiguousLeases()).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });
});
