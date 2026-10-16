import { SupabaseEvidenceValidityAlertQueue } from "./supabase-evidence-validity-alert-queue";

describe("SupabaseEvidenceValidityAlertQueue", () => {
  const organizationId = "00000000-0000-4000-8000-000000000001";
  const workerId = "00000000-0000-4000-8000-000000000002";
  const outboxId = "00000000-0000-4000-8000-000000000003";
  const versionId = "00000000-0000-4000-8000-000000000004";
  const documentId = "00000000-0000-4000-8000-000000000005";
  const productId = "00000000-0000-4000-8000-000000000006";
  const rpc = jest.fn();
  const queue = new SupabaseEvidenceValidityAlertQueue({
    admin: () => ({
      rpc,
      from: () => ({
        select: () => ({ limit: jest.fn() }),
      }),
    }),
  } as never);

  beforeEach(() => jest.resetAllMocks());

  it("claims only a valid, safe database projection", async () => {
    rpc.mockResolvedValue({
      data: {
        outboxId,
        email: "owner@example.test",
        eventType: "evidence_validity_expiring",
        thresholdDays: 30,
        versionId,
        documentId,
        title: "Test report",
        validUntil: "2026-10-18T00:00:00Z",
        productIds: [productId],
      },
      error: null,
    });

    await expect(
      queue.claimDelivery(organizationId, { workerId, leaseSeconds: 60 }),
    ).resolves.toEqual(
      expect.objectContaining({
        outcome: "claimed",
        outboxId,
        productId,
        thresholdDays: 30,
      }),
    );
    expect(rpc).toHaveBeenCalledWith(
      "claim_evidence_validity_notification_atomic",
      expect.objectContaining({
        p_organization_id: organizationId,
        p_worker_id: workerId,
        p_lease_seconds: 60,
      }),
    );
  });

  it("does not try to deliver when the database durably records a revoked owner", async () => {
    rpc.mockResolvedValue({
      data: { outboxId, outcome: "recipient_unavailable" },
      error: null,
    });

    await expect(
      queue.claimDelivery(organizationId, { workerId, leaseSeconds: 60 }),
    ).resolves.toEqual({ outcome: "none_available" });
  });
});
