import { SbomIngestWorker } from "./sbom-ingest-worker";

const orgA = "11111111-1111-4111-8111-111111111111";
const orgB = "22222222-2222-4222-8222-222222222222";
const jobId = "33333333-3333-4333-8333-333333333333";

describe("SbomIngestWorker", () => {
  const queue = {
    dueOrganizationIds: jest.fn(),
    claim: jest.fn(),
    checkpoint: jest.fn(),
    markComplete: jest.fn(),
    fail: jest.fn(),
  };
  const storage = { inspect: jest.fn() };

  beforeEach(() => jest.resetAllMocks());

  it("takes one job per tenant per round before a second from a busy tenant", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA, orgB]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValueOnce(claim(orgB))
      .mockResolvedValue({ outcome: "none_available" });
    storage.inspect.mockResolvedValue({ outcome: "verified" });

    await subject().runOnce();

    expect(queue.claim).toHaveBeenNthCalledWith(1, orgA, expect.any(Object));
    expect(queue.claim).toHaveBeenNthCalledWith(2, orgB, expect.any(Object));
    expect(queue.claim).toHaveBeenNthCalledWith(3, orgA, expect.any(Object));
    expect(queue.claim).toHaveBeenNthCalledWith(4, orgB, expect.any(Object));
    expect(queue.markComplete).toHaveBeenCalledTimes(2);
  });

  it("persists a retryable storage outage rather than dropping a claimed job", async () => {
    queue.dueOrganizationIds.mockResolvedValue([orgA]);
    queue.claim
      .mockResolvedValueOnce(claim(orgA))
      .mockResolvedValue({ outcome: "none_available" });
    storage.inspect.mockResolvedValue({ outcome: "unavailable" });

    await subject().runOnce();

    expect(queue.fail).toHaveBeenCalledWith(
      orgA,
      expect.objectContaining({
        jobId,
        retryable: true,
        errorCode: "unavailable",
      }),
    );
    expect(queue.markComplete).not.toHaveBeenCalled();
  });

  function subject() {
    return new SbomIngestWorker({
      workerId: "44444444-4444-4444-8444-444444444444",
      leaseSeconds: 60,
      queue,
      storage,
    });
  }
});

function claim(organizationId: string) {
  return {
    outcome: "claimed" as const,
    organizationId,
    jobId,
    sourceId: "55555555-5555-4555-8555-555555555555",
    objectKey: `${organizationId}/source/a`.replace(/a$/, "a".repeat(64)),
    sha256: "a".repeat(64),
    byteSize: 12,
    mediaType: "application/json",
    retryCount: 0,
  };
}
