import {
  ReportingDeadlineMonitorWorker,
  type ReportingDeadlineMonitorDependencies,
} from "./reporting-deadline-monitor-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const obligationId = "22222222-2222-4222-8222-222222222222";
const deliveryId = "44444444-4444-4444-8444-444444444444";
const workerId = "55555555-5555-4555-8555-555555555555";
const recipientId = "66666666-6666-4666-8666-666666666666";
const databaseNow = new Date("2026-09-09T10:00:00.000Z");

describe("ReportingDeadlineMonitorWorker", () => {
  it("reconciles database-authoritative thresholds before delivering a claimed alert", async () => {
    const reconcile = jest.fn().mockResolvedValue(undefined);
    const deliver = jest.fn().mockResolvedValue(undefined);
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });
    const worker = new ReportingDeadlineMonitorWorker(
      dependencies({ queue: { reconcile, complete }, delivery: { deliver } }),
    );

    await worker.runOnce();

    expect(reconcile).toHaveBeenCalledWith(databaseNow);
    expect(deliver).toHaveBeenCalledWith({
      idempotencyKey: "reporting:stage:revision-1:50:recipient",
      recipient: { userId: recipientId, email: "owner@cra.test" },
      alert: {
        obligationId,
        stageKind: "early_warning",
        thresholdPercent: 50,
        dueAt: "2026-09-10T10:00:00Z",
        idempotencyKey: "reporting:stage:revision-1:50:recipient",
      },
    });
    expect(complete).toHaveBeenCalledWith({
      organizationId,
      deliveryId,
      leaseOwner: workerId,
      checkpointVersion: 0,
      databaseNow,
    });
  });

  it("deduplicates due organizations and drains catch-up deliveries in one cycle", async () => {
    const first = claimed();
    const second = {
      ...claimed(),
      deliveryId: "77777777-7777-4777-8777-777777777777",
    };
    const claim = jest
      .fn()
      .mockResolvedValueOnce(first)
      .mockResolvedValueOnce(second)
      .mockResolvedValue({ outcome: "none_available" });
    const worker = new ReportingDeadlineMonitorWorker(
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

    expect(claim).toHaveBeenCalledTimes(3);
  });

  it("does not email a delivery cancelled by the current permission recheck", async () => {
    const deliver = jest.fn();
    const complete = jest.fn();
    const fail = jest.fn();
    const worker = new ReportingDeadlineMonitorWorker(
      dependencies({
        delivery: { deliver },
        queue: {
          deliveryDetails: jest
            .fn()
            .mockResolvedValue({ outcome: "cancelled" }),
          complete,
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(deliver).not.toHaveBeenCalled();
    expect(complete).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("persists retry state when provider delivery fails", async () => {
    const fail = jest.fn().mockResolvedValue(undefined);
    const worker = new ReportingDeadlineMonitorWorker(
      dependencies({
        delivery: {
          deliver: jest.fn().mockRejectedValue(new Error("SMTP down")),
        },
        queue: { fail },
      }),
    );

    await worker.runOnce();

    expect(fail).toHaveBeenCalledWith({
      organizationId,
      deliveryId,
      leaseOwner: workerId,
      checkpointVersion: 0,
      code: "provider_unavailable",
      retryable: true,
      databaseNow,
    });
  });

  it("records critical skew but continues database-time evaluation", async () => {
    const observeSkew = jest.fn().mockResolvedValue(undefined);
    const reconcile = jest.fn().mockResolvedValue(undefined);
    const worker = new ReportingDeadlineMonitorWorker(
      dependencies({
        maximumClockSkewMilliseconds: 1_000,
        clock: {
          localNow: jest.fn(() => new Date("2026-09-09T10:00:01.000Z")),
          observeSkew,
        },
        queue: { reconcile },
      }),
    );

    await worker.runOnce();

    expect(observeSkew).toHaveBeenCalledWith({
      databaseNow,
      localNow: new Date("2026-09-09T10:00:01.000Z"),
      skewMilliseconds: 1_000,
      critical: true,
    });
    expect(reconcile).toHaveBeenCalledWith(databaseNow);
  });

  it("does not let a failed monitor observation delay reconciliation", async () => {
    const reconcile = jest.fn().mockResolvedValue(undefined);
    const worker = new ReportingDeadlineMonitorWorker(
      dependencies({
        clock: {
          observeSkew: jest.fn().mockRejectedValue(new Error("unavailable")),
        },
        queue: { reconcile },
      }),
    );

    await worker.runOnce();

    expect(reconcile).toHaveBeenCalledWith(databaseNow);
  });

  it("dead-letters malformed details without passing them to the mail provider", async () => {
    const deliver = jest.fn();
    const fail = jest.fn().mockResolvedValue(undefined);
    const worker = new ReportingDeadlineMonitorWorker(
      dependencies({
        delivery: { deliver },
        queue: {
          deliveryDetails: jest.fn().mockResolvedValue({
            outcome: "deliverable",
            recipient: { userId: recipientId, email: "owner@cra.test" },
            alert: { ...details().alert, thresholdPercent: 71 },
          }),
          fail,
        },
      }),
    );

    await worker.runOnce();

    expect(deliver).not.toHaveBeenCalled();
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "malformed_delivery_details",
        retryable: false,
      }),
    );
  });

  it("rejects unsafe worker configuration", () => {
    expect(
      () =>
        new ReportingDeadlineMonitorWorker(dependencies({ leaseSeconds: 14 })),
    ).toThrow("invalid reporting deadline monitor worker lease");
    expect(
      () =>
        new ReportingDeadlineMonitorWorker(
          dependencies({ maximumClockSkewMilliseconds: 999 }),
        ),
    ).toThrow("invalid reporting deadline monitor worker clock skew");
  });
});

type Overrides = Omit<
  Partial<ReportingDeadlineMonitorDependencies>,
  "clock" | "queue" | "delivery"
> & {
  clock?: Partial<ReportingDeadlineMonitorDependencies["clock"]>;
  queue?: Partial<ReportingDeadlineMonitorDependencies["queue"]>;
  delivery?: Partial<ReportingDeadlineMonitorDependencies["delivery"]>;
};

function dependencies(
  overrides: Overrides = {},
): ReportingDeadlineMonitorDependencies {
  const {
    clock: clockOverride,
    queue: queueOverride,
    delivery: deliveryOverride,
    ...rest
  } = overrides;
  return {
    workerId,
    leaseSeconds: 60,
    maximumClockSkewMilliseconds: 1_000,
    clock: {
      databaseNow: jest.fn().mockResolvedValue(databaseNow),
      localNow: jest.fn(() => new Date(databaseNow)),
      observeSkew: jest.fn().mockResolvedValue(undefined),
      ...clockOverride,
    },
    queue: {
      reconcile: jest.fn().mockResolvedValue(undefined),
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
      claim: claimThenNone(),
      deliveryDetails: jest.fn().mockResolvedValue(details()),
      complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
      fail: jest.fn().mockResolvedValue(undefined),
      ...queueOverride,
    },
    delivery: {
      deliver: jest.fn().mockResolvedValue(undefined),
      ...deliveryOverride,
    },
    ...rest,
  } satisfies ReportingDeadlineMonitorDependencies;
}

function claimThenNone(): jest.Mock {
  return jest
    .fn()
    .mockResolvedValueOnce(claimed())
    .mockResolvedValue({ outcome: "none_available" });
}

function claimed() {
  return {
    outcome: "claimed" as const,
    organizationId,
    deliveryId,
    leaseOwner: workerId,
    checkpointVersion: 0,
  };
}

function details() {
  return {
    outcome: "deliverable" as const,
    recipient: { userId: recipientId, email: "owner@cra.test" },
    alert: {
      obligationId,
      stageKind: "early_warning" as const,
      thresholdPercent: 50 as const,
      dueAt: "2026-09-10T10:00:00Z",
      idempotencyKey: "reporting:stage:revision-1:50:recipient",
    },
  };
}
