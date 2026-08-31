import { ProductImportWorker } from "./product-import-worker";

const workerId = "00000000-0000-4000-8000-000000000001";
const organizationA = "00000000-0000-4000-8000-000000000002";
const organizationB = "00000000-0000-4000-8000-000000000003";

describe("ProductImportWorker", () => {
  it("claims one job per tenant per round", async () => {
    const calls: string[] = [];
    const remaining = new Map([
      [organizationA, 2],
      [organizationB, 2],
    ]);
    const repository = {
      dueOrganizationIds: jest
        .fn()
        .mockResolvedValue([organizationA, organizationA, organizationB]),
      claim: jest.fn((organizationId: string) => {
        calls.push(organizationId);
        const count = remaining.get(organizationId) ?? 0;
        if (count === 0) return { outcome: "none_available" as const };
        remaining.set(organizationId, count - 1);
        return {
          outcome: "claimed" as const,
          organizationId,
          importId: workerId,
          actorId: workerId,
          contentHash: "a".repeat(64),
          retryCount: 0,
          work: { kind: "dry_run" as const },
        };
      }),
      failClaim: jest.fn(),
      markStaleClaim: jest.fn(),
    };
    const useCases = {
      processStored: jest.fn().mockResolvedValue({
        ok: true,
        value: { import: {} },
      }),
    };
    const worker = new ProductImportWorker({
      workerId,
      leaseSeconds: 60,
      repository: repository as never,
      useCases: useCases as never,
      authorizeCommit: jest.fn().mockResolvedValue(true),
    });

    await worker.runOnce();

    expect(calls.slice(0, 4)).toEqual([
      organizationA,
      organizationB,
      organizationA,
      organizationB,
    ]);
    expect(useCases.processStored).toHaveBeenCalledTimes(4);
  });

  it("records a retry without exposing import data", async () => {
    const repository = {
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationA]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "claimed",
          organizationId: organizationA,
          importId: workerId,
          actorId: workerId,
          contentHash: "a".repeat(64),
          retryCount: 1,
          work: { kind: "dry_run" },
        })
        .mockResolvedValue({ outcome: "none_available" }),
      failClaim: jest.fn(),
      markStaleClaim: jest.fn(),
    };
    const measurements: unknown[] = [];
    const worker = new ProductImportWorker({
      workerId,
      leaseSeconds: 60,
      repository: repository as never,
      useCases: {
        processStored: jest.fn().mockResolvedValue({
          ok: false,
          error: { code: "unavailable" },
        }),
      } as never,
      authorizeCommit: jest.fn().mockResolvedValue(true),
      observe: (value) => measurements.push(value),
    });

    await worker.runOnce();

    expect(repository.failClaim).toHaveBeenCalledWith(organizationA, {
      importId: workerId,
      workerId,
      errorCode: "unavailable",
      retryable: true,
    });
    expect(measurements).toContainEqual({ metric: "retry_count", value: 2 });
  });

  it("marks a commit stale when authorization was revoked before execution", async () => {
    const repository = {
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationA]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "claimed",
          organizationId: organizationA,
          importId: workerId,
          contentHash: "a".repeat(64),
          retryCount: 0,
          work: {
            kind: "commit",
            actorId: workerId,
            idempotencyKey: organizationB,
          },
        })
        .mockResolvedValue({ outcome: "none_available" }),
      failClaim: jest.fn(),
      markStaleClaim: jest.fn(),
    };
    const useCases = { executeCommit: jest.fn() };
    const worker = new ProductImportWorker({
      workerId,
      leaseSeconds: 60,
      repository: repository as never,
      useCases: useCases as never,
      authorizeCommit: jest.fn().mockResolvedValue(false),
    });

    await worker.runOnce();

    expect(repository.markStaleClaim).toHaveBeenCalledWith(organizationA, {
      importId: workerId,
      workerId,
      errorCode: "authorization_changed",
    });
    expect(repository.failClaim).not.toHaveBeenCalled();
    expect(useCases.executeCommit).not.toHaveBeenCalled();
  });

  it("marks a commit stale when its immutable source object is missing", async () => {
    const repository = {
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationA]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "claimed",
          organizationId: organizationA,
          importId: workerId,
          contentHash: "a".repeat(64),
          retryCount: 0,
          work: {
            kind: "commit",
            actorId: workerId,
            idempotencyKey: organizationB,
          },
        })
        .mockResolvedValue({ outcome: "none_available" }),
      source: jest.fn().mockResolvedValue(null),
      failClaim: jest.fn(),
      markStaleClaim: jest.fn(),
    };
    const useCases = { executeCommit: jest.fn() };
    const worker = new ProductImportWorker({
      workerId,
      leaseSeconds: 60,
      repository: repository as never,
      useCases: useCases as never,
      authorizeCommit: jest.fn().mockResolvedValue(true),
    });

    await worker.runOnce();

    expect(repository.markStaleClaim).toHaveBeenCalledWith(organizationA, {
      importId: workerId,
      workerId,
      errorCode: "source_missing",
    });
    expect(repository.failClaim).not.toHaveBeenCalled();
    expect(useCases.executeCommit).not.toHaveBeenCalled();
  });
});
