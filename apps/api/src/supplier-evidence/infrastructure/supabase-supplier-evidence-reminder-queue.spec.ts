import { SupabaseSupplierEvidenceReminderQueue } from "./supabase-supplier-evidence-reminder-queue";

describe("SupabaseSupplierEvidenceReminderQueue", () => {
  const rpc = jest.fn();
  const queue = new SupabaseSupplierEvidenceReminderQueue({
    admin: () => ({ rpc }),
  } as never);

  beforeEach(() => jest.resetAllMocks());

  it("lists organization IDs with the database keyset cursor", async () => {
    rpc.mockResolvedValue({
      data: [
        { organization_id: "00000000-0000-4000-8000-000000000001" },
        { organization_id: "00000000-0000-4000-8000-000000000002" },
      ],
      error: null,
    });

    await expect(queue.dueOrganizationIds(null)).resolves.toEqual({
      organizationIds: [
        "00000000-0000-4000-8000-000000000001",
        "00000000-0000-4000-8000-000000000002",
      ],
      nextOrganizationId: null,
    });
    expect(rpc).toHaveBeenCalledWith(
      "list_supplier_evidence_reminder_organization_ids_atomic",
      { p_after_organization_id: null, p_limit: 250 },
    );
  });

  it("rejects unavailable or malformed organization pages", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: null });
    await expect(queue.dueOrganizationIds(null)).rejects.toThrow(
      "supplier evidence reminder queue unavailable",
    );

    rpc.mockResolvedValueOnce({
      data: [{ organization_id: "not-a-uuid" }],
      error: null,
    });
    await expect(queue.dueOrganizationIds(null)).rejects.toThrow(
      "supplier evidence reminder queue unavailable",
    );
  });

  it("reconciles with an org-first worker identity and surfaces RPC failures", async () => {
    rpc.mockResolvedValueOnce({ data: {}, error: null });
    await expect(
      queue.reconcile("00000000-0000-4000-8000-000000000001", {
        workerId: "00000000-0000-4000-8000-000000000003",
      }),
    ).resolves.toBeUndefined();
    expect(rpc).toHaveBeenCalledWith(
      "reconcile_supplier_evidence_reminders_atomic",
      {
        p_organization_id: "00000000-0000-4000-8000-000000000001",
        p_worker_id: "00000000-0000-4000-8000-000000000003",
      },
    );

    rpc.mockResolvedValueOnce({ data: null, error: { message: "offline" } });
    await expect(
      queue.reconcile("00000000-0000-4000-8000-000000000001", {
        workerId: "00000000-0000-4000-8000-000000000003",
      }),
    ).rejects.toThrow("supplier evidence reminder queue unavailable");
  });

  it("returns a durable claim and treats no-longer-eligible work as unavailable", async () => {
    rpc.mockResolvedValueOnce({
      data: {
        outcome: "claimed",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        eventKind: "owner_escalation",
      },
      error: null,
    });
    await expect(
      queue.claimDelivery("00000000-0000-4000-8000-000000000001", {
        workerId: "00000000-0000-4000-8000-000000000003",
        leaseSeconds: 60,
      }),
    ).resolves.toEqual({
      outcome: "claimed",
      organizationId: "00000000-0000-4000-8000-000000000001",
      deliveryId: "00000000-0000-4000-8000-000000000002",
      eventKind: "owner_escalation",
    });

    rpc.mockResolvedValueOnce({
      data: {
        outcome: "obsolete",
        deliveryId: "00000000-0000-4000-8000-000000000002",
      },
      error: null,
    });
    await expect(
      queue.claimDelivery("00000000-0000-4000-8000-000000000001", {
        workerId: "00000000-0000-4000-8000-000000000003",
        leaseSeconds: 60,
      }),
    ).resolves.toEqual({ outcome: "none_available" });
  });

  it("uses the org-first prepare RPC with only a bearer hash", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "prepared",
          result: {
            deliveryId: "00000000-0000-4000-8000-000000000002",
            eventKind: "supplier_reminder",
            recipientKind: "supplier",
            recipientEmail: "supplier@cra.test",
            recipientName: "Supplier contact",
            portalTitle: "Evidence requested",
            instructions: "Please upload a certificate.",
            dueAt: "2026-10-18T00:00:00.000Z",
            invitationId: "00000000-0000-4000-8000-000000000004",
          },
        },
      ],
      error: null,
    });

    const result = await queue.prepareDelivery(
      {
        outcome: "claimed",
        organizationId: "00000000-0000-4000-8000-000000000001",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        eventKind: "supplier_reminder",
      },
      {
        workerId: "00000000-0000-4000-8000-000000000003",
        tokenHash: "a".repeat(64),
      },
    );

    expect(rpc).toHaveBeenCalledWith(
      "prepare_supplier_evidence_reminder_delivery_atomic",
      expect.objectContaining({
        p_organization_id: "00000000-0000-4000-8000-000000000001",
        p_delivery_id: "00000000-0000-4000-8000-000000000002",
        p_token_hash: "a".repeat(64),
      }),
    );
    expect(result).toEqual({
      outcome: "prepared",
      organizationId: "00000000-0000-4000-8000-000000000001",
      deliveryId: "00000000-0000-4000-8000-000000000002",
      recipientKind: "supplier",
      email: "supplier@cra.test",
      requestTitle: "Evidence requested",
      instructions: "Please upload a certificate.",
      dueAt: "2026-10-18T00:00:00.000Z",
    });
  });

  it("rejects malformed claimed results instead of trusting service-role data", async () => {
    rpc.mockResolvedValue({
      data: { outcome: "claimed", deliveryId: "not-a-uuid" },
      error: null,
    });

    await expect(
      queue.claimDelivery("00000000-0000-4000-8000-000000000001", {
        workerId: "00000000-0000-4000-8000-000000000003",
        leaseSeconds: 60,
      }),
    ).rejects.toThrow("supplier evidence reminder queue unavailable");
  });

  it("maps an owner escalation and terminal preparation response", async () => {
    const claim = {
      outcome: "claimed" as const,
      organizationId: "00000000-0000-4000-8000-000000000001",
      deliveryId: "00000000-0000-4000-8000-000000000002",
      eventKind: "owner_escalation" as const,
    };
    rpc.mockResolvedValueOnce({
      data: [
        {
          outcome: "prepared",
          result: {
            deliveryId: claim.deliveryId,
            eventKind: "owner_escalation",
            recipientKind: "owner",
            recipientEmail: "owner@cra.test",
            requestTitle: "Evidence update",
            dueAt: "2026-10-18T00:00:00.000Z",
          },
        },
      ],
      error: null,
    });
    await expect(
      queue.prepareDelivery(claim, {
        workerId: "00000000-0000-4000-8000-000000000003",
        tokenHash: null,
      }),
    ).resolves.toEqual({
      outcome: "prepared",
      organizationId: claim.organizationId,
      deliveryId: claim.deliveryId,
      recipientKind: "owner",
      email: "owner@cra.test",
      requestTitle: "Evidence update",
      dueAt: "2026-10-18T00:00:00.000Z",
    });

    rpc.mockResolvedValueOnce({
      data: [{ outcome: "recipient_unavailable", result: null }],
      error: null,
    });
    await expect(
      queue.prepareDelivery(claim, {
        workerId: "00000000-0000-4000-8000-000000000003",
        tokenHash: null,
      }),
    ).resolves.toEqual({ outcome: "obsolete" });
  });

  it("completes accepted outcomes and rejects unexpected completion results", async () => {
    const input = {
      deliveryId: "00000000-0000-4000-8000-000000000002",
      workerId: "00000000-0000-4000-8000-000000000003",
      outcome: "retry" as const,
      error: "mail unavailable",
    };
    rpc.mockResolvedValueOnce({ data: "retry", error: null });
    await expect(
      queue.complete("00000000-0000-4000-8000-000000000001", input),
    ).resolves.toBeUndefined();

    rpc.mockResolvedValueOnce({ data: "not_leased", error: null });
    await expect(
      queue.complete("00000000-0000-4000-8000-000000000001", input),
    ).rejects.toThrow("supplier evidence reminder queue unavailable");
  });
});
