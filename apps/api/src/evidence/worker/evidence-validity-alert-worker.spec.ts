import { EvidenceValidityAlertWorker } from "./evidence-validity-alert-worker";

describe("EvidenceValidityAlertWorker", () => {
  const queue = {
    dueOrganizationIds: jest.fn(),
    reconcile: jest.fn(),
    claimDelivery: jest.fn(),
    complete: jest.fn(),
  };
  const notifier = { deliver: jest.fn() };

  beforeEach(() => jest.resetAllMocks());

  it("reconciles first, then sends each durable threshold delivery once", async () => {
    queue.dueOrganizationIds.mockResolvedValue({
      organizationIds: ["org", "org"],
      nextOrganizationId: null,
    });
    queue.reconcile.mockResolvedValue(undefined);
    queue.claimDelivery
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId: "org",
        outboxId: "outbox",
        email: "owner@example.test",
        thresholdDays: 30,
        title: "Test report",
        validUntil: "2026-10-18",
        productId: "product",
      })
      .mockResolvedValue({ outcome: "none_available" });
    notifier.deliver.mockResolvedValue("delivered");
    const worker = new EvidenceValidityAlertWorker({
      workerId: "00000000-0000-4000-8000-000000000001",
      leaseSeconds: 60,
      queue,
      notifier,
    });

    await worker.runOnce();

    expect(queue.reconcile).toHaveBeenCalledTimes(1);
    expect(notifier.deliver).toHaveBeenCalledWith(
      expect.objectContaining({ outboxId: "outbox", thresholdDays: 30 }),
    );
    expect(queue.complete).toHaveBeenCalledWith("org", {
      outboxId: "outbox",
      workerId: "00000000-0000-4000-8000-000000000001",
      outcome: "sent",
      error: null,
    });
  });

  it("persists retryable delivery failures without dropping later work", async () => {
    queue.dueOrganizationIds.mockResolvedValue({
      organizationIds: ["org"],
      nextOrganizationId: null,
    });
    queue.reconcile.mockResolvedValue(undefined);
    queue.claimDelivery
      .mockResolvedValueOnce({
        outcome: "claimed",
        organizationId: "org",
        outboxId: "outbox",
        email: "owner@example.test",
        thresholdDays: 7,
        title: "Test report",
        validUntil: "2026-10-18",
        productId: "product",
      })
      .mockResolvedValue({ outcome: "none_available" });
    notifier.deliver.mockRejectedValue(new Error("SMTP unavailable"));
    const worker = new EvidenceValidityAlertWorker({
      workerId: "00000000-0000-4000-8000-000000000001",
      leaseSeconds: 60,
      queue,
      notifier,
    });

    await worker.runOnce();

    expect(queue.complete).toHaveBeenCalledWith("org", {
      outboxId: "outbox",
      workerId: "00000000-0000-4000-8000-000000000001",
      outcome: "retry",
      error: "Evidence validity alert notification could not be delivered.",
    });
  });

  it("uses the database keyset cursor so later tenants are not starved", async () => {
    queue.dueOrganizationIds
      .mockResolvedValueOnce({
        organizationIds: ["org-a"],
        nextOrganizationId: "cursor-a",
      })
      .mockResolvedValueOnce({
        organizationIds: ["org-b"],
        nextOrganizationId: null,
      });
    queue.reconcile.mockResolvedValue(undefined);
    queue.claimDelivery.mockResolvedValue({ outcome: "none_available" });
    const worker = new EvidenceValidityAlertWorker({
      workerId: "00000000-0000-4000-8000-000000000001",
      leaseSeconds: 60,
      queue,
      notifier,
    });

    await worker.runOnce();

    expect(queue.dueOrganizationIds).toHaveBeenNthCalledWith(1, null);
    expect(queue.dueOrganizationIds).toHaveBeenNthCalledWith(2, "cursor-a");
    expect(queue.reconcile).toHaveBeenCalledWith("org-b", expect.anything());
  });
});
