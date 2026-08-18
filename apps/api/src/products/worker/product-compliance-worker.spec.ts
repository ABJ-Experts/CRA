import {
  ProductComplianceWorker,
  type ProductComplianceMeasurement,
  type ProductComplianceWorkerDependencies,
} from "./product-compliance-worker";

const workerId = "00000000-0000-4000-8000-000000000001";
const organizationId = "00000000-0000-4000-8000-000000000002";
const actorId = "00000000-0000-4000-8000-000000000005";
const productId = "00000000-0000-4000-8000-000000000003";
const artifactId = "00000000-0000-4000-8000-000000000004";

describe("ProductComplianceWorker", () => {
  it("uses the pure non-reducing availability calculation before completing a durable recalculation claim", async () => {
    const queue = {
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "claimed",
          deliveryId: "00000000-0000-4000-8000-000000000005",
          leaseOwner: workerId,
          checkpointVersion: 1,
          event: {
            kind: "availability_recalculate",
            organizationId,
            productId,
            artifactId,
            actorId,
            issuedAt: "2026-08-17T12:00:00.000Z",
            supportEndsAt: "2036-08-17T12:00:00.000Z",
            existingAvailabilityUntil: "2037-08-17T12:00:00.000Z",
          },
        })
        .mockResolvedValue({ outcome: "none_available" }),
      complete: jest.fn().mockResolvedValue({ outcome: "completed" }),
      fail: jest.fn(),
    };
    const processor = {
      recalculate: jest.fn().mockResolvedValue({ outcome: "recalculated" }),
      cleanup: jest.fn(),
      inspect: jest.fn(),
      monitorExternalReference: jest.fn(),
    };
    const worker = new ProductComplianceWorker({
      workerId,
      leaseSeconds: 60,
      queue,
      processor,
    });

    await worker.runOnce();

    expect(processor.recalculate).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId,
        productId,
        artifactId,
      }),
    );
    expect(queue.complete).toHaveBeenCalledTimes(1);
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("records a safe retry for a failed inspection without logging content or URL data", async () => {
    const queue = {
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "claimed",
          deliveryId: "00000000-0000-4000-8000-000000000005",
          leaseOwner: workerId,
          checkpointVersion: 1,
          event: {
            kind: "inspect",
            organizationId,
            productId,
            artifactId,
            actorId,
            expectedVersion: 1,
            sha256: "a".repeat(64),
            byteSize: 1024,
            contentType: "application/octet-stream",
          },
        })
        .mockResolvedValue({ outcome: "none_available" }),
      complete: jest.fn(),
      fail: jest.fn().mockResolvedValue({ outcome: "failed" }),
    };
    const measurements: unknown[] = [];
    const worker = new ProductComplianceWorker({
      workerId,
      leaseSeconds: 60,
      queue,
      processor: {
        recalculate: jest.fn(),
        cleanup: jest.fn(),
        inspect: jest.fn().mockRejectedValue(new Error("provider unavailable")),
        monitorExternalReference: jest.fn(),
      },
      observe: (measurement: ProductComplianceMeasurement) =>
        measurements.push(measurement),
    });

    await worker.runOnce();

    expect(queue.fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: "unavailable", retryable: true }),
    );
    expect(measurements).toContainEqual({
      metric: "inspection_failure",
      value: 1,
    });
    expect(JSON.stringify(measurements)).not.toContain("provider unavailable");
  });

  it("retries instead of completing when a worker transition cannot resolve an active audit actor", async () => {
    const queue = {
      dueOrganizationIds: jest.fn().mockResolvedValue([organizationId]),
      claim: jest
        .fn()
        .mockResolvedValueOnce({
          outcome: "claimed",
          deliveryId: "00000000-0000-4000-8000-000000000006",
          leaseOwner: workerId,
          checkpointVersion: 1,
          event: {
            kind: "availability_recalculate",
            organizationId,
            productId,
            artifactId,
            actorId,
            issuedAt: "2026-08-17T12:00:00.000Z",
            supportEndsAt: null,
            existingAvailabilityUntil: null,
          },
        })
        .mockResolvedValue({ outcome: "none_available" }),
      complete: jest.fn(),
      fail: jest.fn().mockResolvedValue({ outcome: "failed" }),
    };
    const measurements: ProductComplianceMeasurement[] = [];
    const worker = new ProductComplianceWorker({
      workerId,
      leaseSeconds: 60,
      queue,
      processor: {
        recalculate: jest.fn().mockResolvedValue({ outcome: "not_found" }),
        inspect: jest.fn(),
        cleanup: jest.fn(),
        monitorExternalReference: jest.fn(),
      },
      observe: (measurement) => measurements.push(measurement),
    });

    await worker.runOnce();

    expect(queue.complete).not.toHaveBeenCalled();
    expect(queue.fail).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "worker_actor_unavailable",
        retryable: true,
      }),
    );
    expect(measurements).toContainEqual({ metric: "retry_count", value: 1 });
  });

  it("rejects invalid worker identifiers and lease bounds", () => {
    expect(
      () => new ProductComplianceWorker(dependencies({ workerId: "wrong" })),
    ).toThrow("invalid product compliance worker id");
    expect(
      () => new ProductComplianceWorker(dependencies({ leaseSeconds: 0 })),
    ).toThrow("invalid product compliance worker lease");
  });
});

function dependencies(
  overrides: Partial<ProductComplianceWorkerDependencies> = {},
): ProductComplianceWorkerDependencies {
  return {
    workerId,
    leaseSeconds: 60,
    queue: {
      dueOrganizationIds: () => Promise.resolve([]),
      claim: () => Promise.resolve({ outcome: "none_available" }),
      complete: () => Promise.resolve({ outcome: "completed" }),
      fail: () => Promise.resolve({ outcome: "failed" }),
    },
    processor: {
      recalculate: () => Promise.resolve({ outcome: "recalculated" }),
      cleanup: () => Promise.resolve({ outcome: "cleaned" }),
      inspect: () => Promise.resolve({ outcome: "inspected" }),
      monitorExternalReference: () => Promise.resolve({ outcome: "monitored" }),
    },
    ...overrides,
  };
}
