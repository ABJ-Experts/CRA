/* eslint-disable @typescript-eslint/unbound-method */
import {
  CoverageRecalculationWorker,
  type CoverageWorkQueue,
} from "./coverage-recalculation-worker";

describe("CoverageRecalculationWorker", () => {
  const scope = {
    organizationId: "00000000-0000-4000-8000-000000000001",
    productId: "00000000-0000-4000-8000-000000000002",
    packKey: "cra",
    versionKey: "oj-2024-11-20-en",
  };
  const queue = {
    claim: jest.fn(),
    recalculate: jest.fn(),
    fail: jest.fn(),
  } as jest.Mocked<CoverageWorkQueue>;
  const worker = new CoverageRecalculationWorker(queue);

  beforeEach(() => {
    queue.claim.mockReset();
    queue.recalculate.mockReset();
    queue.fail.mockReset();
  });

  it("does nothing without pending work", async () => {
    queue.claim.mockResolvedValue(null);
    await expect(
      worker.runOnce("00000000-0000-4000-8000-000000000003"),
    ).resolves.toBe(false);
    expect(queue.recalculate).not.toHaveBeenCalled();
  });

  it("recalculates only the claimed product/version scope", async () => {
    queue.claim.mockResolvedValue(scope);
    queue.recalculate.mockResolvedValue("current");
    await expect(
      worker.runOnce("00000000-0000-4000-8000-000000000003"),
    ).resolves.toBe(true);
    expect(queue.recalculate).toHaveBeenCalledWith(
      scope.organizationId,
      "00000000-0000-4000-8000-000000000003",
      scope,
    );
    expect(queue.fail).not.toHaveBeenCalled();
  });

  it("marks a failed calculation retryable without recording provider secrets", async () => {
    queue.claim.mockResolvedValue(scope);
    queue.recalculate.mockRejectedValue(
      new Error("database credentials leaked in error"),
    );
    await expect(
      worker.runOnce("00000000-0000-4000-8000-000000000003"),
    ).resolves.toBe(true);
    expect(queue.fail).toHaveBeenCalledWith(
      scope.organizationId,
      "00000000-0000-4000-8000-000000000003",
      scope,
      "coverage_recalculation_failed",
    );
  });
});
