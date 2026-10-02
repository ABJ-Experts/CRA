import { SupabaseNotificationDispatchQueueAdapter } from "./supabase-notification-dispatch-queue.adapter";

const organizationId = "11111111-1111-4111-8111-111111111111";
const workerId = "22222222-2222-4222-8222-222222222222";
const dispatchId = "33333333-3333-4333-8333-333333333333";
const recipientId = "44444444-4444-4444-8444-444444444444";

describe("SupabaseNotificationDispatchQueueAdapter", () => {
  it("bridges each optional source within one tenant before claiming", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "bridged", created: 1 }],
      error: null,
    });

    await subject(rpc).bridge(organizationId);

    expect(rpc.mock.calls).toEqual([
      [
        "bridge_vulnerability_triage_notification_dispatches_atomic",
        { p_organization_id: organizationId, p_limit: 100 },
      ],
      [
        "bridge_evidence_validity_notification_dispatches_atomic",
        { p_organization_id: organizationId, p_limit: 100 },
      ],
      [
        "bridge_evidence_scan_notification_dispatches_atomic",
        { p_organization_id: organizationId, p_limit: 100 },
      ],
      [
        "bridge_supplier_owner_notification_dispatches_atomic",
        { p_organization_id: organizationId, p_limit: 100 },
      ],
    ]);
  });

  it("uses bounded organization pagination and validates the cursor", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ organization_id: organizationId }],
      error: null,
    });
    const adapter = subject(rpc);

    await expect(adapter.dueOrganizations(null)).resolves.toEqual({
      organizationIds: [organizationId],
      nextOrganizationId: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "list_due_notification_dispatch_organizations_atomic",
      { p_after_organization_id: null, p_limit: 100 },
    );
    await expect(
      adapter.dueOrganizations(organizationId),
    ).rejects.toMatchObject({
      code: "malformed_provider",
      retryable: false,
    });
  });

  it("returns a continuation cursor only after a full ordered page", async () => {
    const ids = Array.from(
      { length: 100 },
      (_, index) =>
        `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`,
    );
    const adapter = subject(
      jest.fn().mockResolvedValue({
        data: ids.map((organization_id) => ({ organization_id })),
        error: null,
      }),
    );

    await expect(adapter.dueOrganizations(null)).resolves.toEqual({
      organizationIds: ids,
      nextOrganizationId: ids.at(-1),
    });
  });

  it("rejects malformed and unordered organization pages", async () => {
    const malformed = subject(
      jest.fn().mockResolvedValue({
        data: [{ organization_id: "not-a-uuid" }],
        error: null,
      }),
    );
    const duplicate = subject(
      jest.fn().mockResolvedValue({
        data: [
          { organization_id: organizationId },
          { organization_id: organizationId },
        ],
        error: null,
      }),
    );

    await expect(malformed.dueOrganizations(null)).rejects.toMatchObject({
      code: "malformed_provider",
    });
    await expect(duplicate.dueOrganizations(null)).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("claims within the verified tenant and parses a revalidated recipient and payload", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "claimed",
            dispatch: {
              dispatchId,
              leaseOwner: workerId,
              checkpointVersion: 2,
            },
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "ready",
            delivery: {
              deliveryRef: dispatchId,
              idempotencyKey: `notification-dispatch:${dispatchId}`,
              recipient: { userId: recipientId, email: "alternate@cra.test" },
              payload: {
                kind: "evidence_validity",
                title: "Certificate",
                validUntil: "2026-11-01",
                thresholdDays: 30,
                productId: null,
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
      dispatchId,
      leaseOwner: workerId,
      checkpointVersion: 2,
    });
    await expect(
      adapter.prepare({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
      }),
    ).resolves.toEqual({
      outcome: "ready",
      idempotencyKey: `notification-dispatch:${dispatchId}`,
      recipient: { userId: recipientId, email: "alternate@cra.test" },
      payload: {
        kind: "evidence_validity",
        title: "Certificate",
        validUntil: "2026-11-01",
        thresholdDays: 30,
        productId: null,
      },
    });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "claim_notification_dispatch_atomic",
      {
        p_organization_id: organizationId,
        p_worker_id: workerId,
        p_lease_seconds: 120,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "prepare_notification_dispatch_atomic",
      {
        p_organization_id: organizationId,
        p_dispatch_id: dispatchId,
        p_worker_id: workerId,
        p_expected_version: 2,
      },
    );
  });

  it("rejects a substituted delivery reference before provider send", async () => {
    const adapter = subject(
      jest.fn().mockResolvedValue({
        data: [
          {
            outcome: "ready",
            delivery: {
              deliveryRef: "55555555-5555-4555-8555-555555555555",
              idempotencyKey: "notification:source:1",
              recipient: { userId: recipientId, email: "alternate@cra.test" },
              payload: { kind: "evidence_quarantined" },
            },
          },
        ],
        error: null,
      }),
    );

    await expect(
      adapter.prepare({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider", retryable: false });
  });

  it("accepts the largest configured evidence validity threshold and a scoped product", async () => {
    const productId = "66666666-6666-4666-8666-666666666666";
    const adapter = subject(
      jest.fn().mockResolvedValue({
        data: [
          {
            outcome: "ready",
            delivery: {
              deliveryRef: dispatchId,
              idempotencyKey: `notification-dispatch:${dispatchId}`,
              recipient: { userId: recipientId, email: "alternate@cra.test" },
              payload: {
                kind: "evidence_validity",
                title: "Certificate",
                validUntil: "2026-11-01",
                thresholdDays: 3650,
                productId,
              },
            },
          },
        ],
        error: null,
      }),
    );

    await expect(
      adapter.prepare({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
      }),
    ).resolves.toMatchObject({
      outcome: "ready",
      payload: { kind: "evidence_validity", thresholdDays: 3650, productId },
    });
  });

  it("rejects a substituted lease owner and invalid lease duration", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "claimed",
          dispatch: {
            dispatchId,
            leaseOwner: "55555555-5555-4555-8555-555555555555",
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

  it.each(["cancelled", "conflict", "not_found"])(
    "does not send a %s dispatch",
    async (outcome) => {
      const adapter = subject(
        jest.fn().mockResolvedValue({ data: [{ outcome }], error: null }),
      );
      await expect(
        adapter.prepare({
          organizationId,
          dispatchId,
          leaseOwner: workerId,
          checkpointVersion: 2,
        }),
      ).resolves.toEqual({ outcome });
    },
  );

  it("rejects malformed ready payload and unknown outcomes", async () => {
    const malformed = subject(
      jest.fn().mockResolvedValue({
        data: [
          {
            outcome: "ready",
            delivery: {
              deliveryRef: dispatchId,
              idempotencyKey: "notification:source:1",
              recipient: { userId: recipientId, email: "alternate@cra.test" },
              payload: { kind: "remote_command", command: "run" },
            },
          },
        ],
        error: null,
      }),
    );
    const unknown = subject(
      jest
        .fn()
        .mockResolvedValue({ data: [{ outcome: "unexpected" }], error: null }),
    );
    const input = {
      organizationId,
      dispatchId,
      leaseOwner: workerId,
      checkpointVersion: 2,
    };

    await expect(malformed.prepare(input)).rejects.toMatchObject({
      code: "malformed_provider",
    });
    await expect(unknown.prepare(input)).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });

  it("maps replayed acceptance to completed and sanitizes failure codes", async () => {
    const rpc = jest
      .fn()
      .mockResolvedValueOnce({ data: [{ outcome: "replayed" }], error: null })
      .mockResolvedValueOnce({
        data: [{ outcome: "retry_scheduled" }],
        error: null,
      });
    const adapter = subject(rpc);

    await expect(
      adapter.complete({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
        messageIdHash: null,
      }),
    ).resolves.toEqual({ outcome: "completed" });
    await expect(
      adapter.fail({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
        code: "secret_from_provider",
        retryable: true,
      }),
    ).resolves.toEqual({ outcome: "retry_scheduled" });
    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "complete_notification_dispatch_atomic",
      {
        p_organization_id: organizationId,
        p_dispatch_id: dispatchId,
        p_worker_id: workerId,
        p_expected_version: 2,
        p_outcome: "provider_accepted",
        p_message_id_hash: null,
        p_error_code: null,
      },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "fail_notification_dispatch_atomic",
      {
        p_organization_id: organizationId,
        p_dispatch_id: dispatchId,
        p_worker_id: workerId,
        p_expected_version: 2,
        p_error_code: "provider_unavailable",
        p_retryable: true,
      },
    );
  });

  it.each(["conflict", "not_found"])(
    "maps completion %s to conflict",
    async (outcome) => {
      const adapter = subject(
        jest.fn().mockResolvedValue({ data: [{ outcome }], error: null }),
      );
      await expect(
        adapter.complete({
          organizationId,
          dispatchId,
          leaseOwner: workerId,
          checkpointVersion: 2,
          messageIdHash: null,
        }),
      ).resolves.toEqual({ outcome: "conflict" });
    },
  );

  it("rejects malformed completion and failure outcomes", async () => {
    const invalidHash = subject(jest.fn());
    await expect(
      invalidHash.complete({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
        messageIdHash: "raw-smtp-id",
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    const unknown = subject(
      jest.fn().mockResolvedValue({
        data: [{ outcome: "invalid_request" }],
        error: null,
      }),
    );
    await expect(
      unknown.complete({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
        messageIdHash: null,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
    await expect(
      unknown.fail({
        organizationId,
        dispatchId,
        leaseOwner: workerId,
        checkpointVersion: 2,
        code: "delivery_failed",
        retryable: false,
      }),
    ).rejects.toMatchObject({ code: "malformed_provider" });
  });

  it("distinguishes storage outage from malformed provider rows", async () => {
    const outage = subject(
      jest.fn().mockResolvedValue({ data: null, error: { message: "secret" } }),
    );
    const malformed = subject(
      jest.fn().mockResolvedValue({ data: [], error: null }),
    );

    await expect(
      outage.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).rejects.toMatchObject({ code: "provider_unavailable", retryable: true });
    await expect(
      malformed.claim({ organizationId, workerId, leaseSeconds: 120 }),
    ).rejects.toMatchObject({ code: "malformed_provider", retryable: false });
  });

  it("redacts thrown storage errors and rejects non-object RPC rows", async () => {
    const unavailable = subject(
      jest.fn().mockRejectedValue(new Error("secret connection string")),
    );
    const malformed = subject(
      jest.fn().mockResolvedValue({ data: [null], error: null }),
    );
    const input = { organizationId, workerId, leaseSeconds: 120 };

    await expect(unavailable.claim(input)).rejects.toMatchObject({
      code: "provider_unavailable",
      message: "provider_unavailable",
    });
    await expect(malformed.claim(input)).rejects.toMatchObject({
      code: "malformed_provider",
    });
  });
});

function subject(rpc: jest.Mock) {
  return new SupabaseNotificationDispatchQueueAdapter({
    admin: () => ({ rpc }),
  } as never);
}
