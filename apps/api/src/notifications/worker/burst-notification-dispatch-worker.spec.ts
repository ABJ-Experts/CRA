import {
  BurstNotificationDispatchWorker,
  type BurstNotificationDispatchWorkerDependencies,
} from "./burst-notification-dispatch-worker";
import { NotificationDispatchFailure } from "./notification-dispatch-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const batchId = "44444444-4444-4444-8444-444444444444";
const recipientId = "55555555-5555-4555-8555-555555555555";
const claimed = {
  outcome: "claimed" as const,
  batchId,
  leaseOwner: workerId,
  checkpointVersion: 2,
};
const payload = {
  kind: "burst" as const,
  count: 2,
  href: `/notifications?batchId=${batchId}`,
  items: [
    {
      title: "Evidence update",
      href: "/evidence",
      date: "2026-10-05",
      category: "evidence",
    },
    {
      title: "Second update",
      href: "/evidence",
      date: "2026-10-05",
      category: "evidence",
    },
  ],
};

type Overrides = Omit<
  Partial<BurstNotificationDispatchWorkerDependencies>,
  "queue" | "delivery"
> & {
  queue?: Partial<BurstNotificationDispatchWorkerDependencies["queue"]>;
  delivery?: Partial<BurstNotificationDispatchWorkerDependencies["delivery"]>;
};

function dependencies(
  overrides: Overrides = {},
): BurstNotificationDispatchWorkerDependencies {
  const {
    queue: queueOverrides,
    delivery: deliveryOverrides,
    ...rest
  } = overrides;
  let claims = 0;
  return {
    workerId,
    leaseSeconds: 120,
    queue: {
      reconcileAmbiguousLeases: jest.fn().mockResolvedValue({
        outcome: "reconciled",
        dispatches: 0,
        digests: 0,
      }),
      dueOrganizations: jest.fn().mockResolvedValue({
        organizationIds: [organizationId],
        nextOrganizationId: null,
      }),
      schedule: jest.fn().mockResolvedValue({
        outcome: "scheduled",
        created: 1,
      }),
      claim: jest
        .fn()
        .mockImplementation(() =>
          Promise.resolve(
            claims++ === 0 ? claimed : { outcome: "none_available" },
          ),
        ),
      prepare: jest.fn().mockResolvedValue({
        outcome: "ready",
        recipient: { userId: recipientId, email: "owner@cra.test" },
        idempotencyKey: `notification-burst:${batchId}`,
        payload,
      }),
      revalidate: jest.fn().mockResolvedValue({
        outcome: "ready",
        recipient: { userId: recipientId, email: "owner@cra.test" },
        idempotencyKey: `notification-burst:${batchId}`,
        payload,
      }),
      complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
      fail: jest.fn().mockResolvedValue({ outcome: "retry_scheduled" }),
      ...queueOverrides,
    },
    delivery: {
      send: jest.fn().mockResolvedValue({
        status: "provider_accepted",
        messageIdHash: null,
      }),
      ...deliveryOverrides,
    },
    ...rest,
  };
}

describe("BurstNotificationDispatchWorker", () => {
  it.each([
    { workerId: "invalid" },
    { leaseSeconds: 29 },
    { leaseSeconds: 901 },
  ])("rejects unsafe worker configuration", (override) => {
    expect(
      () => new BurstNotificationDispatchWorker(dependencies(override)),
    ).toThrow("invalid notification burst worker configuration");
  });

  it("reconciles uncertain leases and schedules before any claim", async () => {
    const order: string[] = [];
    const worker = new BurstNotificationDispatchWorker(
      dependencies({
        queue: {
          reconcileAmbiguousLeases: jest.fn().mockImplementation(() => {
            order.push("reconcile");
            return Promise.resolve({
              outcome: "reconciled",
              dispatches: 0,
              digests: 0,
            });
          }),
          schedule: jest.fn().mockImplementation(() => {
            order.push("schedule");
            return Promise.resolve({ outcome: "scheduled", created: 1 });
          }),
          claim: jest.fn().mockImplementation(() => {
            order.push("claim");
            return Promise.resolve({ outcome: "none_available" });
          }),
        },
      }),
    );

    await worker.runOnce();
    expect(order).toEqual(["reconcile", "schedule", "claim"]);
  });

  it("sends a prepared burst and fences provider acceptance", async () => {
    const send = jest.fn().mockResolvedValue({
      status: "provider_accepted",
      messageIdHash: "a".repeat(64),
    });
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });

    await new BurstNotificationDispatchWorker(
      dependencies({ delivery: { send }, queue: { complete } }),
    ).runOnce();

    expect(send).toHaveBeenCalledWith({
      organizationId,
      batchId,
      recipient: { userId: recipientId, email: "owner@cra.test" },
      idempotencyKey: `notification-burst:${batchId}`,
      payload,
    });
    expect(complete).toHaveBeenCalledWith({
      organizationId,
      batchId,
      leaseOwner: workerId,
      checkpointVersion: 2,
      messageIdHash: "a".repeat(64),
    });
  });

  it.each(["cancelled", "deferred", "conflict", "not_found"] as const)(
    "does not send a %s preparation",
    async (outcome) => {
      const send = jest.fn();
      await new BurstNotificationDispatchWorker(
        dependencies({
          queue: { prepare: jest.fn().mockResolvedValue({ outcome }) },
          delivery: { send },
        }),
      ).runOnce();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("sends only the fresh revalidated payload, never stale prepared content", async () => {
    const send = jest.fn().mockResolvedValue({
      status: "provider_accepted",
      messageIdHash: null,
    });
    const freshPayload = {
      ...payload,
      count: 3,
      items: payload.items.slice(0, 1),
    };
    await new BurstNotificationDispatchWorker(
      dependencies({
        queue: {
          revalidate: jest.fn().mockResolvedValue({
            outcome: "ready",
            recipient: { userId: recipientId, email: "owner@cra.test" },
            idempotencyKey: `notification-burst:${batchId}`,
            payload: freshPayload,
          }),
        },
        delivery: { send },
      }),
    ).runOnce();
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ payload: freshPayload }),
    );
  });

  it("does not send when access is revoked just before SMTP", async () => {
    const send = jest.fn();
    await new BurstNotificationDispatchWorker(
      dependencies({
        queue: {
          revalidate: jest.fn().mockResolvedValue({ outcome: "cancelled" }),
        },
        delivery: { send },
      }),
    ).runOnce();
    expect(send).not.toHaveBeenCalled();
  });

  it("retries revalidation outages without sending or leaking provider errors", async () => {
    const send = jest.fn();
    const fail = jest.fn().mockResolvedValue({ outcome: "retry_scheduled" });
    await new BurstNotificationDispatchWorker(
      dependencies({
        queue: {
          revalidate: jest.fn().mockRejectedValue(new Error("secret")),
          fail,
        },
        delivery: { send },
      }),
    ).runOnce();
    expect(send).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "provider_unavailable",
        retryable: true,
      }),
    );
  });

  it("continues a second tenant after provider throttling", async () => {
    const fail = jest.fn().mockResolvedValue({ outcome: "retry_scheduled" });
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error("private provider response"))
      .mockResolvedValueOnce({
        status: "provider_accepted",
        messageIdHash: null,
      });
    const claim = jest
      .fn()
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce({ outcome: "none_available" })
      .mockResolvedValueOnce({ ...claimed, batchId: otherOrganizationId })
      .mockResolvedValue({ outcome: "none_available" });
    await new BurstNotificationDispatchWorker(
      dependencies({
        queue: {
          dueOrganizations: jest
            .fn()
            .mockResolvedValueOnce({
              organizationIds: [organizationId],
              nextOrganizationId: organizationId,
            })
            .mockResolvedValueOnce({
              organizationIds: [otherOrganizationId],
              nextOrganizationId: null,
            }),
          claim,
          fail,
        },
        delivery: { send },
      }),
    ).runOnce();
    expect(send).toHaveBeenCalledTimes(2);
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        batchId,
        code: "provider_unavailable",
        retryable: true,
      }),
    );
    expect(JSON.stringify(fail.mock.calls)).not.toContain(
      "private provider response",
    );
  });

  it("caps one tenant's claims before serving the next tenant", async () => {
    const organizations: string[] = [];
    const claim = jest
      .fn()
      .mockImplementation(({ organizationId }: { organizationId: string }) => {
        organizations.push(organizationId);
        return Promise.resolve(claimed);
      });
    await new BurstNotificationDispatchWorker(
      dependencies({
        queue: {
          dueOrganizations: jest.fn().mockResolvedValue({
            organizationIds: [organizationId, otherOrganizationId],
            nextOrganizationId: null,
          }),
          claim,
        },
      }),
    ).runOnce();
    expect(organizations).toEqual([
      ...Array.from({ length: 10 }, () => organizationId),
      ...Array.from({ length: 10 }, () => otherOrganizationId),
    ]);
  });

  it("never retries a batch after provider acceptance completion is uncertain", async () => {
    const fail = jest.fn();
    for (const complete of [
      jest.fn().mockRejectedValue(new Error("outage")),
      jest.fn().mockResolvedValue({ outcome: "conflict" }),
    ]) {
      await new BurstNotificationDispatchWorker(
        dependencies({ queue: { complete, fail } }),
      ).runOnce();
    }
    expect(fail).not.toHaveBeenCalled();
  });

  it("leaves an in-flight SMTP timeout leased for ambiguous reconciliation", async () => {
    const fail = jest.fn();
    const complete = jest.fn();
    await new BurstNotificationDispatchWorker(
      dependencies({
        queue: { fail, complete },
        delivery: {
          send: jest
            .fn()
            .mockRejectedValue(
              new NotificationDispatchFailure("delivery_uncertain", false),
            ),
        },
      }),
    ).runOnce();
    expect(fail).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("rejects malformed leases before delivery", async () => {
    const send = jest.fn();
    const worker = new BurstNotificationDispatchWorker(
      dependencies({
        queue: {
          claim: jest.fn().mockResolvedValue({
            ...claimed,
            leaseOwner: recipientId,
          }),
        },
        delivery: { send },
      }),
    );
    await expect(worker.runOnce()).rejects.toMatchObject({
      code: "malformed_provider",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects malformed provider acceptance instead of marking delivery", async () => {
    const complete = jest.fn();
    const fail = jest.fn().mockResolvedValue({ outcome: "exhausted" });
    await new BurstNotificationDispatchWorker(
      dependencies({
        queue: { complete, fail },
        delivery: {
          send: jest.fn().mockResolvedValue({
            status: "provider_accepted",
            messageIdHash: "raw-message-id",
          }),
        },
      }),
    ).runOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "malformed_provider", retryable: false }),
    );
  });

  it("skips disabled organizations and isolates scheduling outages", async () => {
    const claim = jest.fn();
    for (const schedule of [
      jest.fn().mockResolvedValue({ outcome: "disabled", created: 0 }),
      jest.fn().mockRejectedValue(new Error("private database error")),
    ]) {
      await new BurstNotificationDispatchWorker(
        dependencies({ queue: { schedule, claim } }),
      ).runOnce();
    }
    expect(claim).not.toHaveBeenCalled();
  });
});
