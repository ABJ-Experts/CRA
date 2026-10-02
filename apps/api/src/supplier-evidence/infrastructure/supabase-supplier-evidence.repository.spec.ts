import { SupabaseSupplierEvidenceRepository } from "./supabase-supplier-evidence.repository";

const ORGANIZATION_ID = "00000000-0000-4000-8000-0000000000ca";
const ACTOR_ID = "00000000-0000-4000-8000-000000000001";
const REQUEST_ID = "00000000-0000-4000-8000-000000000002";
const REVISION_ID = "00000000-0000-4000-8000-000000000003";
const DELIVERY_ID = "00000000-0000-4000-8000-000000000004";
const SUPPLIER_ID = "00000000-0000-4000-8000-000000000005";
const PRODUCT_ID = "00000000-0000-4000-8000-000000000006";
const INVITATION_ID = "00000000-0000-4000-8000-000000000007";
const IDEMPOTENCY_KEY = "00000000-0000-4000-8000-000000000008";
const TIME = "2026-10-01T10:00:00.000Z";

const delivery = {
  id: DELIVERY_ID,
  requestId: REQUEST_ID,
  revisionId: REVISION_ID,
  dueAt: TIME,
  offsetHours: 24,
  recipient: "supplier",
  kind: "supplier_reminder",
  state: "failed",
  attemptCount: 5,
  nextAttemptAt: null,
  leasedUntil: null,
  failureMessage: "Delivery could not be completed.",
  invitationId: INVITATION_ID,
  deliveredAt: null,
  version: 4,
  createdAt: TIME,
  updatedAt: TIME,
};

describe("SupabaseSupplierEvidenceRepository reminder boundaries", () => {
  const rpc = jest.fn();
  const repository = new SupabaseSupplierEvidenceRepository({
    admin: () => ({ rpc }),
  } as never);

  beforeEach(() => jest.resetAllMocks());

  it("scopes settings, metrics, and overdue reads org-first and parses their contracts", async () => {
    rpc
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "found",
            result: { version: 1, offsetsHours: [-168, -24, 24] },
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "found",
            result: {
              from: "2026-09-01T00:00:00.000Z",
              to: TIME,
              outstandingCount: 1,
              overdueCount: 1,
              firstSubmissionResponseRate: {
                numerator: 0,
                denominator: 1,
                value: 0,
              },
              acceptedCompletionRate: {
                numerator: 0,
                denominator: 1,
                value: 0,
              },
              averageFirstSubmissionTurnaroundHours: null,
              turnaroundSampleCount: 0,
            },
          },
        ],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [
          {
            outcome: "found",
            result: {
              overdue: [
                {
                  requestId: REQUEST_ID,
                  revisionId: REVISION_ID,
                  supplierId: SUPPLIER_ID,
                  productId: PRODUCT_ID,
                  requestTitle: "Supplier evidence",
                  supplierDisplayName: "Example supplier",
                  dueAt: TIME,
                  daysOverdue: 1,
                  state: "awaiting_review",
                  latestDelivery: delivery,
                },
              ],
              nextCursor: null,
            },
          },
        ],
        error: null,
      });

    await repository.getReminderSettings(ORGANIZATION_ID, {
      actorId: ACTOR_ID,
    });
    await repository.metrics(ORGANIZATION_ID, {
      actorId: ACTOR_ID,
      from: "2026-09-01T00:00:00.000Z",
      to: TIME,
      productId: PRODUCT_ID,
    });
    const overdue = await repository.overdue(ORGANIZATION_ID, {
      actorId: ACTOR_ID,
      supplierId: SUPPLIER_ID,
      limit: 25,
    });

    expect(rpc).toHaveBeenNthCalledWith(
      1,
      "get_supplier_evidence_reminder_settings_atomic",
      { p_organization_id: ORGANIZATION_ID, p_actor_user_id: ACTOR_ID },
    );
    expect(rpc).toHaveBeenNthCalledWith(
      2,
      "get_supplier_evidence_response_metrics_atomic",
      expect.objectContaining({
        p_organization_id: ORGANIZATION_ID,
        p_actor_user_id: ACTOR_ID,
        p_product_id: PRODUCT_ID,
      }),
    );
    expect(rpc).toHaveBeenNthCalledWith(
      3,
      "list_supplier_evidence_overdue_atomic",
      expect.objectContaining({
        p_organization_id: ORGANIZATION_ID,
        p_supplier_id: SUPPLIER_ID,
      }),
    );
    expect(overdue.overdue[0]?.latestDelivery).toMatchObject({
      id: DELIVERY_ID,
      state: "failed",
    });
  });

  it("passes request-bound optimistic retry input to its org-first RPC", async () => {
    rpc.mockResolvedValue({
      data: [
        {
          outcome: "queued",
          result: { ...delivery, state: "pending", version: 5 },
        },
      ],
      error: null,
    });

    const retried = await repository.retryReminderDelivery(ORGANIZATION_ID, {
      actorId: ACTOR_ID,
      requestId: REQUEST_ID,
      deliveryId: DELIVERY_ID,
      expectedVersion: 4,
      idempotencyKey: IDEMPOTENCY_KEY,
    });

    expect(rpc).toHaveBeenCalledWith(
      "retry_supplier_evidence_reminder_delivery_atomic",
      {
        p_organization_id: ORGANIZATION_ID,
        p_actor_user_id: ACTOR_ID,
        p_request_id: REQUEST_ID,
        p_delivery_id: DELIVERY_ID,
        p_expected_version: 4,
        p_idempotency_key: IDEMPOTENCY_KEY,
      },
    );
    expect(retried).toMatchObject({
      id: DELIVERY_ID,
      state: "pending",
      version: 5,
    });
  });

  it("treats a successful invitation revocation as success, not a conflict", async () => {
    const revision = {
      id: REVISION_ID,
      revisionNumber: 1,
      title: "Supplier evidence",
      instructions: null,
      dueAt: TIME,
      disclosureContent: null,
      disclosureFingerprint: "a".repeat(64),
      items: [],
      createdAt: TIME,
      createdBy: ACTOR_ID,
    };
    const request = {
      id: REQUEST_ID,
      supplierId: SUPPLIER_ID,
      productId: PRODUCT_ID,
      recipientContactId: "00000000-0000-4000-8000-000000000009",
      ownerUserId: ACTOR_ID,
      state: "open",
      version: 2,
      currentRevision: revision,
      activeInvitation: null,
      reviewState: "pending_response",
      aggregateReviewState: "pending_response",
      createdAt: TIME,
      updatedAt: TIME,
      revisions: [revision],
      invitations: [],
    };
    rpc.mockResolvedValue({
      data: [{ outcome: "revoked", result: request }],
      error: null,
    });

    await expect(
      repository.revoke(ORGANIZATION_ID, {
        actorId: ACTOR_ID,
        requestId: REQUEST_ID,
        invitationId: INVITATION_ID,
        reason: "Access no longer needed",
        expectedVersion: 1,
        idempotencyKey: IDEMPOTENCY_KEY,
      }),
    ).resolves.toEqual(request);
  });
});
