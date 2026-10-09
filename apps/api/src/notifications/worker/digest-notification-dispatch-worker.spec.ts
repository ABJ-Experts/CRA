import {
  DigestNotificationDispatchWorker,
  type DigestNotificationDispatchWorkerDependencies,
} from "./digest-notification-dispatch-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const secondOrganizationId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const batchId = "44444444-4444-4444-8444-444444444444";
const recipientId = "55555555-5555-4555-8555-555555555555";
const claimed = {
  outcome: "claimed" as const,
  batchId,
  leaseOwner: workerId,
  checkpointVersion: 2,
};

const digestPayload = {
  kind: "digest" as const,
  items: [
    {
      title: "Evidence expiring",
      href: "/products/11111111-1111-4111-8111-111111111111/evidence",
      date: "2026-11-01",
      category: "evidence",
    },
  ],
};

describe("DigestNotificationDispatchWorker", () => {
  it.each([
    { workerId: "invalid" },
    { leaseSeconds: 29 },
    { leaseSeconds: 901 },
  ])("rejects unsafe worker configuration", (override) => {
    expect(
      () => new DigestNotificationDispatchWorker(dependencies(override)),
    ).toThrow("invalid notification digest worker configuration");
  });

  it("reconciles ambiguous leases and schedules before claiming digest batches", async () => {
    const order: string[] = [];
    const worker = new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          reconcileAmbiguousLeases: jest.fn().mockImplementation(() => {
            order.push("reconcile");
            return Promise.resolve({
              outcome: "reconciled",
              dispatches: 1,
              digests: 1,
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

  it("sends a prepared digest and records provider acceptance", async () => {
    const send = jest.fn().mockResolvedValue({
      status: "provider_accepted",
      messageIdHash: "a".repeat(64),
    });
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });
    const worker = new DigestNotificationDispatchWorker(
      dependencies({ delivery: { send }, queue: { complete } }),
    );

    await worker.runOnce();

    expect(send).toHaveBeenCalledWith({
      organizationId,
      batchId,
      recipient: { userId: recipientId, email: "owner@cra.test" },
      idempotencyKey: `notification-digest:${batchId}`,
      payload: digestPayload,
    });
    expect(complete).toHaveBeenCalledWith({
      organizationId,
      batchId,
      leaseOwner: workerId,
      checkpointVersion: 2,
      messageIdHash: "a".repeat(64),
    });
  });

  it("does not send cancelled batches", async () => {
    const send = jest.fn();
    const complete = jest.fn();
    const worker = new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          prepare: jest.fn().mockResolvedValue({ outcome: "cancelled" }),
          complete,
        },
        delivery: { send },
      }),
    );

    await worker.runOnce();

    expect(send).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("does not send quiet-hour deferred batches", async () => {
    const send = jest.fn();
    const complete = jest.fn();
    await new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          prepare: jest.fn().mockResolvedValue({ outcome: "deferred" }),
          complete,
        },
        delivery: { send },
      }),
    ).runOnce();
    expect(send).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
  });

  it("records a safe retry after provider outage and continues tenants", async () => {
    const claim = jest
      .fn()
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce({ outcome: "none_available" })
      .mockResolvedValueOnce({ ...claimed, batchId: secondOrganizationId })
      .mockResolvedValue({ outcome: "none_available" });
    const fail = jest.fn().mockResolvedValue({ outcome: "retry_scheduled" });
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error("secret provider output"))
      .mockResolvedValueOnce({
        status: "provider_accepted",
        messageIdHash: null,
      });
    const worker = new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          dueOrganizations: jest
            .fn()
            .mockResolvedValueOnce({
              organizationIds: [organizationId],
              nextOrganizationId: organizationId,
            })
            .mockResolvedValueOnce({
              organizationIds: [secondOrganizationId],
              nextOrganizationId: null,
            }),
          claim,
          fail,
        },
        delivery: { send },
      }),
    );

    await worker.runOnce();

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
      "secret provider output",
    );
  });

  it("rejects malformed tenant cursors and claims before any send", async () => {
    const invalidPage = new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          dueOrganizations: jest.fn().mockResolvedValue({
            organizationIds: [organizationId],
            nextOrganizationId: "bad",
          }),
        },
      }),
    );
    await expect(invalidPage.runOnce()).rejects.toMatchObject({
      code: "malformed_provider",
    });
    const send = jest.fn();
    const invalidClaim = new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          claim: jest
            .fn()
            .mockResolvedValue({ ...claimed, leaseOwner: recipientId }),
        },
        delivery: { send },
      }),
    );
    await expect(invalidClaim.runOnce()).rejects.toMatchObject({
      code: "malformed_provider",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("skips legacy and unavailable schedules without claiming", async () => {
    const claim = jest.fn();
    await new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          schedule: jest
            .fn()
            .mockResolvedValue({ outcome: "legacy", created: 0 }),
          claim,
        },
      }),
    ).runOnce();
    await new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          schedule: jest.fn().mockRejectedValue(new Error("secret")),
          claim,
        },
      }),
    ).runOnce();
    expect(claim).not.toHaveBeenCalled();
  });

  it("retries a preparation outage without sending", async () => {
    const send = jest.fn();
    const fail = jest.fn().mockResolvedValue({ outcome: "retry_scheduled" });
    await new DigestNotificationDispatchWorker(
      dependencies({
        queue: {
          prepare: jest.fn().mockRejectedValue(new Error("secret")),
          fail,
        },
        delivery: { send },
      }),
    ).runOnce();
    expect(send).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "provider_unavailable" }),
    );
  });

  it("does not complete a malformed provider receipt", async () => {
    const complete = jest.fn();
    const fail = jest.fn().mockResolvedValue({ outcome: "exhausted" });
    await new DigestNotificationDispatchWorker(
      dependencies({
        queue: { complete, fail },
        delivery: {
          send: jest.fn().mockResolvedValue({
            status: "provider_accepted",
            messageIdHash: "raw-id",
          }),
        },
      }),
    ).runOnce();
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "malformed_provider", retryable: false }),
    );
  });

  it("leaves an accepted batch leased when completion is ambiguous", async () => {
    const fail = jest.fn();
    for (const complete of [
      jest.fn().mockRejectedValue(new Error("secret")),
      jest.fn().mockResolvedValue({ outcome: "conflict" }),
    ]) {
      await new DigestNotificationDispatchWorker(
        dependencies({ queue: { complete, fail } }),
      ).runOnce();
    }
    expect(fail).not.toHaveBeenCalled();
  });
});

type Overrides = Omit<
  Partial<DigestNotificationDispatchWorkerDependencies>,
  "queue" | "delivery"
> & {
  queue?: Partial<DigestNotificationDispatchWorkerDependencies["queue"]>;
  delivery?: Partial<DigestNotificationDispatchWorkerDependencies["delivery"]>;
};

function dependencies(
  overrides: Overrides = {},
): DigestNotificationDispatchWorkerDependencies {
  const {
    queue: queueOverride,
    delivery: deliveryOverride,
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
      schedule: jest
        .fn()
        .mockResolvedValue({ outcome: "scheduled", created: 0 }),
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
        idempotencyKey: `notification-digest:${batchId}`,
        payload: digestPayload,
      }),
      complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
      fail: jest.fn().mockResolvedValue({ outcome: "retry_scheduled" }),
      ...queueOverride,
    },
    delivery: {
      send: jest.fn().mockResolvedValue({
        status: "provider_accepted",
        messageIdHash: null,
      }),
      ...deliveryOverride,
    },
    ...rest,
  };
}
