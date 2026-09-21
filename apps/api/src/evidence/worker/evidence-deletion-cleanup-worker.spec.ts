import {
  EvidenceDeletionCleanupWorker,
  type EvidenceDeletionCleanupQueue,
} from "./evidence-deletion-cleanup-worker";

const organizationId = "00000000-0000-4000-8000-000000000001";
const workerId = "00000000-0000-4000-8000-000000000002";

describe("EvidenceDeletionCleanupWorker", () => {
  it("treats a missing private object as idempotently deleted", async () => {
    const queue = {
      organizationIds: jest.fn().mockResolvedValue([organizationId]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          organizationId,
          intentId: "00000000-0000-4000-8000-000000000003",
          cleanupItemId: "00000000-0000-4000-8000-000000000004",
          documentId: "00000000-0000-4000-8000-000000000005",
          bucket: "evidence-documents",
          objectKey:
            "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000004/00000000-0000-4000-8000-000000000005",
        })
        .mockResolvedValueOnce(null),
      complete: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<EvidenceDeletionCleanupQueue>;
    const storage = { remove: jest.fn().mockResolvedValue("missing") };

    const result = await new EvidenceDeletionCleanupWorker({
      workerId,
      leaseSeconds: 120,
      queue,
      storage,
    }).runOnce();

    expect(result).toBe(1);
    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest mock assertion.
    expect(queue.complete).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({ outcome: "deleted", error: null }),
    );
  });

  it("records a retry without making an unavailable object accessible", async () => {
    const queue = {
      organizationIds: jest.fn().mockResolvedValue([organizationId]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          organizationId,
          intentId: "00000000-0000-4000-8000-000000000003",
          cleanupItemId: "00000000-0000-4000-8000-000000000004",
          documentId: "00000000-0000-4000-8000-000000000005",
          bucket: "evidence-documents",
          objectKey:
            "00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000003/00000000-0000-4000-8000-000000000004/00000000-0000-4000-8000-000000000005",
        })
        .mockResolvedValueOnce(null),
      complete: jest.fn().mockResolvedValue(undefined),
    } as jest.Mocked<EvidenceDeletionCleanupQueue>;

    await new EvidenceDeletionCleanupWorker({
      workerId,
      leaseSeconds: 120,
      queue,
      storage: { remove: jest.fn().mockResolvedValue("unavailable") },
    }).runOnce();

    // eslint-disable-next-line @typescript-eslint/unbound-method -- Jest mock assertion.
    expect(queue.complete).toHaveBeenCalledWith(
      organizationId,
      expect.objectContaining({
        outcome: "retry",
        error: "Evidence object cleanup could not reach private storage.",
      }),
    );
  });
});
