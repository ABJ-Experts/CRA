import { SupabaseReportingDeadlineMonitorRepository } from "./supabase-reporting-deadline-monitor.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";
const recipientId = "44444444-4444-4444-8444-444444444444";
const workerId = "55555555-5555-4555-8555-555555555555";

describe("SupabaseReportingDeadlineMonitorRepository", () => {
  it("uses the M6 org-first claim and detail RPCs and parses only a deliverable recipient", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "claimed",
            delivery: {
              id: deliveryId,
              checkpointVersion: 2,
              organizationId,
              alertId: "66666666-6666-4666-8666-666666666666",
              recipientUserId: recipientId,
              channel: "email",
            },
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "found",
            details: {
              deliveryId,
              recipient: { userId: recipientId, email: "owner@cra.test" },
              obligationId,
              stageKind: "early_warning",
              thresholdPercent: 50,
              dueAt: "2026-09-10T10:00:00Z",
            },
          },
        ],
        error: null,
      });
    const repository = subject(rpc);

    const claim = await repository.queue.claim({
      organizationId,
      workerId,
      leaseSeconds: 60,
      databaseNow: new Date("2026-09-09T10:00:00Z"),
    });
    if (claim.outcome !== "claimed") throw new Error("expected claim");
    const details = await repository.queue.deliveryDetails({
      organizationId,
      deliveryId: claim.deliveryId,
      leaseOwner: claim.leaseOwner,
      checkpointVersion: claim.checkpointVersion,
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_reporting_deadline_alert_delivery_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: workerId,
        p_lease_seconds: 60,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_reporting_deadline_alert_delivery_details",
      {
        p_organization_id: organizationId,
        p_delivery_id: deliveryId,
        p_worker_id: workerId,
        p_expected_checkpoint_version: 2,
      },
    );
    expect(details).toEqual({
      outcome: "deliverable",
      recipient: { userId: recipientId, email: "owner@cra.test" },
      alert: {
        obligationId,
        stageKind: "early_warning",
        thresholdPercent: 50,
        dueAt: "2026-09-10T10:00:00Z",
        idempotencyKey: `reporting-deadline:${deliveryId}`,
      },
    });
  });

  it("refuses malformed provider payloads before a worker can deliver", async () => {
    const repository = subject(
      jest.fn().mockResolvedValue({
        data: [{ outcome: "found", details: { recipient: {} } }],
        error: null,
      }),
    );

    await expect(
      repository.queue.deliveryDetails({
        organizationId,
        deliveryId,
        leaseOwner: workerId,
        checkpointVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider", retryable: false });
  });

  it("returns degraded monitor health when the durable health row is critical", async () => {
    const repository = subject(
      jest.fn().mockResolvedValue({
        data: [{ outcome: "found", health: { critical: true } }],
        error: null,
      }),
    );

    await expect(repository.isReady()).resolves.toBe(false);
  });
});

function subject(rpc: jest.Mock) {
  return new SupabaseReportingDeadlineMonitorRepository({
    admin: () => ({ rpc }),
  } as never);
}
