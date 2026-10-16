import { SupabaseProductRetentionWorkerRepository } from "./supabase-product-retention-worker.adapter";

const organizationId = "11111111-1111-4111-8111-111111111111";
const originalUserId = "22222222-2222-4222-8222-222222222222";
const productId = "33333333-3333-4333-8333-333333333333";
const alternateUserId = "44444444-4444-4444-8444-444444444444";

describe("product retention critical route adapter", () => {
  it("pins the accountable recipient on the leased source alert before delivery", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [{ outcome: "pinned" }],
      error: null,
    });
    const repository = new SupabaseProductRetentionWorkerRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.criticalRoute.pinOriginal?.({
        organizationId,
        deliveryId: alternateUserId,
        leaseOwner: originalUserId,
        checkpointVersion: 3,
        originalUserId,
      }),
    ).resolves.toEqual({ outcome: "pinned" });
    expect(rpc).toHaveBeenCalledWith(
      "pin_product_support_alert_original_recipient_atomic",
      {
        p_organization_id: organizationId,
        p_delivery_id: alternateUserId,
        p_lease_owner: originalUserId,
        p_expected_checkpoint_version: 3,
        p_original_user_id: originalUserId,
      },
    );
  });

  it("requests a tenant-scoped current route and parses the eligible recipient", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: [
        {
          outcome: "resolved",
          recipient: {
            userId: alternateUserId,
            email: "alternate@cra.test",
          },
        },
      ],
      error: null,
    });
    const repository = new SupabaseProductRetentionWorkerRepository({
      admin: () => ({ rpc }),
    } as never);

    await expect(
      repository.criticalRoute.resolve({
        organizationId,
        originalUserId,
        productId,
        eventKey: "support-period:revision:30",
      }),
    ).resolves.toEqual({
      userId: alternateUserId,
      email: "alternate@cra.test",
    });
    expect(rpc).toHaveBeenCalledWith(
      "resolve_critical_notification_recipient",
      {
        p_organization_id: organizationId,
        p_original_user_id: originalUserId,
        p_product_id: productId,
        p_category: "support_period",
      },
    );
  });

  it("retains the alert when there is no currently authorized recipient", async () => {
    const repository = new SupabaseProductRetentionWorkerRepository({
      admin: () => ({
        rpc: jest.fn().mockResolvedValue({
          data: [{ outcome: "unresolved", recipient: null }],
          error: null,
        }),
      }),
    } as never);

    await expect(
      repository.criticalRoute.resolve({
        organizationId,
        originalUserId,
        productId,
        eventKey: "support-period:revision:30",
      }),
    ).resolves.toBeNull();
  });

  it("rejects malformed provider recipients without sending mail", async () => {
    const repository = new SupabaseProductRetentionWorkerRepository({
      admin: () => ({
        rpc: jest.fn().mockResolvedValue({
          data: [
            {
              outcome: "resolved",
              recipient: { userId: alternateUserId, email: "not-an-email" },
            },
          ],
          error: null,
        }),
      }),
    } as never);

    await expect(
      repository.criticalRoute.resolve({
        organizationId,
        originalUserId,
        productId,
        eventKey: "support-period:revision:30",
      }),
    ).rejects.toThrow("malformed_provider");
  });
});
