/* eslint-disable @typescript-eslint/unbound-method -- repository methods are Jest mocks. */
import {
  AuditRangeConflictError,
  AuditRangeLimitError,
} from "./audit-range.errors";
import { AuditRangeWorker } from "./audit-range-worker";
import type { AuditRangeWorkerPort } from "./audit-range-worker.port";
const job = {
  id: "j",
  organizationId: "o",
  version: 1,
  leaseToken: "w",
  workerId: "w",
  phase: "authorization" as const,
  fromSequence: "1",
  toSequence: "0",
  head: null,
  predecessor: null,
  cursor: null,
  datasetContext: "unknown" as const,
  legacyCount: "0",
  priorCheckpoint: null,
  priorCheckpointStatus: "not_supplied" as const,
};
function port(): jest.Mocked<AuditRangeWorkerPort> {
  return {
    claim: jest.fn().mockResolvedValue(job),
    authorizeBatch: jest
      .fn()
      .mockResolvedValue({ job, complete: false, scopeAvailable: true }),
    revalidate: jest
      .fn()
      .mockResolvedValue({ job, anchorsValid: true, scopeAvailable: true }),
    page: jest.fn().mockResolvedValue({ rows: [], exhausted: true }),
    checkpoint: jest.fn(),
    finishUnavailable: jest.fn(),
    fail: jest.fn(),
  };
}
describe("range worker", () => {
  it("yields one authorization batch without canonical reads", async () => {
    const repository = port();
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.page).not.toHaveBeenCalled();
    expect(repository.checkpoint).toHaveBeenCalledWith(job, null, null);
  });
  it("fails closed on scope denial", async () => {
    const repository = port();
    repository.authorizeBatch.mockResolvedValue({
      job,
      complete: true,
      scopeAvailable: false,
    });
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.finishUnavailable).toHaveBeenCalledWith(
      job,
      "scope_unavailable",
    );
    expect(repository.page).not.toHaveBeenCalled();
  });
  it("completes an authorized empty range distinctly", async () => {
    const repository = port();
    repository.claim.mockResolvedValue({ ...job, phase: "verification" });
    repository.revalidate.mockResolvedValue({
      job: { ...job, phase: "verification" },
      anchorsValid: true,
      scopeAvailable: true,
    });
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.checkpoint.mock.calls[0]?.[2]?.outcome).toBe("empty");
  });
  it("is idle without work", async () => {
    const repository = port();
    repository.claim.mockResolvedValue(null);
    expect(await new AuditRangeWorker({ repository }).runOnce()).toBe("idle");
  });
  it("sanitizes transient provider failure", async () => {
    const repository = port();
    repository.authorizeBatch.mockRejectedValue(new Error("secret"));
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.fail).toHaveBeenCalledWith(
      job,
      "provider_unavailable",
      true,
    );
  });
});
describe("range worker fencing and bounds", () => {
  const verificationJob = { ...job, phase: "verification" as const };
  function verifying() {
    const repository = port();
    repository.claim.mockResolvedValue(verificationJob);
    repository.revalidate.mockResolvedValue({
      job: verificationJob,
      anchorsValid: true,
      scopeAvailable: true,
    });
    return repository;
  }
  it.each([
    [false, true, "scope_unavailable"],
    [true, false, "checkpoint_unavailable"],
  ] as const)(
    "blocks current scope=%s anchors=%s",
    async (scopeAvailable, anchorsValid, outcome) => {
      const repository = verifying();
      repository.revalidate.mockResolvedValue({
        job: verificationJob,
        scopeAvailable,
        anchorsValid,
      });
      await new AuditRangeWorker({ repository, workerId: "stable" }).runOnce();
      expect(repository.finishUnavailable).toHaveBeenCalledWith(
        verificationJob,
        outcome,
      );
      expect(repository.page).not.toHaveBeenCalled();
    },
  );
  it("rejects event limit without another provider scan", async () => {
    const repository = verifying();
    const capped = {
      ...verificationJob,
      cursor: {
        nextSequence: "1000001",
        previousHash: "0".repeat(64),
        lastEventId: null,
        checkedCount: "1000000",
        checkedFrom: "1",
        checkedTo: "1000000",
        verifiedPrefixTo: "1000000",
        breaks: [],
        sampleSequences: [],
        exhausted: false,
      },
    };
    repository.claim.mockResolvedValue(capped);
    repository.revalidate.mockResolvedValue({
      job: capped,
      anchorsValid: true,
      scopeAvailable: true,
    });
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.fail).toHaveBeenCalledWith(capped, "event_limit", false);
  });
  it("rejects empty nonexhausted provider response", async () => {
    const repository = verifying();
    repository.page.mockResolvedValue({ rows: [], exhausted: false });
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.fail).toHaveBeenCalledWith(
      verificationJob,
      "malformed_provider",
      false,
    );
  });
  it("rejects oversized batch", async () => {
    const repository = verifying();
    const row = {
      id: "11111111-1111-4111-8111-111111111111",
      chain_sequence: "1",
      chain_version: 1,
      previous_hash: "0".repeat(64),
      content_hash: "0".repeat(64),
      canonical_content: "{}",
      recomputed_canonical_content: "{}",
    };
    repository.page.mockResolvedValue({
      rows: Array.from({ length: 251 }, () => row),
      exhausted: true,
    });
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.fail).toHaveBeenCalledWith(
      verificationJob,
      "malformed_provider",
      false,
    );
  });
});
it("does not fail a cancelled or superseded lease twice", async () => {
  const repository = port();
  const conflict = new AuditRangeConflictError("superseded");
  repository.authorizeBatch.mockRejectedValue(conflict);
  expect(await new AuditRangeWorker({ repository }).runOnce()).toBe(
    "processed",
  );
  expect(repository.fail).not.toHaveBeenCalled();
});
it.each(["byte_limit", "event_limit"] as const)(
  "persists nonretryable provider %s rather than treating it as fencing",
  async (code) => {
    const repository = port();
    repository.authorizeBatch.mockRejectedValue(new AuditRangeLimitError(code));
    await new AuditRangeWorker({ repository }).runOnce();
    expect(repository.fail).toHaveBeenCalledWith(job, code, false);
  },
);
