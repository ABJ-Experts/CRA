import { ChatNotificationWorker } from "./chat-notification-worker";
import { createHash } from "node:crypto";

const organizationId = "11111111-1111-4111-8111-111111111111";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const workerId = "33333333-3333-4333-8333-333333333333";
const secondOrganizationId = "55555555-5555-4555-8555-555555555555";
const thirdOrganizationId = "66666666-6666-4666-8666-666666666666";

const ready = {
  outcome: "ready" as const,
  credential: {
    mode: "slack_bot" as const,
    botToken: "test-token",
    channelId: "C123",
  },
  message: {
    eventClass: "high_severity_alert" as const,
    severity: "critical" as const,
    eventAt: "2026-10-02T00:00:00.000Z",
    link: "https://cra.test/findings?findingId=44444444-4444-4444-8444-444444444444",
  },
};

function setup(
  send = jest.fn().mockResolvedValue({
    outcome: "provider_accepted",
    providerMessageId: null,
  }),
) {
  const queue = {
    dueOrganizations: jest.fn().mockResolvedValue({
      organizationIds: [organizationId],
      nextOrganizationId: null,
    }),
    bridge: jest.fn().mockResolvedValue(undefined),
    claim: jest
      .fn()
      .mockResolvedValueOnce({
        outcome: "claimed",
        deliveryId,
        checkpointVersion: 1,
      })
      .mockResolvedValue({ outcome: "none_available" }),
    prepare: jest.fn().mockResolvedValue(ready),
    revalidate: jest.fn().mockResolvedValue(true),
    complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
  };
  const worker = new ChatNotificationWorker({
    workerId,
    leaseSeconds: 120,
    queue,
    delivery: { send },
  });
  return { worker, queue, send };
}

describe("ChatNotificationWorker", () => {
  it("bridges durable source events and records vendor acceptance without claiming receipt", async () => {
    const { worker, queue, send } = setup();

    await worker.runOnce();

    expect(queue.bridge).toHaveBeenCalledWith(organizationId);
    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({
        credential: ready.credential,
        message: ready.message,
      }),
    );
    const calls = send.mock.calls as unknown as Array<
      [{ beforeSend: () => Promise<boolean> }]
    >;
    const sent = calls[0]?.[0];
    expect(typeof sent?.beforeSend).toBe("function");
    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        deliveryId,
        workerId,
        checkpointVersion: 1,
        status: "provider_accepted",
        safeErrorCode: null,
      }),
    );
  });

  it("keeps a timeout with uncertain acceptance out of automatic retry", async () => {
    const send = jest.fn().mockResolvedValue({
      outcome: "failed",
      code: "send_uncertain",
      retryable: false,
      uncertain: true,
      retryAfterSeconds: null,
    });
    const { worker, queue } = setup(send);

    await worker.runOnce();

    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "uncertain",
        safeErrorCode: "send_uncertain",
        retryAfterSeconds: null,
      }),
    );
  });

  it("records a rate limit for bounded retry while continuing other organizations", async () => {
    const send = jest.fn().mockResolvedValue({
      outcome: "failed",
      code: "rate_limited",
      retryable: true,
      uncertain: false,
      retryAfterSeconds: 30,
    });
    const { worker, queue } = setup(send);

    await worker.runOnce();

    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "failed",
        safeErrorCode: "rate_limited",
        retryAfterSeconds: 30,
      }),
    );
  });

  it("exhausts a permanent removed-channel failure without retrying", async () => {
    const send = jest.fn().mockResolvedValue({
      outcome: "failed",
      code: "provider_rejected",
      retryable: false,
      uncertain: false,
      retryAfterSeconds: null,
    });
    const { worker, queue } = setup(send);

    await worker.runOnce();

    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "exhausted",
        safeErrorCode: "provider_rejected",
        retryAfterSeconds: null,
      }),
    );
  });

  it("does not send when send-time source or route access has changed", async () => {
    const { worker, queue, send } = setup();
    queue.prepare.mockResolvedValue({ outcome: "cancelled" });

    await worker.runOnce();

    expect(send).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("rechecks authorization at the transport boundary after preparation", async () => {
    const send = jest.fn(
      async (input: { beforeSend: () => Promise<boolean> }) => {
        expect(await input.beforeSend()).toBe(false);
        return {
          outcome: "failed",
          code: "authorization_changed",
          retryable: false,
          uncertain: false,
          retryAfterSeconds: null,
        };
      },
    );
    const { worker, queue } = setup(send);
    queue.revalidate.mockResolvedValue(false);

    await worker.runOnce();

    expect(queue.revalidate).toHaveBeenCalledWith({
      organizationId,
      deliveryId,
      workerId,
      checkpointVersion: 1,
    });
    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "cancelled",
        safeErrorCode: "authorization_changed",
      }),
    );
  });

  it("rejects invalid worker identities and lease bounds before claiming", () => {
    const { queue, send } = setup();
    const dependencies = { queue, delivery: { send } };

    for (const config of [
      { workerId: "not-a-uuid", leaseSeconds: 120 },
      { workerId, leaseSeconds: 14 },
      { workerId, leaseSeconds: 901 },
      { workerId, leaseSeconds: 15.5 },
    ]) {
      expect(
        () => new ChatNotificationWorker({ ...dependencies, ...config }),
      ).toThrow("invalid chat worker configuration");
    }
    expect(queue.claim).not.toHaveBeenCalled();
  });

  it("visits distinct tenants across pages and resets the cursor for the next run", async () => {
    const { worker, queue } = setup();
    queue.dueOrganizations
      .mockResolvedValueOnce({
        organizationIds: [organizationId, organizationId, secondOrganizationId],
        nextOrganizationId: secondOrganizationId,
      })
      .mockResolvedValueOnce({
        organizationIds: [thirdOrganizationId],
        nextOrganizationId: null,
      })
      .mockResolvedValueOnce({ organizationIds: [], nextOrganizationId: null });

    await worker.runOnce();
    await worker.runOnce();

    expect(queue.dueOrganizations.mock.calls).toEqual([
      [null],
      [secondOrganizationId],
      [null],
    ]);
    expect(queue.bridge.mock.calls).toEqual([
      [organizationId],
      [secondOrganizationId],
      [thirdOrganizationId],
    ]);
    expect(queue.claim).toHaveBeenCalledWith({
      organizationId: secondOrganizationId,
      workerId,
      leaseSeconds: 120,
    });
  });

  it("rejects malformed tenant scope and a repeated cursor from the queue", async () => {
    const invalidTenant = setup();
    invalidTenant.queue.dueOrganizations.mockResolvedValue({
      organizationIds: ["not-a-tenant"],
      nextOrganizationId: null,
    });
    await expect(invalidTenant.worker.runOnce()).rejects.toThrow(
      "invalid chat organization scope",
    );
    expect(invalidTenant.queue.bridge).not.toHaveBeenCalled();

    const repeatedCursor = setup();
    repeatedCursor.queue.dueOrganizations
      .mockResolvedValueOnce({
        organizationIds: [],
        nextOrganizationId: secondOrganizationId,
      })
      .mockResolvedValueOnce({
        organizationIds: [],
        nextOrganizationId: secondOrganizationId,
      });
    await expect(repeatedCursor.worker.runOnce()).rejects.toThrow(
      "invalid chat organization cursor",
    );
  });

  it("continues other tenants when bridging one tenant fails", async () => {
    const { worker, queue, send } = setup();
    queue.dueOrganizations.mockResolvedValue({
      organizationIds: [organizationId, secondOrganizationId],
      nextOrganizationId: null,
    });
    queue.bridge.mockRejectedValueOnce(new Error("unavailable"));

    await worker.runOnce();

    expect(queue.bridge.mock.calls).toEqual([
      [organizationId],
      [secondOrganizationId],
    ]);
    expect(queue.claim).toHaveBeenCalledWith({
      organizationId: secondOrganizationId,
      workerId,
      leaseSeconds: 120,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("moves past a failed preparation and safely retries the next claim", async () => {
    const { worker, queue, send } = setup();
    queue.claim
      .mockReset()
      .mockResolvedValueOnce({
        outcome: "claimed",
        deliveryId,
        checkpointVersion: 1,
      })
      .mockResolvedValueOnce({
        outcome: "claimed",
        deliveryId,
        checkpointVersion: 2,
      })
      .mockResolvedValue({ outcome: "none_available" });
    queue.prepare.mockRejectedValueOnce(new Error("temporary database outage"));

    await worker.runOnce();

    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointVersion: 1,
        status: "failed",
        safeErrorCode: "prepare_unavailable",
      }),
    );
    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        checkpointVersion: 2,
        status: "provider_accepted",
      }),
    );
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("records send exceptions as uncertain and never stores the thrown message", async () => {
    const send = jest
      .fn()
      .mockRejectedValue(new Error("secret token and webhook URL"));
    const { worker, queue } = setup(send);

    await worker.runOnce();

    expect(queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "uncertain",
        safeErrorCode: "send_uncertain",
        retryAfterSeconds: null,
      }),
    );
    expect(JSON.stringify(queue.complete.mock.calls)).not.toContain(
      "secret token",
    );
  });

  it("hashes vendor message identifiers and redacts unsafe vendor error codes", async () => {
    const providerMessageId = "opaque-message-identifier";
    const accepted = setup(
      jest
        .fn()
        .mockResolvedValue({ outcome: "provider_accepted", providerMessageId }),
    );
    await accepted.worker.runOnce();
    expect(accepted.queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        providerMessageIdHash: createHash("sha256")
          .update(providerMessageId)
          .digest("hex"),
      }),
    );
    expect(JSON.stringify(accepted.queue.complete.mock.calls)).not.toContain(
      providerMessageId,
    );

    const rejected = setup(
      jest.fn().mockResolvedValue({
        outcome: "failed",
        code: "token=secret@example.test",
        retryable: false,
        uncertain: false,
        retryAfterSeconds: 30,
      }),
    );
    await rejected.worker.runOnce();
    expect(rejected.queue.complete).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "exhausted",
        safeErrorCode: "provider_unavailable",
        retryAfterSeconds: null,
      }),
    );
  });

  it("bounds claims for a noisy tenant so a run can reach another tenant", async () => {
    const { worker, queue, send } = setup();
    queue.dueOrganizations.mockResolvedValue({
      organizationIds: [organizationId, secondOrganizationId],
      nextOrganizationId: null,
    });
    queue.claim.mockResolvedValue({
      outcome: "claimed",
      deliveryId,
      checkpointVersion: 1,
    });
    queue.prepare.mockResolvedValue({ outcome: "conflict" });

    await worker.runOnce();

    expect(queue.claim).toHaveBeenCalledTimes(40);
    expect(queue.bridge.mock.calls).toEqual([
      [organizationId],
      [secondOrganizationId],
    ]);
    expect(send).not.toHaveBeenCalled();
  });
});
