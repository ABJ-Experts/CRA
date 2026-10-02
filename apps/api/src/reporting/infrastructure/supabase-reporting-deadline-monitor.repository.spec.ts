import { SupabaseReportingDeadlineMonitorRepository } from "./supabase-reporting-deadline-monitor.repository";

const organizationId = "11111111-1111-4111-8111-111111111111";
const deliveryId = "22222222-2222-4222-8222-222222222222";
const obligationId = "33333333-3333-4333-8333-333333333333";
const recipientId = "44444444-4444-4444-8444-444444444444";
const alternateRecipientId = "77777777-7777-4777-8777-777777777777";
const workerId = "55555555-5555-4555-8555-555555555555";

describe("SupabaseReportingDeadlineMonitorRepository", () => {
  it("parses monitor clock operations and records critical skew", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ database_now: "2026-09-10T10:00:00Z" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "observed" }],
        error: null,
      });
    const repository = subject(rpc);

    await expect(repository.clock.databaseNow()).resolves.toEqual(
      new Date("2026-09-10T10:00:00Z"),
    );
    await repository.clock.observeSkew({
      databaseNow: new Date("2026-09-10T10:00:00Z"),
      localNow: new Date("2026-09-10T10:00:01.500Z"),
      skewMilliseconds: 1_500,
      critical: true,
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "get_reporting_deadline_monitor_now",
      {},
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "observe_reporting_deadline_monitor_clock_skew_atomic",
      {
        p_observed_at: "2026-09-10T10:00:00.000Z",
        p_clock_skew_milliseconds: 1_500,
      },
    );
  });

  it("accepts non-critical clock skew without logging an outage", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "observed" }],
      error: null,
    });
    const repository = subject(rpc);

    await expect(
      repository.clock.observeSkew({
        databaseNow: new Date("2026-09-10T10:00:00Z"),
        localNow: new Date("2026-09-10T10:00:00.100Z"),
        skewMilliseconds: 100,
        critical: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("fails closed on malformed clock rows", async () => {
    const repository = subject(
      jest.fn().mockResolvedValue({
        data: [{ database_now: "not-a-date" }],
        error: null,
      }),
    );

    await expect(repository.clock.databaseNow()).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it("reconciles due organizations and non-claim outcomes through org-scoped RPCs", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ outcome: "reconciled" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ organization_id: organizationId }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "none_available" }],
        error: null,
      });
    const repository = subject(rpc);

    await repository.queue.reconcile(new Date("2026-09-10T10:00:00Z"));
    await expect(
      repository.queue.dueOrganizationIds(new Date("2026-09-10T10:00:00Z")),
    ).resolves.toEqual([organizationId]);
    await expect(
      repository.queue.claim({
        organizationId,
        workerId,
        leaseSeconds: 60,
        databaseNow: new Date("2026-09-10T10:00:00Z"),
      }),
    ).resolves.toEqual({ outcome: "none_available" });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "reconcile_reporting_deadline_monitoring_atomic",
      {
        p_database_now: "2026-09-10T10:00:00.000Z",
        p_limit: 1_000,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "list_due_reporting_deadline_alert_organizations",
      { p_limit: 1_000 },
    );
  });

  it("rejects malformed queue provider rows before returning work", async () => {
    const cases: ReadonlyArray<readonly [string, () => Promise<unknown>]> = [
      [
        "bad row shape",
        () =>
          subject(
            jest.fn().mockResolvedValue({ data: [{}], error: null }),
          ).clock.databaseNow(),
      ],
      [
        "bad outcome",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [{ outcome: "surprise" }],
              error: null,
            }),
          ).queue.claim({
            organizationId,
            workerId,
            leaseSeconds: 60,
            databaseNow: new Date("2026-09-10T10:00:00Z"),
          }),
      ],
      [
        "bad claim payload",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [{ outcome: "claimed", delivery: { id: deliveryId } }],
              error: null,
            }),
          ).queue.claim({
            organizationId,
            workerId,
            leaseSeconds: 60,
            databaseNow: new Date("2026-09-10T10:00:00Z"),
          }),
      ],
      [
        "bad details outcome",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [{ outcome: "silenced", details: null }],
              error: null,
            }),
          ).queue.deliveryDetails({
            organizationId,
            deliveryId,
            leaseOwner: workerId,
            checkpointVersion: 2,
          }),
      ],
      [
        "bad complete outcome",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [{ outcome: "maybe_completed" }],
              error: null,
            }),
          ).queue.complete({
            organizationId,
            deliveryId,
            leaseOwner: workerId,
            checkpointVersion: 2,
            databaseNow: new Date("2026-09-10T10:00:00Z"),
          }),
      ],
      [
        "bad fail outcome",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [{ outcome: "ignored" }],
              error: null,
            }),
          ).queue.fail({
            organizationId,
            deliveryId,
            leaseOwner: workerId,
            checkpointVersion: 2,
            code: "smtp_timeout",
            retryable: true,
            databaseNow: new Date("2026-09-10T10:00:00Z"),
          }),
      ],
      [
        "bad rows payload",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: { organization_id: organizationId },
              error: null,
            }),
          ).queue.dueOrganizationIds(new Date("2026-09-10T10:00:00Z")),
      ],
      [
        "bad due org",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [{ organization_id: "not-a-uuid" }],
              error: null,
            }),
          ).queue.dueOrganizationIds(new Date("2026-09-10T10:00:00Z")),
      ],
      [
        "bad due row shape",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [null],
              error: null,
            }),
          ).queue.dueOrganizationIds(new Date("2026-09-10T10:00:00Z")),
      ],
      [
        "bad timestamp",
        () =>
          subject(
            jest.fn().mockResolvedValue({
              data: [
                {
                  outcome: "found",
                  details: {
                    deliveryId,
                    recipient: {
                      userId: alternateRecipientId,
                      email: "alternate@cra.test",
                    },
                    obligationId,
                    stageKind: "early_warning",
                    thresholdPercent: 50,
                    dueAt: "2026-09-10T10:00:00+25:00",
                  },
                },
              ],
              error: null,
            }),
          ).queue.deliveryDetails({
            organizationId,
            deliveryId,
            leaseOwner: workerId,
            checkpointVersion: 2,
          }),
      ],
    ];

    for (const [, act] of cases) {
      await expect(act()).rejects.toMatchObject({
        code: "malformed_provider",
        retryable: false,
      });
    }
  });

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
              recipient: {
                userId: alternateRecipientId,
                email: "alternate@cra.test",
              },
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
      recipient: { userId: alternateRecipientId, email: "alternate@cra.test" },
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

  it("returns finalized recipient loss without a sendable payload", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "recipient_unavailable", details: null }],
      error: null,
    });
    const repository = subject(rpc);

    await expect(
      repository.queue.deliveryDetails({
        organizationId,
        deliveryId,
        leaseOwner: workerId,
        checkpointVersion: 2,
      }),
    ).resolves.toEqual({ outcome: "recipient_unavailable" });
    expect(rpc).toHaveBeenCalledWith(
      "get_reporting_deadline_alert_delivery_details",
      {
        p_organization_id: organizationId,
        p_delivery_id: deliveryId,
        p_worker_id: workerId,
        p_expected_checkpoint_version: 2,
      },
    );
  });

  it("refuses details for a different delivery despite a valid recipient", async () => {
    const repository = subject(
      jest.fn().mockResolvedValue({
        data: [
          {
            outcome: "found",
            details: {
              deliveryId: "99999999-9999-4999-8999-999999999999",
              recipient: { userId: recipientId, email: "alternate@cra.test" },
              obligationId,
              stageKind: "early_warning",
              thresholdPercent: 50,
              dueAt: "2026-09-10T10:00:00Z",
            },
          },
        ],
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

  it("completes, fails and reports ready from parsed provider outcomes", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [{ outcome: "completed" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "retry_scheduled" }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [{ outcome: "found", health: { critical: false } }],
        error: null,
      });
    const repository = subject(rpc);

    await expect(
      repository.queue.complete({
        organizationId,
        deliveryId,
        leaseOwner: workerId,
        checkpointVersion: 3,
        databaseNow: new Date("2026-09-10T10:00:00Z"),
      }),
    ).resolves.toEqual({ outcome: "completed" });
    await expect(
      repository.queue.fail({
        organizationId,
        deliveryId,
        leaseOwner: workerId,
        checkpointVersion: 3,
        code: "smtp_timeout",
        retryable: true,
        databaseNow: new Date("2026-09-10T10:00:00Z"),
      }),
    ).resolves.toBeUndefined();
    await expect(repository.isReady()).resolves.toBe(true);

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "complete_reporting_deadline_alert_delivery_atomic",
      {
        p_organization_id: organizationId,
        p_delivery_id: deliveryId,
        p_worker_id: workerId,
        p_expected_checkpoint_version: 3,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "fail_reporting_deadline_alert_delivery_atomic",
      {
        p_organization_id: organizationId,
        p_delivery_id: deliveryId,
        p_worker_id: workerId,
        p_expected_checkpoint_version: 3,
        p_code: "smtp_timeout",
        p_retryable: true,
      },
    );
  });

  it("maps provider errors to retryable monitor failures", async () => {
    const repository = subject(
      jest.fn().mockResolvedValue({
        data: null,
        error: { message: "temporary outage" },
      }),
    );

    await expect(
      repository.queue.dueOrganizationIds(new Date("2026-09-10T10:00:00Z")),
    ).rejects.toMatchObject({
      code: "provider_unavailable",
      retryable: true,
    });
  });
});

function subject(rpc: jest.Mock) {
  return new SupabaseReportingDeadlineMonitorRepository({
    admin: () => ({ rpc }),
  } as never);
}
