import { createHash } from "node:crypto";

import { SupplierEvidenceReminderWorker } from "./supplier-evidence-reminder-worker";

describe("SupplierEvidenceReminderWorker", () => {
  const queue = {
    dueOrganizationIds: jest.fn(),
    reconcile: jest.fn(),
    claimDelivery: jest.fn(),
    prepareDelivery: jest.fn(),
    complete: jest.fn(),
  };
  const notifier = { deliver: jest.fn() };
  const workerId = "00000000-0000-4000-8000-000000000001";

  beforeEach(() => jest.resetAllMocks());

  it("reconciles, hashes an in-memory portal bearer, and records a sent supplier reminder", async () => {
    queue.dueOrganizationIds.mockResolvedValue({
      organizationIds: ["org", "org"],
      nextOrganizationId: null,
    });
    queue.reconcile.mockResolvedValue(undefined);
    queue.claimDelivery
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId: "org",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        eventKind: "supplier_reminder",
      })
      .mockResolvedValue({ outcome: "none_available" });
    queue.prepareDelivery.mockResolvedValue({
      outcome: "prepared",
      organizationId: "org",
      deliveryId: "00000000-0000-4000-8000-000000000002",
      recipientKind: "supplier",
      email: "supplier@cra.test",
      requestTitle: "Certificates required",
      instructions: "Submit a signed certificate.",
      dueAt: "2026-10-18T00:00:00.000Z",
    });
    notifier.deliver.mockResolvedValue("delivered");
    const worker = new SupplierEvidenceReminderWorker({
      workerId,
      leaseSeconds: 60,
      queue,
      notifier,
      createBearer: () => "opaque-portal-bearer",
    });

    await worker.runOnce();

    expect(queue.reconcile).toHaveBeenCalledTimes(1);
    expect(queue.prepareDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        deliveryId: "00000000-0000-4000-8000-000000000002",
      }),
      {
        workerId,
        tokenHash: createHash("sha256")
          .update("opaque-portal-bearer")
          .digest("hex"),
      },
    );
    expect(notifier.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ rawToken: "opaque-portal-bearer" }),
    );
    expect(queue.complete).toHaveBeenCalledWith("org", {
      deliveryId: "00000000-0000-4000-8000-000000000002",
      workerId,
      outcome: "sent",
      error: null,
    });
  });

  it("does not expose a portal bearer to an internal escalation", async () => {
    queue.dueOrganizationIds.mockResolvedValue({
      organizationIds: ["org"],
      nextOrganizationId: null,
    });
    queue.reconcile.mockResolvedValue(undefined);
    queue.claimDelivery
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId: "org",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        eventKind: "owner_escalation",
      })
      .mockResolvedValue({ outcome: "none_available" });
    queue.prepareDelivery.mockResolvedValue({
      outcome: "prepared",
      organizationId: "org",
      deliveryId: "00000000-0000-4000-8000-000000000002",
      recipientKind: "owner",
      email: "owner@cra.test",
      requestTitle: "Certificates required",
      dueAt: "2026-10-18T00:00:00.000Z",
    });
    notifier.deliver.mockResolvedValue("delivered");
    const createBearer = jest.fn(() => "must-not-reach-owner-mail");
    const worker = new SupplierEvidenceReminderWorker({
      workerId,
      leaseSeconds: 60,
      queue,
      notifier,
      createBearer,
    });

    await worker.runOnce();

    expect(notifier.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ recipientKind: "owner" }),
    );
    expect(createBearer).not.toHaveBeenCalled();
  });

  it("leaves an obsolete delivery terminal without sending or retrying it", async () => {
    queue.dueOrganizationIds.mockResolvedValue({
      organizationIds: ["org"],
      nextOrganizationId: null,
    });
    queue.reconcile.mockResolvedValue(undefined);
    queue.claimDelivery
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId: "org",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        eventKind: "supplier_reminder",
      })
      .mockResolvedValue({ outcome: "none_available" });
    queue.prepareDelivery.mockResolvedValue({ outcome: "obsolete" });
    const worker = new SupplierEvidenceReminderWorker({
      workerId,
      leaseSeconds: 60,
      queue,
      notifier,
    });

    await worker.runOnce();

    expect(notifier.deliver).not.toHaveBeenCalled();
    expect(queue.complete).not.toHaveBeenCalled();
  });

  it("records a retryable failure without preventing later work", async () => {
    queue.dueOrganizationIds.mockResolvedValue({
      organizationIds: ["org"],
      nextOrganizationId: null,
    });
    queue.reconcile.mockResolvedValue(undefined);
    queue.claimDelivery
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId: "org",
        deliveryId: "00000000-0000-4000-8000-000000000002",
        eventKind: "supplier_reminder",
      })
      .mockResolvedValue({ outcome: "none_available" });
    queue.prepareDelivery.mockRejectedValue(new Error("mail unavailable"));
    const worker = new SupplierEvidenceReminderWorker({
      workerId,
      leaseSeconds: 60,
      queue,
      notifier,
    });

    await worker.runOnce();

    expect(queue.complete).toHaveBeenCalledWith("org", {
      deliveryId: "00000000-0000-4000-8000-000000000002",
      workerId,
      outcome: "retry",
      error: "Supplier evidence reminder notification could not be delivered.",
    });
  });
});
