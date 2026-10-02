import {
  NotificationDispatchWorker,
  type NotificationDispatchWorkerDependencies,
} from "./notification-dispatch-worker";

const organizationId = "11111111-1111-4111-8111-111111111111";
const secondOrganizationId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const dispatchId = "44444444-4444-4444-8444-444444444444";
const recipientId = "55555555-5555-4555-8555-555555555555";

const claimed = {
  outcome: "claimed" as const,
  dispatchId,
  leaseOwner: workerId,
  checkpointVersion: 2,
};

describe("NotificationDispatchWorker", () => {
  it("bridges a tenant's source outboxes before claiming dispatches", async () => {
    const order: string[] = [];
    const bridge = jest.fn().mockImplementation(() => {
      order.push("bridge");
      return Promise.resolve();
    });
    const claim = jest.fn().mockImplementation(() => {
      order.push("claim");
      return Promise.resolve({ outcome: "none_available" });
    });
    const worker = new NotificationDispatchWorker(
      dependencies({ queue: { bridge, claim } }),
    );

    await worker.runOnce();

    expect(bridge).toHaveBeenCalledWith(organizationId);
    expect(order).toEqual(["bridge", "claim"]);
  });

  it("records provider acceptance and completes only the claimed tenant work", async () => {
    const send = jest.fn().mockResolvedValue({
      status: "provider_accepted",
      messageIdHash: "a".repeat(64),
    });
    const complete = jest.fn().mockResolvedValue({ outcome: "completed" });
    const worker = new NotificationDispatchWorker(
      dependencies({ delivery: { send }, queue: { complete } }),
    );

    await worker.runOnce();

    expect(send).toHaveBeenCalledWith({
      organizationId,
      dispatchId,
      recipient: { userId: recipientId, email: "owner@cra.test" },
      idempotencyKey: "notification:source:1",
      payload: {
        kind: "finding_triage",
        advisoryId: "CVE-2026-1234",
        severity: "high",
        alertKind: "internal_sla_breached",
      },
    });
    expect(complete).toHaveBeenCalledWith({
      organizationId,
      dispatchId,
      leaseOwner: workerId,
      checkpointVersion: 2,
      messageIdHash: "a".repeat(64),
    });
  });

  it("does not send when source or recipient authorization was revoked", async () => {
    const send = jest.fn();
    const complete = jest.fn();
    const worker = new NotificationDispatchWorker(
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

  it("persists a safe retry after a provider outage and continues to another tenant", async () => {
    const claim = jest
      .fn()
      .mockResolvedValueOnce(claimed)
      .mockResolvedValueOnce({ outcome: "none_available" })
      .mockResolvedValueOnce({ ...claimed, dispatchId: secondOrganizationId })
      .mockResolvedValue({ outcome: "none_available" });
    const fail = jest.fn().mockResolvedValue({ outcome: "retry_scheduled" });
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error("secret from provider"))
      .mockResolvedValueOnce({
        status: "provider_accepted",
        messageIdHash: null,
      });
    const worker = new NotificationDispatchWorker(
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
        dispatchId,
        code: "provider_unavailable",
        retryable: true,
      }),
    );
    expect(JSON.stringify(fail.mock.calls)).not.toContain(
      "secret from provider",
    );
  });
});

type Overrides = Omit<
  Partial<NotificationDispatchWorkerDependencies>,
  "queue" | "delivery"
> & {
  queue?: Partial<NotificationDispatchWorkerDependencies["queue"]>;
  delivery?: Partial<NotificationDispatchWorkerDependencies["delivery"]>;
};

function dependencies(
  overrides: Overrides = {},
): NotificationDispatchWorkerDependencies {
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
      dueOrganizations: jest.fn().mockResolvedValue({
        organizationIds: [organizationId],
        nextOrganizationId: null,
      }),
      bridge: jest.fn().mockResolvedValue(undefined),
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
        idempotencyKey: "notification:source:1",
        payload: {
          kind: "finding_triage",
          advisoryId: "CVE-2026-1234",
          severity: "high",
          alertKind: "internal_sla_breached",
        },
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
