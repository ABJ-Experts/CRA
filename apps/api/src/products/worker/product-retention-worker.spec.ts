import {
  ProductRetentionWorker,
  type ProductRetentionWorkerDependencies,
} from "./product-retention-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const releaseId = "33333333-3333-4333-8333-333333333333";
const deliveryId = "44444444-4444-4444-8444-444444444444";
const workerId = "55555555-5555-4555-8555-555555555555";
const productOwnerId = "66666666-6666-4666-8666-666666666666";
const organizationAdminId = "77777777-7777-4777-8777-777777777777";
const supportPeriodId = "88888888-8888-4888-8888-888888888888";
const databaseNow = new Date("2026-08-13T10:00:00.000Z");

describe("ProductRetentionWorker", () => {
  it("delivers a claimed support-period alert to its active product owner and completes it with database time", async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });
    const worker = new ProductRetentionWorker(
      dependencies({ delivery: { deliver }, queue: { complete } }),
    );

    await worker.runOnce();

    expect(deliver).toHaveBeenCalledWith({
      idempotencyKey: "support-period:8:30",
      recipient: {
        userId: productOwnerId,
        email: "product-owner@cra.test",
      },
      event: {
        organizationId,
        productId,
        productName: "Retention test product",
        releaseId,
        eventType: "support_period.alert",
        eventKey: "support-period:8:30",
        supportPeriodId,
        supportPeriodRevision: 8,
        thresholdDays: 30,
        supportEndsAt: "2026-09-12T10:00:00.000Z",
        dueAt: "2026-08-13T10:00:00.000Z",
        deliveryState: "current",
      },
    });
    expect(complete).toHaveBeenCalledWith({
      organizationId,
      deliveryId,
      leaseOwner: workerId,
      checkpointVersion: 0,
      recipientId: productOwnerId,
      databaseNow,
    });
  });

  it("claims a duplicated due organization only once in a cycle", async () => {
    const claim = jest.fn().mockResolvedValue({ outcome: "none_available" });
    const worker = new ProductRetentionWorker(
      dependencies({
        queue: {
          dueOrganizationIds: jest
            .fn()
            .mockResolvedValue([organizationId, organizationId]),
          claim,
        },
      }),
    );

    await worker.runOnce();

    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("drains every due alert for an organization in the same 30-second cycle", async () => {
    const first = claimedEvent();
    const second = {
      ...claimedEvent(),
      deliveryId: "99999999-9999-4999-8999-999999999999",
      event: {
        ...claimedEvent().event,
        eventKey: "support-period:8:90",
        thresholdDays: 90,
      },
    };
    const claim = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValue({ outcome: "none_available" });
    const deliver = jest.fn().mockResolvedValue(undefined);
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });
    const worker = new ProductRetentionWorker(
      dependencies({ queue: { claim, complete }, delivery: { deliver } }),
    );

    await worker.runOnce();

    expect(claim).toHaveBeenCalledTimes(3);
    expect(deliver).toHaveBeenCalledTimes(2);
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("never treats a generic regulatory event as a notification email", async () => {
    const deliver = jest.fn();
    const fail = jest.fn().mockResolvedValue(undefined);
    const worker = new ProductRetentionWorker(
      dependencies({
        queue: {
          claim: claimThenNone({
            ...claimedEvent(),
            event: {
              ...claimedEvent().event,
              eventType:
                "release.lifecycle_changed" as unknown as "support_period.alert",
            },
          }),
          fail,
        },
        delivery: { deliver },
      }),
    );

    await worker.runOnce();

    expect(deliver).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "unexpected_alert_event",
        retryable: false,
      }),
    );
  });

  it("reuses the event key after a restart so delivery providers can deduplicate a lease-expired retry", async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const complete = jest
      .fn()
      .mockRejectedValueOnce(new Error("database completion interrupted"))
      .mockResolvedValueOnce({ outcome: "completed" });
    const fail = jest.fn().mockResolvedValue(undefined);
    const claim = jest
      .fn()
      .mockResolvedValueOnce(claimedEvent())
      .mockResolvedValueOnce({ outcome: "none_available" })
      .mockResolvedValueOnce(claimedEvent())
      .mockResolvedValue({ outcome: "none_available" });
    const dependenciesForRestart = dependencies({
      delivery: { deliver },
      queue: { claim, complete, fail },
    });

    await new ProductRetentionWorker(dependenciesForRestart).runOnce();
    await new ProductRetentionWorker(dependenciesForRestart).runOnce();

    expect(deliver).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        idempotencyKey: "support-period:8:30",
      }),
    );
    expect(deliver).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        idempotencyKey: "support-period:8:30",
      }),
    );
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "provider_unavailable",
        retryable: true,
        nextDeliveryState: "missed_catch_up",
      }),
    );
    expect(complete).toHaveBeenCalledTimes(2);
  });

  it("records a provider delivery failure durably instead of completing the event", async () => {
    const complete = jest.fn();
    const fail = jest.fn().mockResolvedValue(undefined);
    const worker = new ProductRetentionWorker(
      dependencies({
        delivery: {
          deliver: jest.fn().mockRejectedValue(new Error("SMTP unavailable")),
        },
        queue: { complete, fail },
      }),
    );

    await worker.runOnce();

    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith({
      organizationId,
      deliveryId,
      leaseOwner: workerId,
      checkpointVersion: 0,
      code: "provider_unavailable",
      retryable: true,
      nextDeliveryState: "missed_catch_up",
      databaseNow,
    });
  });

  it("keeps an event retryable as missed catch-up work when no active recipient exists", async () => {
    const deliver = jest.fn();
    const complete = jest.fn();
    const fail = jest.fn().mockResolvedValue(undefined);
    const worker = new ProductRetentionWorker(
      dependencies({
        recipients: {
          productOwner: jest.fn().mockResolvedValue(null),
          organizationOwnerOrAdmin: jest.fn().mockResolvedValue(null),
        },
        delivery: { deliver },
        queue: { complete, fail },
      }),
    );

    await worker.runOnce();

    expect(deliver).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "recipient_unavailable",
        retryable: true,
        nextDeliveryState: "missed_catch_up",
      }),
    );
  });

  it("falls back to an active organization owner or admin and retains missed catch-up state in the delivery", async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);
    const productOwner = jest.fn().mockResolvedValue(null);
    const organizationOwnerOrAdmin = jest.fn().mockResolvedValue({
      userId: organizationAdminId,
      email: "organization-admin@cra.test",
    });
    const worker = new ProductRetentionWorker(
      dependencies({
        recipients: { productOwner, organizationOwnerOrAdmin },
        delivery: { deliver },
        queue: {
          claim: claimThenNone(
            claimedEvent({ deliveryState: "missed_catch_up" }),
          ),
        },
      }),
    );

    await worker.runOnce();

    expect(productOwner).toHaveBeenCalledWith({ organizationId, productId });
    expect(organizationOwnerOrAdmin).toHaveBeenCalledWith({ organizationId });
    expect(deliver).toHaveBeenCalledWith({
      idempotencyKey: "support-period:8:30",
      recipient: {
        userId: organizationAdminId,
        email: "organization-admin@cra.test",
      },
      event: {
        organizationId,
        productId,
        productName: "Retention test product",
        releaseId,
        eventType: "support_period.alert",
        eventKey: "support-period:8:30",
        supportPeriodId,
        supportPeriodRevision: 8,
        thresholdDays: 30,
        supportEndsAt: "2026-09-12T10:00:00.000Z",
        dueAt: "2026-08-13T10:00:00.000Z",
        deliveryState: "missed_catch_up",
      },
    });
  });

  it("persists clock skew observation without delaying a database-due alert", async () => {
    const dueOrganizationIds = jest.fn().mockResolvedValue([organizationId]);
    const claim = jest.fn().mockResolvedValue({ outcome: "none_available" });
    const observeSkew = jest.fn().mockResolvedValue(undefined);
    const worker = new ProductRetentionWorker(
      dependencies({
        maximumClockSkewMilliseconds: 1_000,
        clock: {
          databaseNow: jest.fn().mockResolvedValue(databaseNow),
          localNow: jest.fn(() => new Date("2026-08-13T10:00:02.000Z")),
          observeSkew,
        },
        queue: { dueOrganizationIds, claim },
      }),
    );

    await worker.runOnce();

    expect(observeSkew).toHaveBeenCalledWith({
      databaseNow,
      localNow: new Date("2026-08-13T10:00:02.000Z"),
      skewMilliseconds: 2_000,
    });
    expect(dueOrganizationIds).toHaveBeenCalledWith(databaseNow);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("does not delay a database-due alert when skew telemetry cannot persist", async () => {
    const dueOrganizationIds = jest.fn().mockResolvedValue([organizationId]);
    const claim = jest.fn().mockResolvedValue({ outcome: "none_available" });
    const worker = new ProductRetentionWorker(
      dependencies({
        maximumClockSkewMilliseconds: 1_000,
        clock: {
          localNow: jest.fn(() => new Date("2026-08-13T10:00:02.000Z")),
          observeSkew: jest
            .fn()
            .mockRejectedValue(new Error("metrics database unavailable")),
        },
        queue: { dueOrganizationIds, claim },
      }),
    );

    await worker.runOnce();

    expect(dueOrganizationIds).toHaveBeenCalledWith(databaseNow);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("treats an already-completed or conflicted lease as a harmless duplicate", async () => {
    const fail = jest.fn();
    const worker = new ProductRetentionWorker(
      dependencies({
        queue: {
          complete: jest.fn().mockResolvedValue({ outcome: "conflict" }),
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(fail).not.toHaveBeenCalled();
  });

  it("dead-letters unexpected completion outcomes with the durable lease", async () => {
    const fail = jest.fn().mockResolvedValue(undefined);
    const worker = new ProductRetentionWorker(
      dependencies({
        queue: {
          complete: jest.fn().mockResolvedValue({ outcome: "invalid_state" }),
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "completion_rejected",
        retryable: false,
      }),
    );
  });

  it("rejects an unsafe worker composition", () => {
    expect(
      () => new ProductRetentionWorker(dependencies({ leaseSeconds: 0 })),
    ).toThrow("invalid product retention worker lease");
    expect(
      () =>
        new ProductRetentionWorker(
          dependencies({ maximumClockSkewMilliseconds: -1 }),
        ),
    ).toThrow("invalid product retention worker clock skew");
  });
});

type WorkerDependencyOverrides = Omit<
  Partial<ProductRetentionWorkerDependencies>,
  "clock" | "delivery" | "queue" | "recipients"
> & {
  clock?: Partial<ProductRetentionWorkerDependencies["clock"]>;
  delivery?: Partial<ProductRetentionWorkerDependencies["delivery"]>;
  queue?: Partial<ProductRetentionWorkerDependencies["queue"]>;
  recipients?: Partial<ProductRetentionWorkerDependencies["recipients"]>;
};

function dependencies(
  overrides: WorkerDependencyOverrides = {},
): ProductRetentionWorkerDependencies {
  const {
    clock: clockOverride,
    delivery: deliveryOverride,
    queue: queueOverride,
    recipients: recipientsOverride,
    ...otherOverrides
  } = overrides;
  return {
    workerId,
    leaseSeconds: 60,
    maximumClockSkewMilliseconds: 5_000,
    clock: {
      databaseNow: jest.fn().mockResolvedValue(databaseNow),
      localNow: jest.fn(() => new Date(databaseNow)),
      observeSkew: jest.fn().mockResolvedValue(undefined),
      ...clockOverride,
    },
    queue: {
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
      claim: claimThenNone(claimedEvent()),
      complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
      fail: jest.fn().mockResolvedValue(undefined),
      ...queueOverride,
    },
    recipients: {
      productOwner: jest.fn().mockResolvedValue({
        userId: productOwnerId,
        email: "product-owner@cra.test",
      }),
      organizationOwnerOrAdmin: jest.fn().mockResolvedValue({
        userId: organizationAdminId,
        email: "organization-admin@cra.test",
      }),
      ...recipientsOverride,
    },
    delivery: {
      deliver: jest.fn().mockResolvedValue(undefined),
      ...deliveryOverride,
    },
    ...otherOverrides,
  } satisfies ProductRetentionWorkerDependencies;
}

function claimThenNone(claim: ReturnType<typeof claimedEvent>): jest.Mock {
  return jest
    .fn()
    .mockResolvedValueOnce(claim)
    .mockResolvedValue({ outcome: "none_available" });
}

function claimedEvent(
  input: Readonly<{ deliveryState?: "current" | "missed_catch_up" }> = {},
) {
  return {
    outcome: "claimed" as const,
    deliveryId,
    leaseOwner: workerId,
    checkpointVersion: 0,
    event: {
      organizationId,
      productId,
      productName: "Retention test product",
      releaseId,
      eventType: "support_period.alert" as const,
      eventKey: "support-period:8:30",
      supportPeriodId,
      supportPeriodRevision: 8,
      thresholdDays: 30,
      supportEndsAt: "2026-09-12T10:00:00.000Z",
      dueAt: "2026-08-13T10:00:00.000Z",
      deliveryState: input.deliveryState ?? "current",
    },
  };
}
